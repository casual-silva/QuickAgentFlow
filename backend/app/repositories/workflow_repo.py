import json
import uuid
from datetime import datetime
from typing import List, Optional

from sqlmodel import Session, select

from ..models.workflow import Workflow, WorkflowCreate, WorkflowUpdate


class WorkflowRepository:
    def list(self, session: Session) -> List[Workflow]:
        return list(session.exec(select(Workflow).order_by(Workflow.updated_at.desc())).all())

    def get(self, session: Session, workflow_id: str) -> Optional[Workflow]:
        return session.get(Workflow, workflow_id)

    def create(self, session: Session, payload: WorkflowCreate) -> Workflow:
        now = datetime.utcnow()
        workflow = Workflow(
            id=str(uuid.uuid4()),
            name=payload.name,
            description=payload.description,
            graph_json=payload.graph.model_dump_json(),
            status=payload.status,
            created_at=now,
            updated_at=now,
        )
        session.add(workflow)
        session.commit()
        session.refresh(workflow)
        return workflow

    def update(self, session: Session, workflow: Workflow, payload: WorkflowUpdate) -> Workflow:
        if payload.name is not None:
            workflow.name = payload.name
        if payload.description is not None:
            workflow.description = payload.description
        if payload.graph is not None:
            workflow.graph_json = payload.graph.model_dump_json()
        if payload.status is not None:
            workflow.status = payload.status
        workflow.updated_at = datetime.utcnow()
        session.add(workflow)
        session.commit()
        session.refresh(workflow)
        return workflow

    def delete(self, session: Session, workflow: Workflow) -> None:
        session.delete(workflow)
        session.commit()

    @staticmethod
    def parse_graph(workflow: Workflow) -> dict:
        return json.loads(workflow.graph_json)
