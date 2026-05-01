"""Point cloud and auth API routes."""
import io
import json
import os
import time
import uuid
from collections import defaultdict

import numpy as np
from fastapi import APIRouter, Cookie, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import (
    SESSION_COOKIE_NAME,
    create_session,
    create_user,
    get_current_user,
    get_user,
    remove_session,
    remove_user_sessions,
    update_password,
    validate_password_strength,
    validate_username,
    verify_credentials,
)
from ..config import (
    BUSINESS_CATEGORIES,
    CLASS_COLORS,
    CLASS_NAMES,
    CLASS_NAMES_CN,
    RAW_DIR,
    RESULTS_DIR,
)
from ..core.model_interface import get_model_instance
from ..core.pointcloud_loader import get_pointcloud_info, load_pth_pointcloud
from ..services.ai_assistant import ask_analysis_assistant, stream_analysis_assistant
from ..services.analysis import assess_embankment_risk, assess_flood_risk_with_inputs, compute_statistics, generate_inspection_report
from ..utils.export import (
    build_inspection_report_context,
    build_inspection_report_docx,
    build_inspection_report_pdf,
    export_csv,
    export_inspection_report,
    export_json,
)

router = APIRouter(prefix="/api", tags=["pointcloud"])

_cache: dict[str, dict] = {}
_login_attempts: dict[str, dict[str, float | int]] = defaultdict(dict)
LOGIN_MAX_ATTEMPTS = 5
LOGIN_BLOCK_SECONDS = 300
LOGIN_WINDOW_SECONDS = 300


class LoginPayload(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class RegisterPayload(BaseModel):
    username: str
    password: str


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


class AssistantPayload(BaseModel):
    file_id: str
    question: str
    question_type: str | None = None


class FloodAssessmentPayload(BaseModel):
    water_level: float
    warning_level: float
    rainfall: float
    forecast_rainfall: float
    drainage_status: str = "normal"


def _get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _enforce_login_rate_limit(request: Request, username: str) -> str:
    now = time.time()
    key = f"{_get_client_ip(request)}:{username or 'anonymous'}"
    state = _login_attempts.get(key) or {}
    blocked_until = float(state.get("blocked_until", 0))
    if blocked_until > now:
        raise HTTPException(429, f"登录尝试过于频繁，请在 {int(blocked_until - now)} 秒后重试")
    window_started = float(state.get("window_started", now))
    if now - window_started > LOGIN_WINDOW_SECONDS:
        _login_attempts[key] = {"count": 0, "window_started": now, "blocked_until": 0}
        return key
    if not state:
        _login_attempts[key] = {"count": 0, "window_started": now, "blocked_until": 0}
    return key


def _record_login_failure(key: str) -> None:
    now = time.time()
    state = _login_attempts.get(key) or {"count": 0, "window_started": now, "blocked_until": 0}
    if now - float(state.get("window_started", now)) > LOGIN_WINDOW_SECONDS:
        state = {"count": 0, "window_started": now, "blocked_until": 0}
    state["count"] = int(state.get("count", 0)) + 1
    if int(state["count"]) >= LOGIN_MAX_ATTEMPTS:
        state["blocked_until"] = now + LOGIN_BLOCK_SECONDS
    _login_attempts[key] = state


def _clear_login_failures(key: str) -> None:
    _login_attempts.pop(key, None)


@router.post("/auth/login")
async def login(payload: LoginPayload, response: Response, request: Request):
    username = payload.username.strip()
    key = _enforce_login_rate_limit(request, username)
    if not verify_credentials(payload.username, payload.password):
        _record_login_failure(key)
        raise HTTPException(401, "用户名或密码错误")
    _clear_login_failures(key)

    session_token, ttl_seconds = create_session(username, payload.remember_me)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=session_token,
        httponly=True,
        samesite="strict",
        secure=os.getenv("WATER_TWIN_SECURE_COOKIE", "0") == "1",
        max_age=ttl_seconds,
    )
    return {"ok": True, "username": username}


