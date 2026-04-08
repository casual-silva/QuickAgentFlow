import uuid
from datetime import datetime
from typing import List, Optional, Tuple

from sqlmodel import Session, func, select

from ..models.template import TemplateCreate, WorkflowTemplate


class TemplateRepository:
    def list(self, session: Session) -> List[WorkflowTemplate]:
        return list(session.exec(select(WorkflowTemplate).order_by(WorkflowTemplate.updated_at.desc())).all())

    def list_paginated(
        self,
        session: Session,
        *,
        page: int,
        page_size: int,
        keyword: Optional[str] = None,
    ) -> Tuple[List[WorkflowTemplate], int]:
        kw = (keyword or "").strip()
        stmt = select(WorkflowTemplate)
        count_stmt = select(func.count()).select_from(WorkflowTemplate)
        if kw:
            like_kw = f"%{kw}%"
            cond = (WorkflowTemplate.name.ilike(like_kw)) | (WorkflowTemplate.description.ilike(like_kw))
            stmt = stmt.where(cond)
            count_stmt = count_stmt.where(cond)
        total = int(session.exec(count_stmt).one())
        rows = list(
            session.exec(
                stmt.order_by(WorkflowTemplate.updated_at.desc())
                .offset(max(0, (page - 1) * page_size))
                .limit(page_size)
            ).all()
        )
        return rows, total

    def get(self, session: Session, template_id: str) -> Optional[WorkflowTemplate]:
        return session.get(WorkflowTemplate, template_id)

    def create(self, session: Session, payload: TemplateCreate, graph_json: str) -> WorkflowTemplate:
        now = datetime.utcnow()
        row = WorkflowTemplate(
            id=str(uuid.uuid4()),
            name=payload.name,
            description=payload.description,
            graph_json=graph_json,
            source_workflow_id=payload.source_workflow_id,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    def update(
        self,
        session: Session,
        template_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Optional[WorkflowTemplate]:
        row = self.get(session, template_id)
        if row is None:
            return None
        if name is not None:
            row.name = name
        if description is not None:
            row.description = description
        row.updated_at = datetime.utcnow()
        session.add(row)
        session.commit()
        session.refresh(row)
        return row

    def delete(self, session: Session, template_id: str) -> bool:
        row = self.get(session, template_id)
        if row is None:
            return False
        session.delete(row)
        session.commit()
        return True
