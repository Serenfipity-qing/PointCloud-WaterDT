"""Export helpers."""
import csv
import io
import json
from datetime import datetime

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def export_json(points: np.ndarray, labels: np.ndarray, stats: dict, alerts: list, inspection: dict | None = None) -> str:
    """Export the full analysis result as JSON."""
    result = {
        "statistics": stats,
        "inspection_alerts": alerts,
        "inspection": inspection,
        "point_count": int(points.shape[0]),
    }
    return json.dumps(result, ensure_ascii=False, indent=2)


def export_csv(stats: dict) -> str:
    """Export aggregated semantic and business statistics."""
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["统计维度", "类别名称", "点数", "占比(%)"])

    for item in stats.get("class_stats", []):
        writer.writerow([
            "语义类别",
            item.get("name_cn", item.get("name", "")),
            item.get("count", 0),
            item.get("ratio", 0),
        ])

    for item in stats.get("business_stats", []):
        writer.writerow([
            "业务类别",
            item.get("name", ""),
            item.get("count", 0),
            item.get("ratio", 0),
        ])

    return output.getvalue()


def export_inspection_report(task: dict) -> str:
    inspection = task.get("inspection") or {}
    stats = task.get("statistics") or {}
    alerts = task.get("alerts") or []

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["自动巡检报告"])
    writer.writerow(["生成时间", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["文件名", task.get("filename", "")])
    writer.writerow(["文件ID", task.get("fileId", "")])
    writer.writerow([])
    writer.writerow(["总体研判", inspection.get("overall", {}).get("title", "")])
    writer.writerow(["总体等级", inspection.get("overall", {}).get("level_label", "")])
    writer.writerow(["总体分数", inspection.get("overall", {}).get("score", "")])
    writer.writerow(["总体说明", inspection.get("overall", {}).get("message", "")])
    writer.writerow([])
    writer.writerow(["统计概览"])
    writer.writerow(["总点数", stats.get("total_points", 0)])
    writer.writerow(["高风险告警数", sum(1 for item in alerts if item.get("level") == "high")])
    writer.writerow(["中低风险告警数", sum(1 for item in alerts if item.get("level") in {"medium", "low"})])
    writer.writerow([])
    writer.writerow(["风险明细", "等级", "分数", "指标", "数值", "建议"])
    for item in alerts:
        writer.writerow([
            item.get("title", ""),
            item.get("level_label", item.get("level", "")),
            item.get("score", ""),
            item.get("metric_name", ""),
            item.get("metric_value", ""),
            item.get("suggestion", ""),
        ])
    writer.writerow([])
    writer.writerow(["处置建议"])
    for suggestion in inspection.get("recommendations", []):
        writer.writerow([suggestion])

    return output.getvalue()


def build_inspection_report_context(task: dict) -> dict:
    inspection = task.get("inspection") or {}
    stats = task.get("statistics") or {}
    alerts = task.get("alerts") or []
    overall = inspection.get("overall") or {}
    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "filename": task.get("filename", ""),
        "file_id": task.get("fileId", ""),
        "overall": overall,
        "stats": stats,
        "alerts": alerts,
        "recommendations": inspection.get("recommendations", []),
    }


def build_inspection_report_text(context: dict) -> str:
    lines = []
    lines.append("自动巡检报告")
    lines.append(f"生成时间：{context.get('generated_at', '')}")
    lines.append(f"文件名：{context.get('filename', '')}")
    lines.append(f"文件ID：{context.get('file_id', '')}")
    lines.append("")
    overall = context.get("overall") or {}
    lines.append(f"总体研判：{overall.get('title', '')}")
    lines.append(f"总体等级：{overall.get('level_label', '')}")
    lines.append(f"总体分数：{overall.get('score', '')}")
    lines.append(f"总体说明：{overall.get('message', '')}")
    lines.append("")
    lines.append("风险明细：")
    for item in context.get("alerts", []):
        lines.append(
            f"- {item.get('title', '')} | {item.get('level_label', item.get('level', ''))} | "
            f"{item.get('metric_name', '')} {item.get('metric_value', '')} | 建议：{item.get('suggestion', '')}"
        )
    lines.append("")
    lines.append("处置建议：")
    for suggestion in context.get("recommendations", []):
        lines.append(f"- {suggestion}")
    return "\n".join(lines).strip() + "\n"


def build_inspection_report_pdf(context: dict) -> bytes:
    width, height = 1240, 1754
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    font = _load_font(24)
    bold = _load_font(30, bold=True)

    y = 60
    margin = 70
    draw.text((margin, y), "自动巡检报告", fill="black", font=bold)
    y += 60

    sections = [
        f"生成时间：{context.get('generated_at', '')}",
        f"文件名：{context.get('filename', '')}",
        f"文件ID：{context.get('file_id', '')}",
        "",
        f"总体研判：{context.get('overall', {}).get('title', '')}",
        f"总体等级：{context.get('overall', {}).get('level_label', '')}",
        f"总体分数：{context.get('overall', {}).get('score', '')}",
        f"总体说明：{context.get('overall', {}).get('message', '')}",
        "",
        "风险明细：",
    ]

    for line in sections:
        y = _draw_wrapped_line(draw, line, margin, y, width - margin * 2, font)

    for item in context.get("alerts", []):
        line = (
            f"- {item.get('title', '')} | {item.get('level_label', item.get('level', ''))} | "
            f"{item.get('metric_name', '')} {item.get('metric_value', '')} | 建议：{item.get('suggestion', '')}"
        )
        y = _draw_wrapped_line(draw, line, margin, y, width - margin * 2, font)

    y += 10
    y = _draw_wrapped_line(draw, "处置建议：", margin, y, width - margin * 2, font)
    for suggestion in context.get("recommendations", []):
        y = _draw_wrapped_line(draw, f"- {suggestion}", margin, y, width - margin * 2, font)

    pdf_bytes = io.BytesIO()
    image.save(pdf_bytes, format="PDF")
    return pdf_bytes.getvalue()


def build_inspection_report_docx(context: dict) -> bytes:
    return _build_minimal_docx(build_inspection_report_text(context))


def _draw_wrapped_line(draw, text, x, y, max_width, font, line_gap=10):
    if not text:
        return y + 10

    buffer = ""
    for char in text:
        test = buffer + char
        if draw.textlength(test, font=font) > max_width and buffer:
            draw.text((x, y), buffer, fill="black", font=font)
            y += font.size + line_gap
            buffer = char
        else:
            buffer = test
    if buffer:
        draw.text((x, y), buffer, fill="black", font=font)
        y += font.size + line_gap
    return y


def _load_font(size: int, bold: bool = False):
    candidates = [
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


def _build_minimal_docx(text: str) -> bytes:
    from xml.sax.saxutils import escape
    from zipfile import ZipFile, ZIP_DEFLATED

    content_lines = []
    for line in text.splitlines():
        if not line.strip():
            content_lines.append("<w:p/>")
            continue
        content_lines.append(
            "<w:p><w:r><w:t xml:space=\"preserve\">"
            + escape(line)
            + "</w:t></w:r></w:p>"
        )
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:body>' + "".join(content_lines) +
        '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>'
        '</w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )

    out = io.BytesIO()
    with ZipFile(out, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document_xml)
    return out.getvalue()
