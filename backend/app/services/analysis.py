"""Statistics and inspection analysis services."""
from __future__ import annotations

import numpy as np

from ..config import (
    BUSINESS_CATEGORIES,
    CLASS_COLORS,
    CLASS_NAMES,
    CLASS_NAMES_CN,
    NUM_CLASSES,
)


DATASET_BASELINES = {
    "waterline_ratio": {"low": 44.28, "medium": 57.40, "high": 72.18},
    "ditch_ratio": {"low": 0.01, "medium": 0.37, "high": 0.70},
    "dam_ratio": {"low": 0.01, "medium": 4.64, "high": 26.19},
    "slope_ratio": {"low": 8.87, "medium": 18.51, "high": 21.22},
    "scarp_ratio": {"low": 0.01, "medium": 3.19, "high": 7.67},
    "bareland_ratio": {"low": 27.86, "medium": 37.28, "high": 41.66},
    "asset_ratio": {"low": 10.48, "medium": 19.10, "high": 33.66},
    "flood_exposure_ratio": {"low": 49.29, "medium": 66.60, "high": 77.17},
    "water_erosion_ratio": {"low": 75.89, "medium": 90.19, "high": 92.66},
    "embankment_pressure_ratio": {"low": 54.14, "medium": 78.18, "high": 87.79},
    "drainage_pressure_ratio": {"low": 66.87, "medium": 78.19, "high": 87.30},
}

MIN_RATIO_GATES = {
    "waterline_active": 2.0,
    "ditch_active": 0.3,
    "dam_active": 0.5,
    "slope_active": 3.0,
    "bareland_active": 5.0,
    "asset_active": 4.0,
}

MIN_COUNT_GATES = {
    "waterline": 80,
    "ditch": 30,
    "dam": 40,
    "slope": 80,
    "scarp": 30,
    "bareland": 80,
    "assets": 80,
}


LEVEL_ORDER = {"high": 0, "medium": 1, "low": 2}
LEVEL_SCORE_FLOOR = {"low": 40, "medium": 65, "high": 85}
LEVEL_LABELS = {
    "high": "高风险",
    "medium": "中风险",
    "low": "低风险",
    "normal": "低风险",
}

DRAINAGE_STATUS_PENALTY = {
    "normal": 0,
    "limited": 12,
    "blocked": 22,
}


def compute_unified_risk_engine(labels: np.ndarray) -> dict:
    total, label_counts, ratios = _build_ratio_data(labels)

    slope_ratio = ratios[4]
    scarp_ratio = ratios[5]
    dam_ratio = ratios[6]
    bareland_ratio = ratios[11]
    waterline_ratio = ratios[12]
    ditch_ratio = ratios[13]
    asset_ratio = sum(ratios[i] for i in (0, 1, 2, 3))

    metrics = {
        "total_points": total,
        "ratios": {
            "waterline_ratio": round(waterline_ratio, 2),
            "ditch_ratio": round(ditch_ratio, 2),
            "dam_ratio": round(dam_ratio, 2),
            "slope_ratio": round(slope_ratio, 2),
            "scarp_ratio": round(scarp_ratio, 2),
            "bareland_ratio": round(bareland_ratio, 2),
            "asset_ratio": round(asset_ratio, 2),
            "flood_exposure_ratio": round(waterline_ratio + asset_ratio, 2),
            "water_erosion_ratio": round(waterline_ratio + bareland_ratio + slope_ratio + scarp_ratio, 2),
            "embankment_pressure_ratio": round(dam_ratio + waterline_ratio + slope_ratio + scarp_ratio, 2),
            "drainage_pressure_ratio": round(ditch_ratio + waterline_ratio + bareland_ratio, 2),
        },
        "counts": {
            "waterline": label_counts.get(12, 0),
            "ditch": label_counts.get(13, 0),
            "dam": label_counts.get(6, 0),
            "slope": label_counts.get(4, 0),
            "scarp": label_counts.get(5, 0),
            "bareland": label_counts.get(11, 0),
            "assets": sum(label_counts.get(i, 0) for i in (0, 1, 2, 3)),
        },
    }

    return {
        "metrics": metrics,
        "inspection": _score_inspection_risk(metrics),
        "flood": _score_flood_risk(metrics),
        "embankment": _score_embankment_risk(metrics),
    }


