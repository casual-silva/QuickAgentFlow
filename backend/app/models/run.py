from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field
from sqlmodel import SQLModel, Field as SQLField


class Run(SQLModel, table=True):
    id: str = SQLField(primary_key=True)
    workflow_id: str = SQLField(index=True, foreign_key="workflow.id")
    status: str = "pending"
    input_json: str = "{}"
    output_json: str = "{}"
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


class RunLog(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    run_id: str = SQLField(index=True, foreign_key="run.id")
    node_id: str
    node_type: str
    status: str = "running"
    input_json: str = "{}"
    output_json: str = "{}"
    duration_ms: int = 0
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


class RunCreate(BaseModel):
    input: Dict[str, Any] = Field(default_factory=dict)


class DebugStepRequest(BaseModel):
    """单步调试：客户端维护 vars 与 last_node_id，服务端按与全图一致的路由规则选下一节点。"""

    input: Dict[str, Any] = Field(default_factory=dict)
    vars: Dict[str, Any] = Field(default_factory=dict)
    last_node_id: Optional[str] = None


class ResumeRunRequest(BaseModel):
    """断点续跑：从指定节点恢复执行，复用之前的 vars 和 input 快照。"""

    from_node_id: str
    input: Dict[str, Any] = Field(default_factory=dict)
    vars: Dict[str, Any] = Field(default_factory=dict)


class DebugStepResponse(BaseModel):
    finished: bool
    node_id: Optional[str] = None
    node_type: Optional[str] = None
    output: Dict[str, Any] = Field(default_factory=dict)
    vars: Dict[str, Any] = Field(default_factory=dict)


class RunRead(BaseModel):
    id: str
    workflow_id: str
    status: Literal["pending", "running", "success", "failed"]
    input: Dict[str, Any]
    output: Dict[str, Any]
    error: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime


class RunLogRead(BaseModel):
    id: int
    run_id: str
    node_id: str
    node_type: str
    status: Literal["running", "success", "failed"]
    input: Dict[str, Any]
    output: Dict[str, Any]
    duration_ms: int
    created_at: datetime


class PaginatedRuns(BaseModel):
    items: list[RunRead]
    total: int
    page: int
    page_size: int