@router.post("/auth/register")
async def register(payload: RegisterPayload):
    username = payload.username.strip()
    username_error = validate_username(username)
    if username_error:
        raise HTTPException(400, username_error)
    password_error = validate_password_strength(payload.password)
    if password_error:
        raise HTTPException(400, password_error)
    if get_user(username):
        raise HTTPException(400, "用户名已存在")

    create_user(username, payload.password)
    return {"ok": True}


@router.post("/auth/change-password")
async def change_password(
    payload: ChangePasswordPayload,
    username: str = Depends(get_current_user),
    session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
):
    if not verify_credentials(username, payload.current_password):
        raise HTTPException(401, "当前密码错误")
    password_error = validate_password_strength(payload.new_password)
    if password_error:
        raise HTTPException(400, password_error)

    update_password(username, payload.new_password)
    remove_user_sessions(username, keep_token=session_token)
    return {"ok": True}


@router.post("/auth/logout")
async def logout(response: Response, session_token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME)):
    remove_session(session_token)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return {"ok": True}


@router.get("/auth/me")
async def get_me(username: str = Depends(get_current_user)):
    return {"authenticated": True, "username": username}


@router.post("/upload")
async def upload_pointcloud(file: UploadFile = File(...), username: str = Depends(get_current_user)):
    """Upload a .pth or .npy point cloud file."""
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".pth", ".npy"):
        raise HTTPException(400, "仅支持 .pth 或 .npy 格式")

    file_id = uuid.uuid4().hex[:12]
    save_path = os.path.join(RAW_DIR, f"{file_id}{ext}")
    content = await file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    try:
        data = load_pth_pointcloud(save_path)
    except Exception as exc:
        os.remove(save_path)
        raise HTTPException(400, f"文件解析失败: {exc}")

    info = get_pointcloud_info(data)
    _cache[file_id] = {"data": data, "path": save_path, "filename": file.filename}
    return {"file_id": file_id, "filename": file.filename, "info": info}


@router.get("/files")
async def list_files(username: str = Depends(get_current_user)):
    items = []
    for fid, cached in _cache.items():
        items.append({
            "file_id": fid,
            "filename": cached["filename"],
            "num_points": cached["data"].shape[0],
            "has_result": "labels" in cached,
        })
    return {"files": items}


@router.get("/pointcloud/{file_id}")
async def get_pointcloud(
    file_id: str,
    mode: str = "original",
    downsample: int = 0,
    source: str = "pred",
    username: str = Depends(get_current_user),
):
    if file_id not in _cache:
        raise HTTPException(404, "文件不存在")

    cached = _cache[file_id]
    data = cached["data"]
    pred_labels = cached.get("labels")
    raw_labels = data[:, 6].astype(int) if data.shape[1] >= 7 else None

    if mode not in {"original", "semantic", "business"}:
        raise HTTPException(400, "不支持的显示模式")
    if source not in {"raw", "pred"}:
        raise HTTPException(400, "不支持的标签来源")

    n = data.shape[0]
    if downsample > 0 and downsample < n:
        idx = np.random.choice(n, downsample, replace=False)
        idx.sort()
    else:
        idx = np.arange(n)

    pts = data[idx]
    xyz = pts[:, :3]
    rgb = pts[:, 3:6]

    label_source = _resolve_labels(mode, source, raw_labels, pred_labels)
    filter_labels = None
    if source == "raw" and raw_labels is not None:
        filter_labels = raw_labels
    elif source == "pred" and pred_labels is not None:
        filter_labels = pred_labels

    if mode == "semantic" and label_source is not None:
        lbl = label_source[idx].astype(int)
        colors = np.array([_hex_to_rgb(CLASS_COLORS[l]) for l in lbl], dtype=np.float32)
    elif mode == "business" and label_source is not None:
        lbl = label_source[idx].astype(int)
        biz_colors = _build_business_color_map()
        colors = np.array([biz_colors.get(int(l), [128, 128, 128]) for l in lbl], dtype=np.float32)
    else:
        colors = rgb

    return {
        "positions": xyz.tolist(),
        "colors": colors.tolist(),
        "labels": filter_labels[idx].astype(int).tolist() if filter_labels is not None else None,
        "count": int(len(idx)),
        "mode": mode,
        "source": source,
    }


