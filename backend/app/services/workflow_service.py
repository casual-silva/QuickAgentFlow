import json
from typing import List

from fastapi import HTTPException
from sqlmodel import Session

from ..engine import validate_for_persistence
from ..models.workflow import WorkflowCreate, WorkflowRead, WorkflowUpdate, WorkflowGraph
from ..repositories.workflow_repo import WorkflowRepository


class WorkflowService:
    def __init__(self, repo: WorkflowRepository) -> None:
        self.repo = repo

    def list_workflows(self, session: Session) -> List[WorkflowRead]:
        rows = self.repo.list(session)
        return [self._to_read_model(row) for row in rows]

    def get_workflow(self, session: Session, workflow_id: str) -> WorkflowRead:
        row = self.repo.get(session, workflow_id)
        if row is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        return self._to_read_model(row)

    def create_workflow(self, session: Session, payload: WorkflowCreate) -> WorkflowRead:
        self._validate_graph(payload.graph)
        row = self.repo.create(session, payload)
        return self._to_read_model(row)

    def update_workflow(self, session: Session, workflow_id: str, payload: WorkflowUpdate) -> WorkflowRead:
        row = self.repo.get(session, workflow_id)
        if row is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        if payload.graph is not None:
            self._validate_graph(payload.graph)
        row = self.repo.update(session, row, payload)
        return self._to_read_model(row)

    def delete_workflow(self, session: Session, workflow_id: str) -> None:
        row = self.repo.get(session, workflow_id)
        if row is None:
            raise HTTPException(status_code=404, detail="workflow not found")
        self.repo.delete(session, row)

    @staticmethod
    def _to_read_model(row) -> WorkflowRead:
        graph_dict = json.loads(row.graph_json)
        graph = WorkflowGraph.model_validate(graph_dict)
        return WorkflowRead(
            id=row.id,
            name=row.name,
            description=row.description,
            graph=graph,
            status=row.status,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    @staticmethod
    def _validate_graph(graph: WorkflowGraph) -> None:
        validate_for_persistence(graph)