def compute_statistics(labels: np.ndarray) -> dict:
    """Compute semantic and business statistics from labels."""
    total = int(labels.shape[0])
    unique, counts = np.unique(labels.astype(int), return_counts=True)
    label_counts = {int(u): int(c) for u, c in zip(unique, counts)}

    class_stats = []
    for i in range(NUM_CLASSES):
        count = label_counts.get(i, 0)
        class_stats.append({
            "id": i,
            "name": CLASS_NAMES[i],
            "name_cn": CLASS_NAMES_CN[i],
            "color": CLASS_COLORS[i],
            "count": count,
            "ratio": round(count / total * 100, 2) if total > 0 else 0,
        })

    business_stats = []
    for biz_name, class_ids in BUSINESS_CATEGORIES.items():
        count = sum(label_counts.get(cid, 0) for cid in class_ids)
        business_stats.append({
            "name": biz_name,
            "class_ids": class_ids,
            "count": count,
            "ratio": round(count / total * 100, 2) if total > 0 else 0,
        })

    return {
        "total_points": total,
        "class_stats": class_stats,
        "business_stats": business_stats,
    }


def generate_inspection_report(labels: np.ndarray) -> dict:
    """Build a ratio-based inspection report using dataset-derived baselines."""
    engine = compute_unified_risk_engine(labels)
    return {
        **engine["inspection"],
        "flood": engine["flood"],
        "embankment": engine["embankment"],
    }


