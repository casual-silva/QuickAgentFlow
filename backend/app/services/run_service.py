import json
from typing import Any, Dict, List

from fastapi import HTTPException
from sqlmodel import Session

from ..engine import WorkflowRunner, validate_for_execution
from ..engine.observability.execution_trace import clear_execution_trace_sink, set_execution_trace_sink
from ..models.run import DebugStepRequest, DebugStepResponse, PaginatedRuns, ResumeRunRequest, RunCreate, RunLogRead, RunRead
from ..models.trace import RunTraceRead
from ..models.workflow import WorkflowGraph
from ..repositories.run_repo import RunRepository
from ..repositories.workflow_repo import WorkflowRepository


class RunService:
    def __init__(
        self,
        run_repo: RunRepository,
        workflow_repo: WorkflowRepository,
        runner: WorkflowRunner,
    ) -> None:
        self.run_repo = run_repo
        self.workflow_repo = workflow_repo
        self.runner = runner

    def create_run(self, session: Session, workflow_id: str, payload: RunCreate) -> RunRead:
        """创建运行记录并返回 run_id，执行由后台任务异步处理。"""
        workflow = self.workflow_repo.get(session, workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        graph = WorkflowGraph.model_validate(json.loads(workflow.graph_json))
        validate_for_execution(graph)
        run = self.run_repo.create(session, workflow_id, payload.input)
        return self._to_read(run)

    def execute_run(self, session: Session, run_id: str) -> None:
        """核心流程（中文注释）：
        1) 将 run 状态更新为 running
        2) 读取 workflow graph 并执行
        3) 写入逐节点日志
        4) 最终落库 success/failed
        """
        from ..engine.runtime.execution_fail_marker import clear_failed_nodes, pop_failed_node

        run = self.run_repo.get(session, run_id)
        if run is None:
            return
        workflow = self.workflow_repo.get(session, run.workflow_id)
        if workflow is None:
            self.run_repo.set_failed(session, run, "workflow not found")
            return

        graph = WorkflowGraph.model_validate(json.loads(workflow.graph_json))
        self.run_repo.set_running(session, run)

        clear_failed_nodes()
        clear_execution_trace_sink()
        trace_buf: List[Dict[str, Any]] = []
        set_execution_trace_sink(lambda t: trace_buf.append(dict(t)))
        try:
            validate_for_execution(graph)
            result = self.runner.run(graph.model_dump(), json.loads(run.input_json))
            self.run_repo.append_traces_batch(session, run.id, trace_buf, 0)
            self.run_repo.set_success(session, run, result["output"])
            for event in result["trace"]:
                out_payload = dict(event.get("output") or {})
                if event.get("usage"):
                    out_payload["token_usage"] = event["usage"]
                self.run_repo.add_log(
                    session=session,
                    run_id=run.id,
                    node_id=event["node_id"],
                    node_type=event["node_type"],
                    status="success",
                    input_payload=event["input"],
                    output_payload=out_payload,
                    duration_ms=event["duration_ms"],
                )
        except Exception as exc:
            try:
                self.run_repo.append_traces_batch(session, run.id, trace_buf, 0)
            except Exception:
                pass
            nid = pop_failed_node()
            if nid:
                ntype = "unknown"
                for n in graph.nodes:
                    if n.id == nid:
                        ntype = n.type
                        break
                self.run_repo.add_log(
                    session=session,
                    run_id=run.id,
                    node_id=nid,
                    node_type=ntype,
                    status="failed",
                    input_payload={},
                    output_payload={"error": str(exc)},
                    duration_ms=0,
                )
            self.run_repo.set_failed(session, run, str(exc))
        finally:
            clear_execution_trace_sink()

    def stream_run(self, session: Session, workflow_id: str, payload: RunCreate):
        """流式执行并返回事件迭代器。

        核心流程：
        1) 创建 run 并设置 running
        2) 逐节点产出事件给 SSE
        3) 同步写入 run_logs 与最终状态
        """
        workflow = self.workflow_repo.get(session, workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="workflow not found")

        graph = WorkflowGraph.model_validate(json.loads(workflow.graph_json))
        validate_for_execution(graph)
        run = self.run_repo.create(session, workflow_id, payload.input)
        self.run_repo.set_running(session, run)

        clear_execution_trace_sink()
        trace_buf: List[Dict[str, Any]] = []
        set_execution_trace_sink(lambda t: trace_buf.append(dict(t)))
        seq_holder: List[int] = [0]

        def _iter():
            last_started_node: str | None = None
            try:
                final_output = {}
                for event in self.runner.run_stream(graph.model_dump(), payload.input):
                    if event.get("event") == "node_start":
                        last_started_node = str(event.get("node_id") or "") or last_started_node
                    if event["event"] == "node_end":
                        out_payload = dict(event.get("output") or {})
                        if event.get("usage"):
                            out_payload["token_usage"] = event["usage"]
                        # 中文注释：如果节点输出包含 error 字段，日志标记为 failed
                        log_status = "failed" if out_payload.get("error") else "success"
                        self.run_repo.add_log(
                            session=session,
                            run_id=run.id,
                            node_id=event["node_id"],
                            node_type=event["node_type"],
                            status=log_status,
                            input_payload=event["input"],
                            output_payload=out_payload,
                            duration_ms=event["duration_ms"],
                        )
                    if event["event"] == "done":
                        final_output = event["output"]
                    yield {"run_id": run.id, **event}
                    # 中文注释：节点结束后 flush MCP/知识库等细粒度 trace，保证 SSE 顺序在对应 node_end 之后
                    if event["event"] == "node_end":
                        seq_holder[0], tevents = self.run_repo.append_traces_batch(
                            session, run.id, trace_buf, seq_holder[0]
                        )
                        for te in tevents:
                            yield te

                seq_holder[0], tevents = self.run_repo.append_traces_batch(session, run.id, trace_buf, seq_holder[0])
                for te in tevents:
                    yield te
                self.run_repo.set_success(session, run, final_output)
            except Exception as exc:
                if last_started_node:
                    self.run_repo.add_log(
                        session=session,
                        run_id=run.id,
                        node_id=last_started_node,
                        node_type="unknown",
                        status="failed",
                        input_payload={},
                        output_payload={"error": str(exc)},
                        duration_ms=0,
                    )
                try:
                    seq_holder[0], tevents = self.run_repo.append_traces_batch(
                        session, run.id, trace_buf, seq_holder[0]
                    )
                    for te in tevents:
                        yield te
                except Exception:
                    pass
                self.run_repo.set_failed(session, run, str(exc))
                yield {"run_id": run.id, "event": "error", "message": str(exc)}
            finally:
                clear_execution_trace_sink()

        return _iter()

    def stream_resume(self, session: Session, workflow_id: str, payload: ResumeRunRequest):
        """中文注释：断点续跑——从指定节点恢复流式执行，创建新 run 记录。"""
        workflow = self.workflow_repo.get(session, workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="workflow not found")

        graph = WorkflowGraph.model_validate(json.loads(workflow.graph_json))
        validate_for_execution(graph)
        run_create = RunCreate(input=payload.input)
        run = self.run_repo.create(session, workflow_id, run_create.input)
        self.run_repo.set_running(session, run)

        clear_execution_trace_sink()
        trace_buf: List[Dict[str, Any]] = []
        set_execution_trace_sink(lambda t: trace_buf.append(dict(t)))
        seq_holder: List[int] = [0]

        def _iter():
            last_started_node: str | None = None
            try:
                final_output = {}
                for event in self.runner.run_from_node(
                    graph.model_dump(), payload.input, payload.vars, payload.from_node_id
                ):
                    if event.get("event") == "node_start":
                        last_started_node = str(event.get("node_id") or "") or last_started_node
                    if event["event"] == "node_end":
                        out_payload = dict(event.get("output") or {})
                        if event.get("usage"):
                            out_payload["token_usage"] = event["usage"]
                        log_status = "failed" if out_payload.get("error") else "success"
                        self.run_repo.add_log(
                            session=session,
                            run_id=run.id,
                            node_id=event["node_id"],
                            node_type=event["node_type"],
                            status=log_status,
                            input_payload=event["input"],
                            output_payload=out_payload,
                            duration_ms=event["duration_ms"],
                        )
                    if event["event"] == "done":
                        final_output = event["output"]
                    yield {"run_id": run.id, **event}
                    if event["event"] == "node_end":
                        seq_holder[0], tevents = self.run_repo.append_traces_batch(
                            session, run.id, trace_buf, seq_holder[0]
                        )
                        for te in tevents:
                            yield te

                seq_holder[0], tevents = self.run_repo.append_traces_batch(session, run.id, trace_buf, seq_holder[0])
                for te in tevents:
                    yield te
                self.run_repo.set_success(session, run, final_output)
            except Exception as exc:
                if last_started_node:
                    self.run_repo.add_log(
                        session=session,
                        run_id=run.id,
                        node_id=last_started_node,
                        node_type="unknown",
                        status="failed",
                        input_payload={},
                        output_payload={"error": str(exc)},
                        duration_ms=0,
                    )
                try:
                    seq_holder[0], tevents = self.run_repo.append_traces_batch(
                        session, run.id, trace_buf, seq_holder[0]
                    )
                    for te in tevents:
                        yield te
                except Exception:
                    pass
                self.run_repo.set_failed(session, run, str(exc))
                yield {"run_id": run.id, "event": "error", "message": str(exc)}
            finally:
                clear_execution_trace_sink()

        return _iter()

    def get_run(self, session: Session, run_id: str) -> RunRead:
        run = self.run_repo.get(session, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        return self._to_read(run)

    def debug_step(self, session: Session, workflow_id: str, payload: DebugStepRequest) -> DebugStepResponse:
        workflow = self.workflow_repo.get(session, workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        graph = WorkflowGraph.model_validate(json.loads(workflow.graph_json))
        validate_for_execution(graph)
        try:
            raw = self.runner.debug_step(
                graph.model_dump(),
                payload.input,
                payload.vars,
                payload.last_node_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return DebugStepResponse(**raw)

    def list_run_traces(self, session: Session, run_id: str) -> List[RunTraceRead]:
        run = self.run_repo.get(session, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        rows = self.run_repo.list_traces(session, run_id)
        out: List[RunTraceRead] = []
        for row in rows:
            meta = json.loads(row.meta_json or "{}")
            if not isinstance(meta, dict):
                meta = {}
            rid = row.id or 0
            out.append(
                RunTraceRead(
                    id=rid,
                    run_id=row.run_id,
                    seq=row.seq,
                    phase=row.phase,
                    message=row.message,
                    node_id=row.node_id,
                    meta=meta,
                    created_at=row.created_at,
                )
            )
        return out

    def list_logs(self, session: Session, run_id: str) -> List[RunLogRead]:
        run = self.run_repo.get(session, run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="run not found")
        logs = self.run_repo.list_logs(session, run_id)
        return [
            RunLogRead(
                id=log.id or 0,
                run_id=log.run_id,
                node_id=log.node_id,
                node_type=log.node_type,
                status=log.status,
                input=json.loads(log.input_json),
                output=json.loads(log.output_json),
                duration_ms=log.duration_ms,
                created_at=log.created_at,
            )
            for log in logs
        ]

    def list_runs_by_workflow(self, session: Session, workflow_id: str, limit: int = 50) -> List[RunRead]:
        workflow = self.workflow_repo.get(session, workflow_id)
        if workflow is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        runs = self.run_repo.list_by_workflow(session, workflow_id=workflow_id, limit=limit)
        return [self._to_read(item) for item in runs]

    def list_runs_paginated(
        self,
        session: Session,
        page: int = 1,
        page_size: int = 20,
        keyword: str = "",
        status: str = "",
    ) -> PaginatedRuns:
        items, total = self.run_repo.list_paginated(
            session=session,
            page=page,
            page_size=page_size,
            keyword=keyword,
            status=status,
        )
        return PaginatedRuns(
            items=[self._to_read(item) for item in items],
            total=total,
            page=page,
            page_size=page_size,
        )

    @staticmethod
    def _to_read(run) -> RunRead:
        return RunRead(
            id=run.id,
            workflow_id=run.workflow_id,
            status=run.status,
            input=json.loads(run.input_json),
            output=json.loads(run.output_json),
            error=run.error,
            started_at=run.started_at,
            finished_at=run.finished_at,
            created_at=run.created_at,
        )

