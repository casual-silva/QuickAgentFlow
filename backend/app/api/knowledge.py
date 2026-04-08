"""知识库 HTTP：管理端维护知识库与文本块；执行层通过 KnowledgeRetrieve 节点读库。"""

from __future__ import annotations

import json
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlmodel import Session

from ..core.settings import Settings
from ..db.session import get_session
from ..models.knowledge import (
    KnowledgeBaseCreate,
    KnowledgeBaseRead,
    KnowledgeBaseUpdate,
    KnowledgeChunkCreate,
    KnowledgeChunkRead,
    KnowledgeChunkUpdate,
    KnowledgeIngestResult,
    KnowledgeIngestTextRequest,
    KnowledgeRetrievalPreviewRequest,
    KnowledgeRetrievalPreviewResponse,
)
from ..repositories.knowledge_repo import KnowledgeRepository, chunk_to_read
from ..services.knowledge_document_extract import extract_text_from_upload
from ..services.knowledge_embeddings import embed_documents_batch
from ..services.knowledge_ingest import ingest_text_into_base
from ..services.knowledge_retrieval import query_preprocessing_explain, retrieve_multi_path_rerank

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])
_repo = KnowledgeRepository()


def _base_read(session: Session, row) -> KnowledgeBaseRead:
    counts = _repo.chunk_counts_by_base(session)
    return KnowledgeBaseRead(
        id=row.id,
        name=row.name,
        description=row.description,
        created_at=row.created_at,
        chunk_count=counts.get(row.id, 0),
    )


@router.get("/bases", response_model=List[KnowledgeBaseRead])
def list_knowledge_bases(session: Session = Depends(get_session)) -> List[KnowledgeBaseRead]:
    rows = _repo.list_bases(session)
    counts = _repo.chunk_counts_by_base(session)
    return [
        KnowledgeBaseRead(
            id=r.id,
            name=r.name,
            description=r.description,
            created_at=r.created_at,
            chunk_count=counts.get(r.id, 0),
        )
        for r in rows
    ]


@router.post("/bases", response_model=KnowledgeBaseRead, status_code=status.HTTP_201_CREATED)
def create_knowledge_base(
    payload: KnowledgeBaseCreate,
    session: Session = Depends(get_session),
) -> KnowledgeBaseRead:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="name required")
    row = _repo.create_base(session, name=payload.name.strip(), description=payload.description or "")
    return _base_read(session, row)


@router.patch("/bases/{kb_id}", response_model=KnowledgeBaseRead)
def update_knowledge_base(
    kb_id: str,
    payload: KnowledgeBaseUpdate,
    session: Session = Depends(get_session),
) -> KnowledgeBaseRead:
    if payload.name is not None and not str(payload.name).strip():
        raise HTTPException(status_code=400, detail="name cannot be empty")
    row = _repo.update_base(
        session,
        kb_id,
        name=str(payload.name).strip() if payload.name is not None else None,
        description=payload.description if payload.description is not None else None,
    )
    if row is None:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    return _base_read(session, row)