def _score_inspection_risk(metrics: dict) -> dict:
    ratios = metrics["ratios"]
    counts = metrics["counts"]
    waterline_ratio = ratios["waterline_ratio"]
    ditch_ratio = ratios["ditch_ratio"]
    dam_ratio = ratios["dam_ratio"]
    slope_ratio = ratios["slope_ratio"]
    scarp_ratio = ratios["scarp_ratio"]
    bareland_ratio = ratios["bareland_ratio"]
    asset_ratio = ratios["asset_ratio"]
    alerts = []

    flood_metric = ratios["flood_exposure_ratio"]
    flood_level, flood_score = _level_from_thresholds(flood_metric, DATASET_BASELINES["flood_exposure_ratio"])
    flood_triggered = (
        waterline_ratio >= MIN_RATIO_GATES["waterline_active"]
        and asset_ratio >= MIN_RATIO_GATES["asset_active"]
        and counts["waterline"] >= MIN_COUNT_GATES["waterline"]
        and counts["assets"] >= MIN_COUNT_GATES["assets"]
    )
    if flood_level and flood_triggered:
        alerts.append(_build_alert(
            code="flood_exposure",
            title="滨水目标暴露风险",
            level=flood_level,
            score=flood_score,
            message="水边线占比与居民地、道路占比同时偏高，说明滨水区域存在更多潜在受影响目标。",
            reason=(
                f"水边线 {waterline_ratio:.2f}% + 受影响目标 {asset_ratio:.2f}% = "
                f"{flood_metric:.2f}% ，达到数据集分位阈值。"
            ),
            suggestion="优先巡查沿水边线附近的居民地、道路和通行节点，必要时设置预警或绕行方案。",
            metric_name="滨水暴露指数",
            metric_value=flood_metric,
            point_count=counts["waterline"] + counts["assets"],
        ))

    erosion_metric = ratios["water_erosion_ratio"]
    erosion_level, erosion_score = _level_from_thresholds(erosion_metric, DATASET_BASELINES["water_erosion_ratio"])
    erosion_triggered = (
        waterline_ratio >= MIN_RATIO_GATES["waterline_active"]
        and bareland_ratio >= MIN_RATIO_GATES["bareland_active"]
        and (slope_ratio + scarp_ratio) >= MIN_RATIO_GATES["slope_active"]
        and counts["waterline"] >= MIN_COUNT_GATES["waterline"]
        and counts["bareland"] >= MIN_COUNT_GATES["bareland"]
        and (counts["slope"] + counts["scarp"]) >= MIN_COUNT_GATES["slope"]
    )
    if erosion_level and erosion_triggered:
        alerts.append(_build_alert(
            code="bank_erosion",
            title="岸线冲刷与裸露面风险",
            level=erosion_level,
            score=erosion_score,
            message="水边线、裸地、边坡和陡坎的组合占比偏高，更接近冲刷或岸坡失稳场景。",
            reason=(
                f"水边线 {waterline_ratio:.2f}% + 裸地 {bareland_ratio:.2f}% + "
                f"边坡/陡坎 {slope_ratio + scarp_ratio:.2f}% = {erosion_metric:.2f}% 。"
            ),
            suggestion="建议重点核查岸坡稳定性、表层冲刷、局部坍塌和植被退化区域。",
            metric_name="岸线冲刷指数",
            metric_value=erosion_metric,
            point_count=(
                counts["waterline"]
                + counts["bareland"]
                + counts["slope"]
                + counts["scarp"]
            ),
        ))

    embankment_metric = ratios["embankment_pressure_ratio"]
    embankment_level, embankment_score = _level_from_thresholds(
        embankment_metric,
        DATASET_BASELINES["embankment_pressure_ratio"],
    )
    embankment_triggered = (
        dam_ratio >= MIN_RATIO_GATES["dam_active"]
        and waterline_ratio >= MIN_RATIO_GATES["waterline_active"]
        and (slope_ratio + scarp_ratio) >= MIN_RATIO_GATES["slope_active"]
        and counts["dam"] >= MIN_COUNT_GATES["dam"]
        and counts["waterline"] >= MIN_COUNT_GATES["waterline"]
        and (counts["slope"] + counts["scarp"]) >= MIN_COUNT_GATES["slope"]
    )
    if embankment_level and embankment_triggered:
        alerts.append(_build_alert(
            code="embankment_pressure",
            title="坝体邻近区域巡检压力",
            level=embankment_level,
            score=embankment_score,
            message="坝体、近水区域与边坡/陡坎共同出现且占比较高，说明坝肩和临水边坡更值得关注。",
            reason=(
                f"坝体 {dam_ratio:.2f}% + 水边线 {waterline_ratio:.2f}% + "
                f"边坡/陡坎 {slope_ratio + scarp_ratio:.2f}% = {embankment_metric:.2f}% 。"
            ),
            suggestion="建议检查坝体完整性、临水坡面稳定性，以及坝脚是否有冲沟或渗漏迹象。",
            metric_name="坝体巡检压力指数",
            metric_value=embankment_metric,
            point_count=(
                counts["dam"]
                + counts["waterline"]
                + counts["slope"]
                + counts["scarp"]
            ),
        ))

    drainage_metric = ratios["drainage_pressure_ratio"]
    drainage_level, drainage_score = _level_from_thresholds(
        drainage_metric,
        DATASET_BASELINES["drainage_pressure_ratio"],
    )
    drainage_triggered = (
        ditch_ratio >= MIN_RATIO_GATES["ditch_active"]
        and waterline_ratio >= MIN_RATIO_GATES["waterline_active"]
        and bareland_ratio >= MIN_RATIO_GATES["bareland_active"]
        and counts["ditch"] >= MIN_COUNT_GATES["ditch"]
        and counts["waterline"] >= MIN_COUNT_GATES["waterline"]
        and counts["bareland"] >= MIN_COUNT_GATES["bareland"]
    )
    if drainage_level and drainage_triggered:
        alerts.append(_build_alert(
            code="drainage_pressure",
            title="沟渠排水异常风险",
            level=drainage_level,
            score=drainage_score,
            message="沟渠占比明显抬升，且与水边线、裸地共同出现，可能对应排水淤积或边界受扰动区域。",
            reason=(
                f"沟渠 {ditch_ratio:.2f}% + 水边线 {waterline_ratio:.2f}% + "
                f"裸地 {bareland_ratio:.2f}% = {drainage_metric:.2f}% 。"
            ),
            suggestion="建议核查沟渠是否堵塞、淤积、断续或边坡坍塌，必要时安排清障与复测。",
            metric_name="排水压力指数",
            metric_value=drainage_metric,
            point_count=(
                counts["ditch"]
                + counts["waterline"]
                + counts["bareland"]
            ),
        ))

    slope_metric = slope_ratio + scarp_ratio
    slope_level = None
    slope_score = 0
    if scarp_ratio >= DATASET_BASELINES["scarp_ratio"]["high"] or slope_ratio >= DATASET_BASELINES["slope_ratio"]["high"]:
        slope_level, slope_score = "high", max(
            _score_within_level(scarp_ratio, DATASET_BASELINES["scarp_ratio"], "high"),
            _score_within_level(slope_ratio, DATASET_BASELINES["slope_ratio"], "high"),
        )
    elif scarp_ratio >= DATASET_BASELINES["scarp_ratio"]["medium"] or slope_ratio >= DATASET_BASELINES["slope_ratio"]["medium"]:
        slope_level, slope_score = "medium", max(
            _score_within_level(scarp_ratio, DATASET_BASELINES["scarp_ratio"], "medium"),
            _score_within_level(slope_ratio, DATASET_BASELINES["slope_ratio"], "medium"),
        )
    elif (
        scarp_ratio >= 0.5
        or slope_ratio >= DATASET_BASELINES["slope_ratio"]["low"]
        or (slope_ratio + scarp_ratio) >= MIN_RATIO_GATES["slope_active"]
    ):
        slope_level = "low"
        slope_score = max(
            _score_within_level(max(scarp_ratio, DATASET_BASELINES["scarp_ratio"]["low"]), DATASET_BASELINES["scarp_ratio"], "low"),
            _score_within_level(slope_ratio, DATASET_BASELINES["slope_ratio"], "low"),
        )

    slope_triggered = (
        (slope_ratio + scarp_ratio) >= MIN_RATIO_GATES["slope_active"]
        and (counts["slope"] + counts["scarp"]) >= MIN_COUNT_GATES["slope"]
    )
    if slope_level and slope_triggered:
        alerts.append(_build_alert(
            code="slope_instability",
            title="边坡稳定性关注项",
            level=slope_level,
            score=slope_score,
            message="边坡或陡坎占比较高，说明当前场景具有明显高差地形，需要关注局部稳定性。",
            reason=f"边坡 {slope_ratio:.2f}% ，陡坎 {scarp_ratio:.2f}% ，合计 {slope_metric:.2f}%。",
            suggestion="建议核查局部坍塌、滑移、坡脚淘刷与表层裂缝，并结合时序数据观察变化趋势。",
            metric_name="边坡敏感指数",
            metric_value=slope_metric,
            point_count=counts["slope"] + counts["scarp"],
        ))

    alerts.sort(key=lambda item: (LEVEL_ORDER.get(item["level"], 9), -item["score"]))
    overall = _build_overall_summary(alerts)
    recommendations = _build_recommendations(alerts)

    return {
        "overall": overall,
        "metrics": metrics,
        "alerts": alerts,
        "recommendations": recommendations,
    }


