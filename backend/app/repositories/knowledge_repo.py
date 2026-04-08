"""知识库持久化：与执行 Handler 解耦，仅负责 CRUD。"""

from __future__ import annotations

import json
import uuid
from typing import Any, Dict, List, Optional

from sqlmodel import Session, func, select

from ..models.knowledge import KnowledgeBase, KnowledgeChunk, KnowledgeChunkRead


class KnowledgeRepository:
    def create_base(self, session: Session, name: str, description: str = "") -> KnowledgeBase:
        kb = KnowledgeBase(id=str(uuid.uuid4()), name=name.strip(), description=description or "")
        session.add(kb)
        session.commit()
        session.refresh(kb)
        return kb

    def list_bases(self, session: Session) -> List[KnowledgeBase]:
        statement = select(KnowledgeBase).order_by(KnowledgeBase.created_at.desc())
        return list(session.exec(statement).all())

    def chunk_counts_by_base(self, session: Session) -> Dict[str, int]:
        """各知识库文本块数量（一次聚合查询，供列表页与下拉展示）。"""
        statement = (
            select(KnowledgeChunk.knowledge_base_id, func.count(KnowledgeChunk.id))
            .group_by(KnowledgeChunk.knowledge_base_id)
        )
        rows = session.exec(statement).all()
        return {str(kb_id): int(cnt or 0) for kb_id, cnt in rows}

    def get_base(self, session: Session, kb_id: str) -> Optional[KnowledgeBase]:
        return session.get(KnowledgeBase, kb_id)

    def update_base(self, session: Session, kb_id: str, *, name: Optional[str] = None, description: Optional[str] = None) -> Optional[KnowledgeBase]:
        row = self.get_base(session, kb_id)
        if row is None:
            return None
        if name is not None:
            row.name = name.strip()
        if description is not None:
            row.description = description or ""
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    def delete_base(self, session: Session, kb_id: str) -> bool:
        """删除知识库及其全部文本块。"""
        base = self.get_base(session, kb_id)
        if base is None:
            return False
        for c in self.list_chunks(session, kb_id):
            session.delete(c)
        session.delete(base)
        session.commit()
        return True

    def max_chunk_position(self, session: Session, knowledge_base_id: str) -> int:
        stmt = select(func.max(KnowledgeChunk.position)).where(KnowledgeChunk.knowledge_base_id == knowledge_base_id)
        v = session.exec(stmt).one()
        return int(v) if v is not None else -1

    def create_chunk(
        self,
        session: Session,
        knowledge_base_id: str,
        title: str,
        content: str,
        position: int = 0,
        *,
        embedding_json: Optional[str] = None,
        embedding_model: Optional[str] = None,
        meta_json: Optional[str] = None,
    ) -> KnowledgeChunk:
        row = KnowledgeChunk(
            knowledge_base_id=knowledge_base_id,
            title=title or "",
            content=content,
            position=position,
            embedding_json=embedding_json,
            embedding_model=embedding_model,
            meta_json=meta_json,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    def list_chunks(self, session: Session, knowledge_base_id: str) -> List[KnowledgeChunk]:
        statement = (
            select(KnowledgeChunk)
            .where(KnowledgeChunk.knowledge_base_id == knowledge_base_id)
            .order_by(KnowledgeChunk.position.asc(), KnowledgeChunk.id.asc())
        )
        return list(session.exec(statement).all())

    def get_chunk(self, session: Session, chunk_id: int) -> Optional[KnowledgeChunk]:
        return session.get(KnowledgeChunk, chunk_id)

    def update_chunk(
        self,
        session: Session,
        chunk_id: int,
        *,
        title: Optional[str] = None,
        content: Optional[str] = None,
        position: Optional[int] = None,
        clear_embedding: bool = False,
        embedding_json: Optional[str] = None,
        embedding_model: Optional[str] = None,
        meta_json: Optional[str] = None,
        set_embedding: Optional[tuple[str, str]] = None,
    ) -> Optional[KnowledgeChunk]:
        """set_embedding 为 (embedding_json, embedding_model) 时强制写入向量；与 clear_embedding 互斥优先 clear。"""
        row = self.get_chunk(session, chunk_id)
        if row is None:
            return None
        if title is not None:
            row.title = title
        if content is not None:
            row.content = content
        if position is not None:
            row.position = int(position)
        if meta_json is not None:
            row.meta_json = meta_json
        if set_embedding is not None:
            row.embedding_json = set_embedding[0]
            row.embedding_model = set_embedding[1]
        elif clear_embedding:
            row.embedding_json = None
            row.embedding_model = None
        elif embedding_json is not None or embedding_model is not None:
            if embedding_json is not None:
                row.embedding_json = embedding_json
            if embedding_model is not None:
                row.embedding_model = embedding_model
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    def delete_chunk(self, session: Session, chunk_id: int) -> bool:
        row = session.get(KnowledgeChunk, chunk_id)
        if row is None:
            return False
        session.delete(row)
        session.commit()
        return True


def chunk_to_read(row: KnowledgeChunk) -> KnowledgeChunkRead:
    meta: Optional[Dict[str, Any]] = None
    if row.meta_json:
        try:
            meta = json.loads(row.meta_json)
        except json.JSONDecodeError:
            meta = {"_parse_error": True}
    return KnowledgeChunkRead(
        id=row.id or 0,
        knowledge_base_id=row.knowledge_base_id,
        title=row.title,
        content=row.content,
        position=row.position,
        created_at=row.created_at,
        has_embedding=bool(row.embedding_json and row.embedding_json.strip()),
        embedding_model=row.embedding_model,
        meta=meta,
    )