@router.post("/predict/{file_id}")
async def run_prediction(file_id: str, username: str = Depends(get_current_user)):
    if file_id not in _cache:
        raise HTTPException(404, "文件不存在")

    cached = _cache[file_id]
    data = cached["data"]

    try:
        model = get_model_instance()
        t0 = time.time()
        labels = model.predict(data)
        elapsed = round(time.time() - t0, 2)
    except Exception as exc:
        raise HTTPException(500, f"推理失败: {exc}")

    stats = compute_statistics(labels)
    inspection = generate_inspection_report(labels)
    alerts = inspection["alerts"]

    cached["labels"] = labels
    cached["stats"] = stats
    cached["alerts"] = alerts
    cached["inspection"] = inspection

    result_path = os.path.join(RESULTS_DIR, f"{file_id}_result.npy")
    np.save(result_path, labels)

    return {
        "file_id": file_id,
        "elapsed_seconds": elapsed,
        "statistics": stats,
        "alerts": alerts,
        "inspection": inspection,
    }


@router.get("/statistics/{file_id}")
async def get_statistics(file_id: str, username: str = Depends(get_current_user)):
    if file_id not in _cache or "stats" not in _cache[file_id]:
        raise HTTPException(404, "无分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached and "labels" in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]

    return {
        "statistics": cached["stats"],
        "alerts": cached["alerts"],
        "inspection": cached.get("inspection"),
    }


@router.get("/risk-regions/{file_id}")
async def get_risk_regions(file_id: str, username: str = Depends(get_current_user)):
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "无分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]

    return {
        "file_id": file_id,
        "regions": _build_risk_regions(
            cached["data"][:, :3],
            cached["labels"],
            cached["inspection"].get("alerts", []),
        ),
    }


@router.post("/flood-assessment/{file_id}")
async def assess_flood(file_id: str, payload: FloodAssessmentPayload, username: str = Depends(get_current_user)):
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "当前文件暂无可用分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]

    result = assess_flood_risk_with_inputs(
        cached["inspection"]["metrics"],
        water_level=payload.water_level,
        warning_level=payload.warning_level,
        rainfall=payload.rainfall,
        forecast_rainfall=payload.forecast_rainfall,
        drainage_status=payload.drainage_status,
    )
    return {
        "file_id": file_id,
        "assessment": result,
    }


@router.get("/embankment-assessment/{file_id}")
async def assess_embankment(file_id: str, username: str = Depends(get_current_user)):
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "当前文件暂无可用分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]

    result = assess_embankment_risk(cached["inspection"]["metrics"])
    return {
        "file_id": file_id,
        "assessment": result,
    }


@router.post("/assistant/ask")
async def ask_assistant(payload: AssistantPayload, username: str = Depends(get_current_user)):
    file_id = payload.file_id
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "当前文件暂无可用分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]
    if "stats" not in cached:
        cached["stats"] = compute_statistics(cached["labels"])

    context = _build_assistant_context(file_id=file_id, cached=cached)

    try:
        result = ask_analysis_assistant(
            question=payload.question,
            question_type=payload.question_type,
            analysis_context=context,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc

    return {
        "ok": True,
        **result,
    }


@router.post("/assistant/ask-stream")
async def ask_assistant_stream(payload: AssistantPayload, username: str = Depends(get_current_user)):
    file_id = payload.file_id
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "当前文件暂无可用分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]
    if "stats" not in cached:
        cached["stats"] = compute_statistics(cached["labels"])

    context = _build_assistant_context(file_id=file_id, cached=cached)

    def event_stream():
        try:
            for chunk in stream_analysis_assistant(
                question=payload.question,
                question_type=payload.question_type,
                analysis_context=context,
            ):
                yield f"event: chunk\ndata: {json.dumps({'delta': chunk}, ensure_ascii=False)}\n\n"
        except ValueError as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)}, ensure_ascii=False)}\n\n"
        except RuntimeError as exc:
            yield f"event: error\ndata: {json.dumps({'message': str(exc)}, ensure_ascii=False)}\n\n"
        yield f"event: done\ndata: {json.dumps({'done': True}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.get("/export/{file_id}")