def _score_flood_risk(metrics: dict) -> dict:
    ratios = metrics["ratios"]
    counts = metrics["counts"]

    flood_exposure = ratios["flood_exposure_ratio"]
    erosion = ratios["water_erosion_ratio"]
    drainage = ratios["drainage_pressure_ratio"]
    embankment = ratios["embankment_pressure_ratio"]
    waterline = ratios["waterline_ratio"]
    assets = ratios["asset_ratio"]

    score = clamp_value(
        flood_exposure * 0.34
        + erosion * 0.2
        + drainage * 0.2
        + embankment * 0.16
        + min(waterline, 30) * 0.3
        + min(assets, 30) * 0.25,
        0,
        100,
    )
    if counts["waterline"] < MIN_COUNT_GATES["waterline"]:
        score = max(score - 10, 0)

    if score >= 82:
        level = "high"
    elif score >= 60:
        level = "medium"
    else:
        level = "low"

    return {
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "score": int(round(score)),
        "summary": (
            f"防洪风险由滨水暴露、岸线冲刷、排水压力和坝体邻水压力共同决定，"
            f"当前主导指标为滨水暴露 {flood_exposure:.2f}% 与排水压力 {drainage:.2f}%。"
        ),
        "factors": [
            {"name": "滨水暴露指数", "value": round(flood_exposure, 2), "unit": "%"},
            {"name": "岸线冲刷指数", "value": round(erosion, 2), "unit": "%"},
            {"name": "排水压力指数", "value": round(drainage, 2), "unit": "%"},
            {"name": "坝体巡检压力指数", "value": round(embankment, 2), "unit": "%"},
        ],
    }


