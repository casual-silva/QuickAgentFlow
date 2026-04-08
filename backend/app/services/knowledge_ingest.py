"""知识库入库编排：分块 + QC 统计 + 可选批量向量化。"""

from __future__ import annotations

import json
from typing import List, Optional

from sqlmodel import Session

from ..core.settings import Settings
from ..models.knowledge import KnowledgeIngestResult, KnowledgeIngestTextRequest
from ..repositories.knowledge_repo import KnowledgeRepository
from .knowledge_chunking import prepare_chunks_for_ingest
from .knowledge_embeddings import embed_documents_batch


def ingest_text_into_base(
    session: Session,
    repo: KnowledgeRepository,
    kb_id: str,
    req: KnowledgeIngestTextRequest,
    *,
    source_filename: Optional[str] = None,
) -> KnowledgeIngestResult:
    """将长文本分块写入指定知识库，并可选写入 embedding。"""
    text = req.text.strip()
    if not text:
        return KnowledgeIngestResult(
            created_chunks=0,
            skipped_short=0,
            skipped_duplicate=0,
            embedding_ok=0,
            embedding_failed=0,
            warnings=["empty_text"],
            chunk_ids=[],
        )

    pieces, st = prepare_chunks_for_ingest(
        text,
        chunk_size=req.chunk_size,
        chunk_overlap=req.chunk_overlap,
        min_chunk_chars=req.min_chunk_chars,
        dedupe=req.dedupe,
    )

    warnings: List[str] = []
    settings = Settings()
    want_embed = bool(req.embed and (settings.openai_api_key or "").strip())
    if req.embed and not want_embed:
        warnings.append("embed_skipped_no_openai_api_key")

    vecs = embed_documents_batch(pieces) if want_embed and pieces else [None] * len(pieces)
    pos0 = repo.max_chunk_position(session, kb_id) + 1
    emb_model = settings.embedding_model if want_embed else None
    chunk_ids: List[int] = []
    emb_ok = 0
    emb_fail = 0
    prefix = req.title_prefix.strip()

    for i, body in enumerate(pieces):
        title = f"{prefix} #{i + 1}".strip() if prefix else f"分段 {i + 1}"
        meta = {
            "chunk_index": i,
            "char_count": len(body),
            "source_filename": source_filename,
            "ingest": "auto_split",
        }
        vec = vecs[i] if i < len(vecs) else None
        ej = json.dumps(vec) if vec else None
        if want_embed:
            if vec:
                emb_ok += 1
            else:
                emb_fail += 1
        row = repo.create_chunk(
            session,
            knowledge_base_id=kb_id,
            title=title,
            content=body,
            position=pos0 + i,
            embedding_json=ej,
            embedding_model=emb_model if vec else None,
            meta_json=json.dumps(meta, ensure_ascii=False),
        )
        chunk_ids.append(int(row.id or 0))

    return KnowledgeIngestResult(
        created_chunks=len(chunk_ids),
        skipped_short=int(st["skipped_short"]),
        skipped_duplicate=int(st["skipped_duplicate"]),
        embedding_ok=emb_ok,
        embedding_failed=emb_fail,
        warnings=warnings,
        chunk_ids=chunk_ids,
    )