async def export_result(file_id: str, format: str = "json", username: str = Depends(get_current_user)):
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "无分析结果")

    cached = _cache[file_id]
    data, labels = cached["data"], cached["labels"]
    stats, alerts = cached["stats"], cached["alerts"]
    inspection = cached.get("inspection")

    if format == "csv":
        content = export_csv(stats)
        return StreamingResponse(
            io.BytesIO(content.encode("utf-8-sig")),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{file_id}_result.csv"'},
        )

    content = export_json(data, labels, stats, alerts, inspection)
    return StreamingResponse(
        io.BytesIO(content.encode("utf-8")),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{file_id}_result.json"'},
    )


@router.get("/inspection-report/{file_id}")
async def export_inspection_report_api(file_id: str, format: str = "pdf", username: str = Depends(get_current_user)):
    if file_id not in _cache or "labels" not in _cache[file_id]:
        raise HTTPException(404, "无分析结果")

    cached = _cache[file_id]
    if "inspection" not in cached:
        cached["inspection"] = generate_inspection_report(cached["labels"])
        cached["alerts"] = cached["inspection"]["alerts"]

    task = {
        "fileId": file_id,
        "filename": cached.get("filename", file_id),
        "statistics": cached.get("stats", {}),
        "alerts": cached.get("alerts", []),
        "inspection": cached.get("inspection", {}),
    }
    if format == "docx":
        content = build_inspection_report_docx(build_inspection_report_context(task))
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = f"{file_id}_inspection_report.docx"
    elif format == "txt":
        content = export_inspection_report(task).encode("utf-8-sig")
        media_type = "text/plain"
        filename = f"{file_id}_inspection_report.txt"
    else:
        content = build_inspection_report_pdf(build_inspection_report_context(task))
        media_type = "application/pdf"
        filename = f"{file_id}_inspection_report.pdf"

    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/meta")
async def get_meta(username: str = Depends(get_current_user)):
    return {
        "class_names": CLASS_NAMES,
        "class_names_cn": CLASS_NAMES_CN,
        "class_colors": CLASS_COLORS,
        "business_categories": BUSINESS_CATEGORIES,
    }


def _hex_to_rgb(hex_color: str) -> list[int]:
    h = hex_color.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def _resolve_labels(mode: str, source: str, raw_labels: np.ndarray | None, pred_labels: np.ndarray | None):
    if mode == "original":
        return None

    if source == "raw":
        if raw_labels is None:
            raise HTTPException(404, "原始点云文件中不包含标签")
        return raw_labels

    if pred_labels is None:
        raise HTTPException(404, "当前文件暂无分割结果")
    return pred_labels


def _build_business_color_map() -> dict[int, list[int]]:
    biz_palette = {
        "居民地设施": [230, 25, 75],
        "交通": [255, 225, 25],
        "水系": [0, 0, 255],
        "地形": [145, 30, 180],
        "植被农田": [60, 180, 75],
        "其他": [128, 128, 128],
    }
    mapping = {}
    for biz_name, class_ids in BUSINESS_CATEGORIES.items():
        color = biz_palette.get(biz_name, [128, 128, 128])
        for cid in class_ids:
            mapping[cid] = color
    return mapping


def _build_assistant_context(*, file_id: str, cached: dict) -> dict:
    inspection = cached.get("inspection", {}) or {}
    alerts = inspection.get("alerts", []) or []
    regions = _build_risk_regions(
        cached["data"][:, :3],
        cached["labels"],
        alerts,
    )
    assistant_regions = _filter_regions_for_assistant(regions)
    region_map = {region["code"]: region for region in regions}
    top_alerts = [_build_assistant_alert_summary(alert, region_map) for alert in alerts[:3]]
    class_stats = sorted(
        cached.get("stats", {}).get("class_stats", []),
        key=lambda item: item.get("ratio", 0),
        reverse=True,
    )
    business_stats = sorted(
        cached.get("stats", {}).get("business_stats", []),
        key=lambda item: item.get("ratio", 0),
        reverse=True,
    )

    return {
        "file_id": file_id,
        "filename": cached.get("filename", file_id),
        "overall_summary": inspection.get("overall", {}),
        "top_alert": top_alerts[0] if top_alerts else None,
        "top_alerts": top_alerts,
        "top_region": assistant_regions[0] if assistant_regions else None,
        "top_regions": assistant_regions[:3],
        "top_semantic_classes": class_stats[:5],
        "top_business_categories": business_stats[:5],
        "statistics": cached.get("stats", {}),
        "inspection": inspection,
        "risk_regions": assistant_regions,
        "fallback_regions": [region for region in regions if region not in assistant_regions],
    }


