from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field
from sqlmodel import SQLModel, Field as SQLField


class NodePayload(BaseModel):
    id: str
    type: str
    position: Dict[str, float] = Field(default_factory=dict)
    data: Dict[str, Any] = Field(default_factory=dict)


class EdgePayload(BaseModel):
    source: str
    target: str
    sourceHandle: Optional[str] = None
    targetHandle: Optional[str] = None
    label: Optional[str] = None


class WorkflowGraph(BaseModel):
    nodes: List[NodePayload] = Field(default_factory=list)
    edges: List[EdgePayload] = Field(default_factory=list)
    entry: str


class Workflow(SQLModel, table=True):
    id: str = SQLField(primary_key=True)
    name: str
    description: str = ""
    graph_json: str
    status: str = "draft"
    created_at: datetime = SQLField(default_factory=datetime.utcnow)
    updated_at: datetime = SQLField(default_factory=datetime.utcnow)


class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    graph: WorkflowGraph
    status: Literal["draft", "published"] = "draft"


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    graph: Optional[WorkflowGraph] = None
    status: Optional[Literal["draft", "published"]] = None


class WorkflowRead(BaseModel):
    id: str
    name: str
    description: str
    graph: WorkflowGraph
    status: Literal["draft", "published"]
    created_at: datetime
    updated_at: datetime
