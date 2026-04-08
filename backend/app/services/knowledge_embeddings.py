"""向量化：可选 OpenAI Embeddings；无密钥时返回 None，不阻断入库。"""

from __future__ import annotations

import logging
from typing import List, Optional

from ..core.settings import Settings

logger = logging.getLogger(__name__)


def _client():
    try:
        from openai import OpenAI
    except ImportError:
        return None
    s = Settings()
    if not (s.openai_api_key or "").strip():
        return None
    return OpenAI(api_key=s.openai_api_key.strip())


def embed_query_text(text: str) -> Optional[List[float]]:
    """单条查询向量；失败或无配置返回 None。"""
    text = (text or "").strip()
    if not text:
        return None
    cli = _client()
    if cli is None:
        return None
    s = Settings()
    model = (getattr(s, "embedding_model", None) or "text-embedding-3-small").strip()
    try:
        resp = cli.embeddings.create(model=model, input=text[:8000])
        return list(resp.data[0].embedding)
    except Exception as e:
        logger.warning("embed_query failed: %s", e)
        return None


def embed_documents_batch(texts: List[str]) -> List[Optional[List[float]]]:
    """批量文档向量；与 texts 等长；整批失败时该批均为 None。"""
    if not texts:
        return []
    cli = _client()
    if cli is None:
        return [None] * len(texts)
    s = Settings()
    model = (getattr(s, "embedding_model", None) or "text-embedding-3-small").strip()
    out: List[Optional[List[float]]] = [None] * len(texts)
    batch_size = 64
    for start in range(0, len(texts), batch_size):
        chunk = texts[start : start + batch_size]
        inputs = [t[:8000] for t in chunk]
        try:
            resp = cli.embeddings.create(model=model, input=inputs)
            for j, item in enumerate(resp.data):
                out[start + j] = list(item.embedding)
        except Exception as e:
            logger.warning("embed batch failed at %s: %s", start, e)
    return out