def _build_assistant_alert_summary(alert: dict, region_map: dict[str, dict]) -> dict:
    region = region_map.get(alert.get("code"), {})
    return {
        "code": alert.get("code"),
        "title": alert.get("title"),
        "level": alert.get("level"),
        "level_label": alert.get("level_label"),
        "score": alert.get("score"),
        "message": alert.get("message"),
        "reason": alert.get("reason"),
        "suggestion": alert.get("suggestion"),
        "metric_name": alert.get("metric_name"),
        "metric_value": alert.get("metric_value"),
        "metric_unit": alert.get("metric_unit"),
        "point_count": alert.get("point_count"),
        "region_title": region.get("title"),
        "region_level": region.get("level"),
        "region_score": region.get("score"),
        "region_point_count": region.get("point_count"),
        "region_class_names_cn": region.get("class_names_cn", []),
        "region_center": region.get("center"),
    }


def _filter_regions_for_assistant(regions: list[dict]) -> list[dict]:
    strong_regions = [
        region for region in regions
        if (region.get("score", 0) or 0) > 0
        or str(region.get("reason", "")).strip()
        or (region.get("spatial_score", 0) or 0) > 0
    ]
    if strong_regions:
        return strong_regions
    return regions[:3]


def _build_risk_regions(points: np.ndarray, labels: np.ndarray, alerts: list[dict]) -> list[dict]:
    alert_mapping = {
        "embankment_pressure": {
            "code": "embankment_pressure",
            "title": "堤坝临水压力区",
            "family": "embankment",
            "class_ids": [6, 4, 5, 12],
        },
        "drainage_pressure": {
            "code": "drainage_pressure",
            "title": "沟渠排水压力区",
            "family": "drainage",
            "class_ids": [13, 12, 11],
        },
        "bank_erosion": {
            "code": "bank_erosion",
            "title": "岸线冲刷侵蚀区",
            "family": "erosion",
            "class_ids": [12, 11, 4, 5],
        },
        "flood_exposure": {
            "code": "flood_exposure",
            "title": "临水暴露高风险区",
            "family": "flood_exposure",
            "class_ids": [12, 2, 3, 1, 0],
        },
        "slope_instability": {
            "code": "slope_instability",
            "title": "边坡失稳敏感区",
            "family": "slope",
            "class_ids": [4, 5],
        },
    }
    fallback_groups = [
        {"code": "dam_region", "title": "堤坝区域", "family": "embankment", "level": "high", "class_ids": [6]},
        {"code": "waterline_region", "title": "水边线区域", "family": "waterline", "level": "high", "class_ids": [12]},
        {"code": "ditch_region", "title": "沟渠区域", "family": "drainage", "level": "medium", "class_ids": [13]},
        {"code": "slope_region", "title": "边坡区域", "family": "slope", "level": "medium", "class_ids": [4, 5]},
    ]

    used_families: set[str] = set()
    regions: list[dict] = []

    for alert in alerts:
        config = alert_mapping.get(alert.get("code"))
        if not config:
            continue
        alert_regions = _extract_regions_from_class_group(
            points=points,
            labels=labels,
            class_ids=config["class_ids"],
            code=config["code"],
            title=alert.get("title") or config["title"],
            family=config["family"],
            level=alert.get("level", "medium"),
            score=alert.get("score", 0),
            reason=alert.get("reason", ""),
        )
        if alert_regions:
            used_families.add(config["family"])
            regions.extend(alert_regions)

    for item in fallback_groups:
        if item["family"] in used_families:
            continue
        fallback_regions = _extract_regions_from_class_group(
            points=points,
            labels=labels,
            class_ids=item["class_ids"],
            code=item["code"],
            title=item["title"],
            family=item["family"],
            level=item["level"],
            score=0,
            reason="",
        )
        if fallback_regions:
            regions.extend(fallback_regions[:1])

    return _dedupe_regions_by_family(regions)[:8]


