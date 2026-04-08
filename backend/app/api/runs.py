from typing import List
import json

from fastapi import APIRouter, BackgroundTasks, Depends, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from ..db.session import get_session, session_scope
from ..engine import WorkflowRunner
from ..models.run import DebugStepRequest, DebugStepResponse, PaginatedRuns, ResumeRunRequest, RunCreate, RunLogRead, RunRead
from ..models.trace import RunTraceRead
from ..repositories.run_repo import RunRepository
from ..repositories.workflow_repo import WorkflowRepository
from ..services.run_service import RunService

router = APIRouter(tags=["runs"])
service = RunService(
    run_repo=RunRepository(),
    workflow_repo=WorkflowRepository(),
    runner=WorkflowRunner(),
)


@router.post("/api/workflows/{workflow_id}/run", response_model=RunRead, status_code=status.HTTP_201_CREATED)
def create_run(
    workflow_id: str,
    payload: RunCreate,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
) -> RunRead:
    run = service.create_run(session, workflow_id, payload)

    def _execute_background(run_id: str) -> None:
        # 核心执行在后台进行，避免阻塞 HTTP 请求线程。
        with session_scope() as bg_session:
            service.execute_run(bg_session, run_id)

    background_tasks.add_task(_execute_background, run.id)
    return run


@router.get("/api/runs/{run_id}", response_model=RunRead)
def get_run(run_id: str, session: Session = Depends(get_session)) -> RunRead:
    return service.get_run(session, run_id)


@router.get("/api/runs", response_model=PaginatedRuns)
def list_runs(
    page: int = 1,
    page_size: int = 20,
    keyword: str = "",
    status_filter: str = "",
    session: Session = Depends(get_session),
) -> PaginatedRuns:
    return service.list_runs_paginated(
        session=session,
        page=max(1, page),
        page_size=max(1, min(page_size, 100)),
        keyword=keyword,
        status=status_filter,
    )


@router.get("/api/runs/{run_id}/logs", response_model=List[RunLogRead])
def list_run_logs(run_id: str, session: Session = Depends(get_session)) -> List[RunLogRead]:
    return service.list_logs(session, run_id)


@router.get("/api/runs/{run_id}/trace", response_model=List[RunTraceRead])
def list_run_trace(run_id: str, session: Session = Depends(get_session)) -> List[RunTraceRead]:
    """结构化执行轨迹（MCP/知识库等），与节点 RunLog 互补。"""
    return service.list_run_traces(session, run_id)


@router.post("/api/workflows/{workflow_id}/debug/step", response_model=DebugStepResponse)
def workflow_debug_step(
    workflow_id: str,
    payload: DebugStepRequest,
    session: Session = Depends(get_session),
) -> DebugStepResponse:
    """单步执行下一节点（与全图路由一致），用于编辑器调试。"""
    return service.debug_step(session, workflow_id, payload)


@router.get("/api/workflows/{workflow_id}/runs", response_model=List[RunRead])
def list_runs_by_workflow(
    workflow_id: str,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> List[RunRead]:
    return service.list_runs_by_workflow(session, workflow_id=workflow_id, limit=limit)


@router.post("/api/workflows/{workflow_id}/resume/stream")
def resume_stream_run(
    workflow_id: str,
    payload: ResumeRunRequest,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    """中文注释：断点续跑——从指定节点恢复流式执行。"""
    events = service.stream_resume(session, workflow_id=workflow_id, payload=payload)

    def event_generator():
        for item in events:
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/api/workflows/{workflow_id}/chat/stream")
def chat_stream_run(
    workflow_id: str,
    payload: RunCreate,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    events = service.stream_run(session, workflow_id=workflow_id, payload=payload)

    def event_generator():
        for item in events:
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
