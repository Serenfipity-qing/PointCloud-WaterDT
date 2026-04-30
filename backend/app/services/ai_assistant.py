"""OpenAI-backed assistant service for analysis Q&A."""
from __future__ import annotations

import json
from urllib import error, request

from ..config import load_ai_settings


QUESTION_HINTS = {
    "most-dangerous": "请重点回答当前哪里最危险，引用最高风险项、风险分数和对应原因。",
    "why-dangerous": "请重点回答为什么危险，结合巡检告警原因和指标值解释。",
    "what-check-first": "请重点回答建议优先检查什么，给出 3 条以内可执行建议。",
    "summary": "请给出整体巡检总结，包含总体风险等级、主要风险项和下一步建议。",
}


def ask_analysis_assistant(*, question: str, analysis_context: dict, question_type: str | None = None) -> dict:
    settings = load_ai_settings()
    _validate_settings(settings)

    payload = {
        "model": settings["model"],
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": settings["system_prompt"],
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": _build_user_prompt(
                            question=question,
                            analysis_context=analysis_context,
                            question_type=question_type,
                        ),
                    }
                ],
            },
        ],
    }

    raw = _post_json(settings, payload)

    data = json.loads(raw)
    answer = _extract_response_text(data)
    if not answer:
        raise RuntimeError("OpenAI returned an empty answer")

    return {
        "answer": answer,
        "model": data.get("model", settings["model"]),
        "provider": settings["provider"],
    }


def stream_analysis_assistant(*, question: str, analysis_context: dict, question_type: str | None = None):
    settings = load_ai_settings()
    _validate_settings(settings)

    payload = {
        "model": settings["model"],
        "stream": True,
        "input": [
            {
                "role": "system",
                "content": [
                    {
                        "type": "input_text",
                        "text": settings["system_prompt"],
                    }
                ],
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": _build_user_prompt(
                            question=question,
                            analysis_context=analysis_context,
                            question_type=question_type,
                        ),
                    }
                ],
            },
        ],
    }

    body = json.dumps(payload).encode("utf-8")
    req = _build_request(settings, body)

    try:
        with request.urlopen(req, timeout=120) as resp:
            data_lines: list[str] = []
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="ignore")
                if line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                    continue
                if line.strip():
                    continue
                if not data_lines:
                    continue

                event_data = "\n".join(data_lines)
                data_lines = []
                if event_data == "[DONE]":
                    break
                event = json.loads(event_data)
                event_type = event.get("type")
                if event_type == "response.output_text.delta":
                    delta = event.get("delta", "")
                    if delta:
                        yield delta
                elif event_type == "error":
                    message = (event.get("error") or {}).get("message") or "OpenAI stream error"
                    raise RuntimeError(message)
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"OpenAI connection failed: {exc.reason}") from exc


def _build_user_prompt(*, question: str, analysis_context: dict, question_type: str | None) -> str:
    hint = QUESTION_HINTS.get(question_type or "", "请直接回答用户问题。")
    context_json = json.dumps(analysis_context, ensure_ascii=False, indent=2)
    return (
        f"用户问题：{question}\n"
        f"回答要求：{hint}\n"
        "请严格基于以下分析上下文回答，不要编造没有提供的数据。\n"
        "如果上下文中存在 overall_summary、top_alert、top_alerts、risk_regions，请优先引用它们。\n"
        "当用户询问“哪里最危险”“为什么危险”“建议先查什么”时：\n"
        "1. 必须优先引用 top_alert 或 top_alerts 中的风险项名称、风险分数、原因、建议、指标值。\n"
        "2. 如果 top_alert 中已有 score、reason、metric_name、metric_value，就不要再说“数据不足”。\n"
        "3. 如果存在 top_region 或 top_regions，请补充其综合空间评分、点数密度、影响范围，并与 top_alert 结合判断“哪里最危险”。\n"
        "4. 如果存在对应 risk_regions，请补充区域名称、涉及类别和点数规模。\n"
        "5. fallback_regions 仅用于补充空间定位，不能覆盖或推翻 top_alert/top_alerts 的主风险结论。\n"
        "只有在这些关键字段都缺失时，才允许明确指出数据不足。\n\n"
        f"分析上下文：\n{context_json}"
    )


def _extract_response_text(data: dict) -> str:
    output_text = data.get("output_text")
    if isinstance(output_text, str) and output_text.strip():
        return output_text.strip()

    parts: list[str] = []
    for item in data.get("output", []) or []:
        for content in item.get("content", []) or []:
            text = content.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
    return "\n\n".join(parts).strip()


def _validate_settings(settings: dict) -> None:
    if not settings.get("enabled"):
        raise ValueError("AI assistant is disabled in ai_settings.json")
    if settings.get("provider") != "openai":
        raise ValueError("Only OpenAI provider is currently supported")
    if not settings.get("api_key"):
        raise ValueError("Missing api_key in ai_settings.json")


def _build_request(settings: dict, body: bytes) -> request.Request:
    base_url = settings["base_url"].rstrip("/")
    return request.Request(
        url=f"{base_url}/responses",
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {settings['api_key']}",
        },
    )


def _post_json(settings: dict, payload: dict) -> str:
    body = json.dumps(payload).encode("utf-8")
    req = _build_request(settings, body)
    try:
        with request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8")
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"OpenAI HTTP {exc.code}: {detail}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"OpenAI connection failed: {exc.reason}") from exc