def _extract_regions_from_class_group(
    *,
    points: np.ndarray,
    labels: np.ndarray,
    class_ids: list[int],
    code: str,
    title: str,
    family: str,
    level: str,
    score: int,
    reason: str,
) -> list[dict]:
    selected_ids = _select_region_class_ids(labels, class_ids)
    if not selected_ids:
        return []

    mask = np.isin(labels.astype(int), selected_ids)
    if not np.any(mask):
        return []

    region_points = points[mask]
    clusters = _cluster_region_points(region_points)
    results: list[dict] = []

    for cluster_index, cluster_points in enumerate(clusters):
        center = cluster_points.mean(axis=0)
        bounds_min = cluster_points.min(axis=0)
        bounds_max = cluster_points.max(axis=0)
        extent = bounds_max - bounds_min
        footprint = max(float(extent[0]) * float(extent[1]), 0.001)
        volume = max(float(extent[0]) * float(extent[1]) * float(extent[2]), 0.001)
        density_2d = float(cluster_points.shape[0]) / max(footprint, 1.0)
        density_3d = float(cluster_points.shape[0]) / max(volume, 1.0)
        span_score = min((footprint / 120.0) * 100.0, 100.0)
        volume_score = min((volume / 450.0) * 100.0, 100.0)
        density_score = min(density_2d * 3.0, 100.0)
        count_score = min((float(cluster_points.shape[0]) / 5000.0) * 100.0, 100.0)
        spatial_score = round(
            min(span_score * 0.28 + volume_score * 0.14 + density_score * 0.36 + count_score * 0.22, 100.0),
            2,
        )
        combined_score = round(min(float(score) * 0.56 + spatial_score * 0.44, 100.0), 2)
        suffix = f" #{cluster_index + 1}" if len(clusters) > 1 else ""

        results.append({
            "code": f"{code}_{cluster_index + 1}" if len(clusters) > 1 else code,
            "base_code": code,
            "family": family,
            "title": f"{title}{suffix}",
            "level": level,
            "score": int(score),
            "combined_score": combined_score,
            "spatial_score": spatial_score,
            "reason": reason,
            "point_count": int(cluster_points.shape[0]),
            "class_ids": selected_ids,
            "class_names_cn": [CLASS_NAMES_CN[class_id] for class_id in selected_ids],
            "center": [round(float(v), 3) for v in center.tolist()],
            "bounds_min": [round(float(v), 3) for v in bounds_min.tolist()],
            "bounds_max": [round(float(v), 3) for v in bounds_max.tolist()],
            "extent": [round(float(v), 3) for v in extent.tolist()],
            "footprint_area": round(footprint, 3),
            "bounding_volume": round(volume, 3),
            "density_2d": round(density_2d, 3),
            "density_3d": round(density_3d, 6),
        })

    return results