def assess_flood_risk_with_inputs(
    metrics: dict,
    *,
    water_level: float,
    warning_level: float,
    rainfall: float,
    forecast_rainfall: float,
    drainage_status: str,
) -> dict:
    flood_base = _score_flood_risk(metrics)
    safe_warning_level = max(float(warning_level), 0.1)
    water_pressure = min((max(float(water_level), 0.0) / safe_warning_level) * 100, 140)
    rain_pressure = min(max(float(rainfall), 0.0) * 0.7 + max(float(forecast_rainfall), 0.0) * 0.9, 100)
    drainage_penalty = DRAINAGE_STATUS_PENALTY.get(drainage_status, 0)

    score = clamp_value(
        float(flood_base["score"]) * 0.62
        + water_pressure * 0.22
        + rain_pressure * 0.16
        + drainage_penalty,
        0,
        100,
    )

    if score >= 82:
        level = "red"
        level_label = "红色预警"
    elif score >= 64:
        level = "orange"
        level_label = "橙色预警"
    elif score >= 45:
        level = "yellow"
        level_label = "黄色预警"
    else:
        level = "blue"
        level_label = "蓝色关注"

    return {
        "level": level,
        "level_label": level_label,
        "score": int(round(score)),
        "water_pressure": round(water_pressure, 2),
        "rain_pressure": round(rain_pressure, 2),
        "drainage_penalty": drainage_penalty,
        "base_flood_score": flood_base["score"],
        "summary": _build_flood_summary(level, water_pressure, rainfall, flood_base["factors"][0]["value"]),
        "factors": [
            flood_base["summary"],
            f"水位接近警戒线 {min(water_pressure, 100):.0f}%，水位压力参与综合评分。",
            f"降雨压力指数 {rain_pressure:.0f}，由 24h 降雨和未来 6h 预报降雨计算。",
            *(f"{item['name']} {item['value']:.2f}{item.get('unit', '')}" for item in flood_base["factors"]),
            *(['人工输入显示排水状态异常，已额外提高预警分数。'] if drainage_status != "normal" else []),
        ],
        "actions": _build_flood_actions(level, drainage_status),
    }


def assess_embankment_risk(metrics: dict) -> dict:
    base = _score_embankment_risk(metrics)
    ratios = metrics["ratios"]

    dam = ratios["dam_ratio"]
    slope = ratios["slope_ratio"]
    scarp = ratios["scarp_ratio"]
    bareland = ratios["bareland_ratio"]
    waterline = ratios["waterline_ratio"]
    assets = ratios["asset_ratio"]
    level = base["level"]

    return {
        **base,
        "summary": _build_embankment_summary(level, dam, slope, scarp, bareland, waterline),
        "factors": [
            base["summary"],
            f"坝体占比 {dam:.2f}%，用于判断堤坝结构是否在当前场景中占据主要位置。",
            f"边坡占比 {slope:.2f}%，用于反映坡面稳定性关注程度。",
            f"陡坎占比 {scarp:.2f}%，通常与岸坡失稳、局部坍塌相关。",
            f"裸地占比 {bareland:.2f}%，可用于观察冲刷、退化和暴露地表。",
            f"水边线占比 {waterline:.2f}%，提示临水边界压力。",
            f"居民地/道路暴露 {assets:.2f}%，提示岸坡附近目标受影响程度。",
        ],
        "actions": _build_embankment_actions(level, dam, slope, scarp),
    }


