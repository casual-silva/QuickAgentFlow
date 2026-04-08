"""智能分块：段落优先 + 滑窗，适配中英混排（不依赖向量模型）。"""

from __future__ import annotations

import re
from typing import Dict, List, Tuple


def split_text_to_chunks(text: str, chunk_size: int = 480, chunk_overlap: int = 72) -> List[str]:
    """将长文本切成多块：先按空行分段，再按单行，再对超长段做带重叠滑窗。"""
    text = (text or "").strip()
    if not text:
        return []
    text = re.sub(r"\r\n?", "\n", text)
    if len(text) <= chunk_size:
        return [text]
    paras = [p.strip() for p in re.split(r"\n\s*\n+", text) if p.strip()]
    if not paras:
        paras = [text]
    pieces: List[str] = []
    for para in paras:
        if len(para) <= chunk_size:
            pieces.append(para)
            continue
        lines = [s.strip() for s in para.split("\n") if s.strip()]
        if len(lines) > 1:
            for line in lines:
                pieces.extend(_sliding_chunks(line, chunk_size, chunk_overlap))
        else:
            pieces.extend(_sliding_chunks(para, chunk_size, chunk_overlap))
    return [p for p in pieces if p.strip()]


def _sliding_chunks(s: str, chunk_size: int, overlap: int) -> List[str]:
    if len(s) <= chunk_size:
        return [s] if s.strip() else []
    out: List[str] = []
    start = 0
    n = len(s)
    while start < n:
        end = min(start + chunk_size, n)
        chunk = s[start:end].strip()
        if chunk:
            out.append(chunk)
        if end >= n:
            break
        start = max(end - overlap, start + max(1, chunk_size // 4))
    return out


def prepare_chunks_for_ingest(
    text: str,
    *,
    chunk_size: int,
    chunk_overlap: int,
    min_chunk_chars: int,
    dedupe: bool,
) -> Tuple[List[str], Dict[str, int]]:
    """分块 + 最短长度过滤 + 可选归一化去重。"""
    raw = split_text_to_chunks(text, chunk_size, chunk_overlap)
    stats = {"raw_count": len(raw), "skipped_short": 0, "skipped_duplicate": 0}
    seen: set[str] = set()
    out: List[str] = []
    for c in raw:
        if len(c) < min_chunk_chars:
            stats["skipped_short"] += 1
            continue
        key = re.sub(r"\s+", " ", c).strip().lower()
        if dedupe and key in seen:
            stats["skipped_duplicate"] += 1
            continue
        if dedupe:
            seen.add(key)
        out.append(c)
    return out, stats
