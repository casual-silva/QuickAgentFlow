import json
from typing import List, Optional

from fastapi import HTTPException
from sqlmodel import Session

from ..models.template import PaginatedTemplates, TemplateApplyRequest, TemplateCreate, TemplateRead, TemplateUpdate
from ..models.workflow import WorkflowCreate, WorkflowGraph
from ..repositories.template_repo import TemplateRepository
from ..repositories.workflow_repo import WorkflowRepository


class TemplateService:
    def __init__(self, template_repo: TemplateRepository, workflow_repo: WorkflowRepository) -> None:
        self.template_repo = template_repo
        self.workflow_repo = workflow_repo

    def list_templates(self, session: Session) -> List[TemplateRead]:
        rows = self.template_repo.list(session)
        return [self._to_read(row) for row in rows]

    def list_templates_paginated(
        self,
        session: Session,
        *,
        page: int,
        page_size: int,
        keyword: Optional[str] = None,
    ) -> PaginatedTemplates:
        rows, total = self.template_repo.list_paginated(session, page=page, page_size=page_size, keyword=keyword)
        return PaginatedTemplates(
            items=[self._to_read(row) for row in rows],
            total=total,
            page=page,
            page_size=page_size,
        )

    def create_from_workflow(self, session: Session, payload: TemplateCreate) -> TemplateRead:
        workflow = self.workflow_repo.get(session, payload.source_workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="source workflow not found")
        row = self.template_repo.create(session, payload=payload, graph_json=workflow.graph_json)
        return self._to_read(row)

    def apply_template(self, session: Session, template_id: str, payload: TemplateApplyRequest):
        template = self.template_repo.get(session, template_id)
        if template is None:
            raise HTTPException(status_code=404, detail="template not found")
        graph = WorkflowGraph.model_validate(json.loads(template.graph_json))
        workflow = self.workflow_repo.create(
            session,
            WorkflowCreate(
                name=payload.name,
                description=f"from template: {template.name}",
                graph=graph,
                status=payload.status,
            ),
        )
        return workflow

    def update_template(self, session: Session, template_id: str, payload: TemplateUpdate) -> TemplateRead:
        name = payload.name.strip() if payload.name is not None else None
        if payload.name is not None and not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        row = self.template_repo.update(
            session,
            template_id,
            name=name,
            description=payload.description if payload.description is not None else None,
        )
        if row is None:
            raise HTTPException(status_code=404, detail="template not found")
        return self._to_read(row)

    def delete_template(self, session: Session, template_id: str) -> None:
        ok = self.template_repo.delete(session, template_id)
        if not ok:
            raise HTTPException(status_code=404, detail="template not found")

    @staticmethod
    def _to_read(row) -> TemplateRead:
        return TemplateRead(
            id=row.id,
            name=row.name,
            description=row.description,
            graph=json.loads(row.graph_json),
            source_workflow_id=row.source_workflow_id,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