@router.delete("/bases/{kb_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge_base(kb_id: str, session: Session = Depends(get_session)) -> None:
    if not _repo.delete_base(session, kb_id):
        raise HTTPException(status_code=404, detail="knowledge base not found")


@router.get("/bases/{kb_id}/chunks", response_model=List[KnowledgeChunkRead])
def list_chunks(kb_id: str, session: Session = Depends(get_session)) -> List[KnowledgeChunkRead]:
    if _repo.get_base(session, kb_id) is None:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    rows = _repo.list_chunks(session, kb_id)
    return [chunk_to_read(r) for r in rows]


@router.post("/bases/{kb_id}/chunks", response_model=KnowledgeChunkRead, status_code=status.HTTP_201_CREATED)
def create_chunk(
    kb_id: str,
    payload: KnowledgeChunkCreate,
    session: Session = Depends(get_session),
) -> KnowledgeChunkRead:
    if _repo.get_base(session, kb_id) is None:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    if not str(payload.content or "").strip():
        raise HTTPException(status_code=400, detail="content required")
    row = _repo.create_chunk(
        session,
        knowledge_base_id=kb_id,
        title=payload.title or "",
        content=payload.content,
        position=int(payload.position or 0),
    )
    return chunk_to_read(row)


@router.patch("/chunks/{chunk_id}", response_model=KnowledgeChunkRead)
def update_chunk(
    chunk_id: int,
    payload: KnowledgeChunkUpdate,
    session: Session = Depends(get_session),
) -> KnowledgeChunkRead:
    row = _repo.get_chunk(session, chunk_id)
    if row is None:
        raise HTTPException(status_code=404, detail="chunk not found")
    title = payload.title if payload.title is not None else row.title
    content = str(payload.content).strip() if payload.content is not None else row.content
    position = int(payload.position) if payload.position is not None else row.position
    content_changed = payload.content is not None and content != row.content

    settings = Settings()
    api_key = (settings.openai_api_key or "").strip()
    clear_emb = False
    set_emb: tuple[str, str] | None = None
    if payload.refresh_embedding and api_key:
        vecs = embed_documents_batch([content])
        v = vecs[0] if vecs else None
        if v:
            set_emb = (json.dumps(v), settings.embedding_model)
        elif content_changed:
            clear_emb = True
    elif content_changed:
        # 正文变更后旧向量与语义不一致，未勾选「刷新向量」则清空
        clear_emb = True

    updated = _repo.update_chunk(
        session,
        chunk_id,
        title=title,
        content=content,
        position=position,
        clear_embedding=clear_emb,
        set_embedding=set_emb,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="chunk not found")
    return chunk_to_read(updated)


@router.post("/bases/{kb_id}/ingest-text", response_model=KnowledgeIngestResult)
def ingest_text(
    kb_id: str,
    payload: KnowledgeIngestTextRequest,
    session: Session = Depends(get_session),
) -> KnowledgeIngestResult:
    if _repo.get_base(session, kb_id) is None:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    return ingest_text_into_base(session, _repo, kb_id, payload, source_filename=None)


@router.post("/bases/{kb_id}/ingest-file", response_model=KnowledgeIngestResult)
async def ingest_file(
    kb_id: str,
    session: Session = Depends(get_session),
    file: UploadFile = File(...),
    chunk_size: int = Form(480),
    chunk_overlap: int = Form(72),
    min_chunk_chars: int = Form(20),
    dedupe: bool = Form(True),
    embed: bool = Form(True),
    title_prefix: str = Form(""),
) -> KnowledgeIngestResult:
    if _repo.get_base(session, kb_id) is None:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty file")
    try:
        text, _fmt = extract_text_from_upload(file.filename or "upload.txt", raw)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    req = KnowledgeIngestTextRequest(
        text=text,
        title_prefix=title_prefix or (file.filename or "").rsplit(".", 1)[0],
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        min_chunk_chars=min_chunk_chars,
        dedupe=dedupe,
        embed=embed,
    )
    return ingest_text_into_base(session, _repo, kb_id, req, source_filename=file.filename)


@router.delete("/chunks/{chunk_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chunk(chunk_id: int, session: Session = Depends(get_session)) -> None:
    if not _repo.delete_chunk(session, chunk_id):
        raise HTTPException(status_code=404, detail="chunk not found")


@router.post("/bases/{kb_id}/preview-retrieval", response_model=KnowledgeRetrievalPreviewResponse)
def preview_retrieval(
    kb_id: str,
    payload: KnowledgeRetrievalPreviewRequest,
    session: Session = Depends(get_session),
) -> KnowledgeRetrievalPreviewResponse:
    """单库检索预览：与画布「知识库检索」节点相同的召回与重排，便于调试权重与命中原因。"""
    if _repo.get_base(session, kb_id) is None:
        raise HTTPException(status_code=404, detail="knowledge base not found")
    q = payload.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="query required")
    hits, meta = retrieve_multi_path_rerank(
        session,
        kb_id,
        q,
        payload.top_k,
        rag_weights=payload.rag_weights,
        recall_pool_size=payload.recall_pool_size,
        include_breakdown=payload.include_score_breakdown,
    )
    explain = query_preprocessing_explain(q) if payload.include_query_explain else None
    return KnowledgeRetrievalPreviewResponse(
        knowledge_base_id=kb_id,
        query=q,
        chunks=hits,
        retrieval=meta,
        query_explain=explain,
    )


@router.post("/preview-retrieval", response_model=KnowledgeRetrievalPreviewResponse)
def preview_retrieval_all_bases(
    payload: KnowledgeRetrievalPreviewRequest,
    session: Session = Depends(get_session),
) -> KnowledgeRetrievalPreviewResponse:
    """全库检索预览：聚合所有知识库结果并按融合分排序，便于跨库检索调试。"""
    q = payload.query.strip()
    if not q:
        raise HTTPException(status_code=400, detail="query required")

    bases = _repo.list_bases(session)
    if not bases:
        return KnowledgeRetrievalPreviewResponse(
            knowledge_base_id="all",
            query=q,
            chunks=[],
            retrieval={"total_chunks": 0, "pool_ids_count": 0, "hit_count": 0, "scope": "all_bases"},
            query_explain=query_preprocessing_explain(q) if payload.include_query_explain else None,
        )

    base_name_map = {b.id: b.name for b in bases}
    merged_hits: list[dict] = []
    total_chunks = 0
    total_pool_ids = 0
    dense_active_any = False
    for base in bases:
        hits, meta = retrieve_multi_path_rerank(
            session,
            base.id,
            q,
            payload.top_k,
            rag_weights=payload.rag_weights,
            recall_pool_size=payload.recall_pool_size,
            include_breakdown=payload.include_score_breakdown,
        )
        total_chunks += int(meta.get("total_chunks", 0))
        total_pool_ids += int(meta.get("pool_ids_count", 0))
        dense_active_any = dense_active_any or bool(meta.get("dense_path_active"))
        for row in hits:
            merged_hits.append(
                {
                    **row,
                    "knowledge_base_id": base.id,
                    "knowledge_base_name": base_name_map.get(base.id, base.id),
                }
            )

    merged_hits.sort(key=lambda x: float(x.get("score", 0.0)), reverse=True)
    top = merged_hits[: payload.top_k]
    explain = query_preprocessing_explain(q) if payload.include_query_explain else None
    retrieval_meta = {
        "scope": "all_bases",
        "base_count": len(bases),
        "weights": payload.rag_weights or {},
        "recall_pool_size": payload.recall_pool_size,
        "total_chunks": total_chunks,
        "pool_ids_count": total_pool_ids,
        "hit_count": len(top),
        "dense_path_active": dense_active_any,
    }
    return KnowledgeRetrievalPreviewResponse(
        knowledge_base_id="all",
        query=q,
        chunks=top,
        retrieval=retrieval_meta,
        query_explain=explain,
    )
