from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlmodel import Session

from ..db.session import get_session
from ..engine import validate_for_persistence
from ..models.workflow import WorkflowCreate, WorkflowGraph, WorkflowRead, WorkflowUpdate
from ..repositories.workflow_repo import WorkflowRepository
from ..services.workflow_service import WorkflowService

router = APIRouter(prefix="/api/workflows", tags=["workflows"])
service = WorkflowService(repo=WorkflowRepository())


class ValidateGraphResponse(BaseModel):
    ok: bool
    issues: list[str] = Field(default_factory=list)


@router.post("/validate-graph", response_model=ValidateGraphResponse)
def validate_graph_body(payload: WorkflowGraph) -> ValidateGraphResponse:
    """保存前校验：DAG、模板引用、节点配置等（不落库）。"""
    try:
        validate_for_persistence(payload)
        return ValidateGraphResponse(ok=True, issues=[])
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, list):
            return ValidateGraphResponse(ok=False, issues=[str(x) for x in detail])
        return ValidateGraphResponse(ok=False, issues=[str(detail)])


@router.get("", response_model=List[WorkflowRead])
def list_workflows(session: Session = Depends(get_session)) -> List[WorkflowRead]:
    return service.list_workflows(session)


@router.post("", response_model=WorkflowRead, status_code=status.HTTP_201_CREATED)
def create_workflow(payload: WorkflowCreate, session: Session = Depends(get_session)) -> WorkflowRead:
    return service.create_workflow(session, payload)


@router.get("/{workflow_id}", response_model=WorkflowRead)
def get_workflow(workflow_id: str, session: Session = Depends(get_session)) -> WorkflowRead:
    return service.get_workflow(session, workflow_id)


@router.put("/{workflow_id}", response_model=WorkflowRead)
def update_workflow(
    workflow_id: str,
    payload: WorkflowUpdate,
    session: Session = Depends(get_session),
) -> WorkflowRead:
    return service.update_workflow(session, workflow_id, payload)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow(workflow_id: str, session: Session = Depends(get_session)) -> Response:
    service.delete_workflow(session, workflow_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