def _score_embankment_risk(metrics: dict) -> dict:
    ratios = metrics["ratios"]
    counts = metrics["counts"]

    dam = ratios["dam_ratio"]
    slope = ratios["slope_ratio"]
    scarp = ratios["scarp_ratio"]
    bareland = ratios["bareland_ratio"]
    waterline = ratios["waterline_ratio"]
    assets = ratios["asset_ratio"]

    score = clamp_value(
        dam * 0.26
        + slope * 0.18
        + scarp * 0.18
        + bareland * 0.16
        + waterline * 0.12
        + assets * 0.1,
        0,
        100,
    )
    if counts["dam"] < MIN_COUNT_GATES["dam"]:
        score *= 0.76
    if (counts["slope"] + counts["scarp"]) < MIN_COUNT_GATES["slope"]:
        score *= 0.82

    if score >= 75:
        level = "high"
    elif score >= 48:
        level = "medium"
    else:
        level = "low"

    return {
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "score": int(round(score)),
        "summary": (
            f"堤坝岸坡风险由坝体、边坡/陡坎、裸地和临水边界共同决定，"
            f"当前关键组合为坝体 {dam:.2f}% 与边坡/陡坎 {(slope + scarp):.2f}%。"
        ),
        "factors": [
            {"name": "坝体占比", "value": round(dam, 2), "unit": "%"},
            {"name": "边坡占比", "value": round(slope, 2), "unit": "%"},
            {"name": "陡坎占比", "value": round(scarp, 2), "unit": "%"},
            {"name": "裸地占比", "value": round(bareland, 2), "unit": "%"},
            {"name": "水边线占比", "value": round(waterline, 2), "unit": "%"},
        ],
    }


def generate_inspection_alerts(labels: np.ndarray) -> list[dict]:
    """Backward-compatible helper."""
    return generate_inspection_report(labels)["alerts"]


def _build_ratio_data(labels: np.ndarray) -> tuple[int, dict[int, int], dict[int, float]]:
    total = int(labels.shape[0])
    unique, counts = np.unique(labels.astype(int), return_counts=True)
    label_counts = {int(u): int(c) for u, c in zip(unique, counts)}
    ratios = {
        class_id: (label_counts.get(class_id, 0) / total * 100) if total > 0 else 0.0
        for class_id in range(NUM_CLASSES)
    }
    return total, label_counts, ratios


def _level_from_thresholds(value: float, thresholds: dict[str, float]) -> tuple[str | None, int]:
    if value >= thresholds["high"]:
        return "high", _score_within_level(value, thresholds, "high")
    if value >= thresholds["medium"]:
        return "medium", _score_within_level(value, thresholds, "medium")
    if value >= thresholds["low"]:
        return "low", _score_within_level(value, thresholds, "low")
    return None, 0


def _score_within_level(value: float, thresholds: dict[str, float], level: str) -> int:
    if level == "high":
        start = thresholds["high"]
        end = max(start + (thresholds["high"] - thresholds["medium"]), start + 1)
    elif level == "medium":
        start = thresholds["medium"]
        end = max(thresholds["high"], start + 1)
    else:
        start = thresholds["low"]
        end = max(thresholds["medium"], start + 1)

    ratio = 0 if value <= start else min((value - start) / (end - start), 1)
    base = LEVEL_SCORE_FLOOR[level]
    span = 14
    return int(round(base + span * ratio))


def _build_alert(
    *,
    code: str,
    title: str,
    level: str,
    score: int,
    message: str,
    reason: str,
    suggestion: str,
    metric_name: str,
    metric_value: float,
    point_count: int,
) -> dict:
    return {
        "code": code,
        "title": title,
        "class_name_cn": title,
        "class_name": code,
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "score": int(score),
        "message": message,
        "reason": reason,
        "suggestion": suggestion,
        "metric_name": metric_name,
        "metric_value": round(metric_value, 2),
        "metric_unit": "%",
        "point_count": int(point_count),
        "ratio": round(metric_value, 2),
    }


def _build_overall_summary(alerts: list[dict]) -> dict:
    if not alerts:
        return {
            "level": "normal",
            "level_label": LEVEL_LABELS["normal"],
            "score": 18,
            "title": "当前场景整体风险较低",
            "message": "未发现超过数据集基线阈值的高占比风险组合，可按常规周期巡检。",
        }

    top = alerts[0]
    weighted_scores = [item["score"] * weight for item, weight in zip(alerts[:3], (1.0, 0.4, 0.22))]
    overall_score = min(int(round(sum(weighted_scores))), 100)
    high_count = sum(1 for item in alerts if item["level"] == "high")
    if high_count >= 2:
        overall_score = max(overall_score, 88)
    elif top["level"] == "high":
        overall_score = max(overall_score, 82)
    elif top["level"] == "medium" and len(alerts) >= 3:
        overall_score = max(overall_score, 66)

    if overall_score >= 85:
        level = "high"
    elif overall_score >= 60:
        level = "medium"
    else:
        level = "low"

    return {
        "level": level,
        "level_label": LEVEL_LABELS[level],
        "score": overall_score,
        "title": f"当前场景总体判定为{LEVEL_LABELS[level]}",
        "message": f"主导风险为“{top['title']}”，建议优先处理该类区域，并结合其余告警安排复核顺序。",
    }


