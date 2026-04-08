"""Run 执行轨迹表：与 RunLog 分离，专存细粒度 phase 事件。"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field
from sqlmodel import SQLModel, Field as SQLField


class RunTraceEntry(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    run_id: str = SQLField(index=True, foreign_key="run.id")
    seq: int = SQLField(index=True)
    phase: str
    message: str
    node_id: str = ""
    meta_json: str = "{}"
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


class RunTraceRead(BaseModel):
    id: int
    run_id: str
    seq: int
    phase: str
    message: str
    node_id: str
    meta: dict = Field(default_factory=dict)
    created_at: datetime
