"""文档解析：纯文本 / Markdown / PDF（页文本拼接）。"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Tuple


def extract_text_from_upload(filename: str, raw: bytes) -> Tuple[str, str]:
    """
    从上传字节解析纯文本。
    返回 (text, format_label)；不支持的后缀抛 ValueError。
    """
    ext = Path(filename or "").suffix.lower()
    if ext in (".txt", ".md", ".markdown"):
        return raw.decode("utf-8", errors="replace"), ext.lstrip(".") or "text"
    if ext == ".pdf":
        return _extract_pdf(raw), "pdf"
    raise ValueError(f"unsupported_file_type:{ext or 'none'}")


def _extract_pdf(raw: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise ValueError("pdf_support_missing_install_pypdf") from e
    reader = PdfReader(io.BytesIO(raw))
    parts: list[str] = []
    for page in reader.pages:
        t = page.extract_text()
        if t:
            parts.append(t)
    return "\n\n".join(parts).strip()
