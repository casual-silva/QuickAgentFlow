import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import Session, func, select

from ..models.run import Run, RunLog
from ..models.trace import RunTraceEntry


class RunRepository:
    def create(self, session: Session, workflow_id: str, input_payload: Dict[str, Any]) -> Run:
        run = Run(
            id=str(uuid.uuid4()),
            workflow_id=workflow_id,
            status="pending",
            input_json=json.dumps(input_payload, ensure_ascii=False),
            output_json="{}",
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        return run

    def get(self, session: Session, run_id: str) -> Optional[Run]:
        return session.get(Run, run_id)

    def list_by_workflow(self, session: Session, workflow_id: str, limit: int = 50) -> List[Run]:
        statement = (
            select(Run)
            .where(Run.workflow_id == workflow_id)
            .order_by(Run.created_at.desc())
            .limit(limit)
        )
        return list(session.exec(statement).all())

    def list_paginated(
        self,
        session: Session,
        page: int = 1,
        page_size: int = 20,
        keyword: str = "",
        status: str = "",
    ) -> tuple[List[Run], int]:
        statement = select(Run)
        count_statement = select(func.count()).select_from(Run)

        if keyword.strip():
            like_keyword = f"%{keyword.strip()}%"
            statement = statement.where(Run.id.like(like_keyword))
            count_statement = count_statement.where(Run.id.like(like_keyword))
        if status.strip():
            statement = statement.where(Run.status == status.strip())
            count_statement = count_statement.where(Run.status == status.strip())

        total = int(session.exec(count_statement).one() or 0)
        offset = max(0, (page - 1) * page_size)
        statement = statement.order_by(Run.created_at.desc()).offset(offset).limit(page_size)
        return list(session.exec(statement).all()), total

    def list_logs(self, session: Session, run_id: str) -> List[RunLog]:
        statement = select(RunLog).where(RunLog.run_id == run_id).order_by(RunLog.id.asc())
        return list(session.exec(statement).all())

    def set_running(self, session: Session, run: Run) -> None:
        run.status = "running"
        run.started_at = datetime.utcnow()
        session.add(run)
        session.commit()

    def set_success(self, session: Session, run: Run, output_payload: Dict[str, Any]) -> None:
        run.status = "success"
        run.output_json = json.dumps(output_payload, ensure_ascii=False)
        run.finished_at = datetime.utcnow()
        session.add(run)
        session.commit()

    def set_failed(self, session: Session, run: Run, error: str) -> None:
        run.status = "failed"
        run.error = error
        run.finished_at = datetime.utcnow()
        session.add(run)
        session.commit()

    def add_log(
        self,
        session: Session,
        run_id: str,
        node_id: str,
        node_type: str,
        status: str,
        input_payload: Dict[str, Any],
        output_payload: Dict[str, Any],
        duration_ms: int,
    ) -> RunLog:
        log = RunLog(
            run_id=run_id,
            node_id=node_id,
            node_type=node_type,
            status=status,
            input_json=json.dumps(input_payload, ensure_ascii=False),
            output_json=json.dumps(output_payload, ensure_ascii=False),
            duration_ms=duration_ms,
        )
        session.add(log)
        session.commit()
        session.refresh(log)
        return log

    def append_traces_batch(
        self,
        session: Session,
        run_id: str,
        buffer: List[Dict[str, Any]],
        start_seq: int,
    ) -> tuple[int, List[Dict[str, Any]]]:
        """将内存中的 trace 缓冲批量落库并清空 buffer，返回下一 seq 与 SSE 用载荷列表。"""
        if not buffer:
            return start_seq, []
        drained = list(buffer)
        buffer.clear()
        seq = start_seq
        sse_out: List[Dict[str, Any]] = []
        for t in drained:
            seq += 1
            meta = t.get("meta") if isinstance(t.get("meta"), dict) else {}
            row = RunTraceEntry(
                run_id=run_id,
                seq=seq,
                phase=str(t.get("phase", "")),
                message=str(t.get("message", "")),
                node_id=str(t.get("node_id") or ""),
                meta_json=json.dumps(meta, ensure_ascii=False),
            )
            session.add(row)
            sse_out.append(
                {
                    "run_id": run_id,
                    "event": "trace",
                    "seq": seq,
                    "phase": row.phase,
                    "message": row.message,
                    "node_id": row.node_id or None,
                    "meta": meta,
                }
            )
        session.commit()
        return seq, sse_out

    def list_traces(self, session: Session, run_id: str) -> List[RunTraceEntry]:
        statement = select(RunTraceEntry).where(RunTraceEntry.run_id == run_id).order_by(RunTraceEntry.seq.asc())
        return list(session.exec(statement).all())