def _cluster_region_points(points: np.ndarray) -> list[np.ndarray]:
    if points.shape[0] <= 400:
        return [points]

    xy = points[:, :2]
    min_xy = xy.min(axis=0)
    max_xy = xy.max(axis=0)
    extent = np.maximum(max_xy - min_xy, 1e-6)
    footprint = float(extent[0] * extent[1])
    if footprint <= 1e-6:
        return [points]

    approx_spacing = max((footprint / max(points.shape[0], 1)) ** 0.5, 0.35)
    cell_size = float(np.clip(approx_spacing * 4.5, 1.8, 12.0))
    grid = np.floor((xy - min_xy) / cell_size).astype(int)

    cell_to_indices: dict[tuple[int, int], list[int]] = {}
    for idx, cell in enumerate(grid):
        key = (int(cell[0]), int(cell[1]))
        cell_to_indices.setdefault(key, []).append(idx)

    if len(cell_to_indices) <= 1:
        return [points]

    visited: set[tuple[int, int]] = set()
    clusters: list[np.ndarray] = []
    min_cluster_points = 120

    for start_cell in cell_to_indices:
        if start_cell in visited:
            continue

        stack = [start_cell]
        visited.add(start_cell)
        component_cells: list[tuple[int, int]] = []

        while stack:
            cell = stack.pop()
            component_cells.append(cell)
            cx, cy = cell
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    neighbor = (cx + dx, cy + dy)
                    if neighbor in visited or neighbor not in cell_to_indices:
                        continue
                    visited.add(neighbor)
                    stack.append(neighbor)

        component_indices: list[int] = []
        for cell in component_cells:
            component_indices.extend(cell_to_indices[cell])

        if len(component_indices) >= min_cluster_points:
            clusters.append(points[np.array(component_indices, dtype=int)])

    if not clusters:
        return [points]

    clusters.sort(key=lambda item: item.shape[0], reverse=True)

    if len(clusters) == 1 and points.shape[0] >= 3000:
        refined_cell = max(cell_size * 0.7, 1.2)
        refined = _cluster_region_points_by_grid(points, refined_cell, min_cluster_points)
        if len(refined) > 1:
            return refined

    return clusters or [points]


def _cluster_region_points_by_grid(points: np.ndarray, cell_size: float, min_cluster_points: int) -> list[np.ndarray]:
    xy = points[:, :2]
    min_xy = xy.min(axis=0)
    grid = np.floor((xy - min_xy) / max(cell_size, 1e-6)).astype(int)
    cell_to_indices: dict[tuple[int, int], list[int]] = {}
    for idx, cell in enumerate(grid):
        key = (int(cell[0]), int(cell[1]))
        cell_to_indices.setdefault(key, []).append(idx)

    visited: set[tuple[int, int]] = set()
    clusters: list[np.ndarray] = []

    for start_cell in cell_to_indices:
        if start_cell in visited:
            continue
        stack = [start_cell]
        visited.add(start_cell)
        component_indices: list[int] = []

        while stack:
            cell = stack.pop()
            component_indices.extend(cell_to_indices[cell])
            cx, cy = cell
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    neighbor = (cx + dx, cy + dy)
                    if neighbor in visited or neighbor not in cell_to_indices:
                        continue
                    visited.add(neighbor)
                    stack.append(neighbor)

        if len(component_indices) >= min_cluster_points:
            clusters.append(points[np.array(component_indices, dtype=int)])

    clusters.sort(key=lambda item: item.shape[0], reverse=True)
    return clusters


def _dedupe_regions_by_family(regions: list[dict]) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for region in regions:
        grouped.setdefault(region.get("family") or region["code"], []).append(region)

    deduped: list[dict] = []
    for family, items in grouped.items():
        items.sort(key=lambda item: (-item.get("combined_score", item["score"]), -item["point_count"]))
        primary = items[0]
        deduped.append(primary)

        if len(items) > 1:
            extras = [
                item for item in items[1:]
                if item.get("combined_score", 0) >= primary.get("combined_score", 0) * 0.72
                and item["point_count"] >= max(int(primary["point_count"] * 0.25), 120)
            ]
            deduped.extend(extras[:2])

    deduped.sort(
        key=lambda item: (
            {"high": 0, "medium": 1, "low": 2}.get(item["level"], 3),
            -item.get("combined_score", item["score"]),
            -item["point_count"],
        )
    )
    return deduped


def _select_region_class_ids(labels: np.ndarray, candidate_ids: list[int]) -> list[int]:
    present = []
    int_labels = labels.astype(int)
    for class_id in candidate_ids:
        count = int(np.count_nonzero(int_labels == class_id))
        if count > 0:
            present.append((class_id, count))

    if not present:
        return []

    present.sort(key=lambda item: item[1], reverse=True)
    top_count = present[0][1]
    selected = [class_id for class_id, count in present if count >= max(int(top_count * 0.25), 1)]
    return selected[:2]