def _build_recommendations(alerts: list[dict]) -> list[str]:
    if not alerts:
        return [
            "当前场景未触发高占比风险组合，可保持常规巡查频率。",
            "建议后续叠加时序点云或水位数据，提升趋势性预警能力。",
        ]

    recommendations = []
    for alert in alerts:
        suggestion = alert.get("suggestion")
        if suggestion and suggestion not in recommendations:
            recommendations.append(suggestion)
    return recommendations[:4]


def _build_flood_summary(level: str, water_pressure: float, rainfall: float, flood_exposure: float) -> str:
    if level == "red":
        return "综合水位、降雨和点云暴露目标占比，当前防洪风险很高，需要立即复核。"
    if level == "orange":
        return "当前存在明显防洪压力，建议提高巡查频率并关注重点风险区域。"
    if level == "yellow":
        return "当前达到关注阈值，建议持续观察水位、降雨和滨水暴露目标变化。"
    return (
        f"当前整体风险较低，水位接近度 {min(water_pressure, 100):.0f}%，"
        f"24h 降雨 {float(rainfall):.0f} mm，滨水暴露指数 {float(flood_exposure):.1f}%。"
    )


def _build_flood_actions(level: str, drainage_status: str) -> list[str]:
    actions = {
        "red": [
            "立即组织重点区巡查，优先核查水边线附近居民地、道路和坝体区域。",
            "启动防汛值守和现场复核，必要时设置临时警戒或绕行路线。",
        ],
        "orange": [
            "提高巡查频率，重点关注沟渠排水、岸坡冲刷和低洼通行区域。",
            "结合雨情和水位变化，准备抢险物资和人员调度方案。",
        ],
        "yellow": [
            "安排常规加密巡查，复核水边线、沟渠和裸地异常区域。",
            "持续观察未来降雨和水位接近度，必要时升级预警等级。",
        ],
        "blue": [
            "保持常规巡查，记录当前点云分析结果作为后续时序对比基线。",
        ],
    }[level]

    if drainage_status != "normal":
        actions.append("优先检查沟渠是否存在淤积、堵塞、断面收窄或排水不畅。")
    return actions


def _build_embankment_summary(level: str, dam: float, slope: float, scarp: float, bareland: float, waterline: float) -> str:
    if level == "high":
        return f"当前堤坝岸坡隐患较高，坝体 {dam:.2f}%，边坡/陡坎 {(slope + scarp):.2f}%，建议优先复核。"
    if level == "medium":
        return f"当前堤坝岸坡存在中等风险，坝体 {dam:.2f}%，裸地 {bareland:.2f}%，需关注坡脚和临水区域。"
    return f"当前岸坡整体风险较低，坝体 {dam:.2f}%，水边线 {waterline:.2f}%，可作为常规巡检基线。"


def _build_embankment_actions(level: str, dam: float, slope: float, scarp: float) -> list[str]:
    actions = {
        "high": [
            "立即核查坝体、坡脚、坡面裂缝、渗漏和局部坍塌。",
            "优先安排人工复核和重点点位拍照留档。",
        ],
        "medium": [
            "加密巡查堤坝临水侧和岸坡裸露区域。",
            "结合降雨和水位变化，观察坡面稳定性是否继续恶化。",
        ],
        "low": [
            "保持常规巡查并记录当前结果作为后续对比基线。",
        ],
    }[level]

    if dam > 0:
        actions.append("坝体存在时，重点检查坝肩、坝脚和临水坡面。")
    if slope + scarp > 0:
        actions.append("边坡或陡坎占比升高时，优先关注滑移和冲刷迹象。")
    return actions


def clamp_value(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))
