from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from ..db.session import get_session
from ..models.template import PaginatedTemplates, TemplateApplyRequest, TemplateCreate, TemplateRead, TemplateUpdate
from ..models.workflow import WorkflowRead
from ..repositories.template_repo import TemplateRepository
from ..repositories.workflow_repo import WorkflowRepository
from ..services.template_service import TemplateService
from ..services.workflow_service import WorkflowService

router = APIRouter(prefix="/api/templates", tags=["templates"])
template_service = TemplateService(template_repo=TemplateRepository(), workflow_repo=WorkflowRepository())
workflow_service = WorkflowService(repo=WorkflowRepository())


@router.get("", response_model=List[TemplateRead])
def list_templates(session: Session = Depends(get_session)) -> List[TemplateRead]:
    return template_service.list_templates(session)


@router.get("/paginated", response_model=PaginatedTemplates)
def list_templates_paginated(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, ge=1, le=50),
    keyword: Optional[str] = Query(default=None),
    session: Session = Depends(get_session),
) -> PaginatedTemplates:
    return template_service.list_templates_paginated(session, page=page, page_size=page_size, keyword=keyword)


@router.post("", response_model=TemplateRead, status_code=status.HTTP_201_CREATED)
def create_template(payload: TemplateCreate, session: Session = Depends(get_session)) -> TemplateRead:
    return template_service.create_from_workflow(session, payload)


@router.post("/{template_id}/apply", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
def apply_template(
    template_id: str,
    payload: TemplateApplyRequest,
    session: Session = Depends(get_session),
) -> WorkflowRead:
    workflow = template_service.apply_template(session, template_id, payload)
    return workflow_service.get_workflow(session, workflow.id)


@router.patch("/{template_id}", response_model=TemplateRead)
def update_template(
    template_id: str,
    payload: TemplateUpdate,
    session: Session = Depends(get_session),
) -> TemplateRead:
    return template_service.update_template(session, template_id, payload)


@router.delete("/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(template_id: str, session: Session = Depends(get_session)) -> None:
    template_service.delete_template(session, template_id)
