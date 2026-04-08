from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel
from sqlmodel import Field as SQLField
from sqlmodel import SQLModel


class WorkflowTemplate(SQLModel, table=True):
    id: str = SQLField(primary_key=True)
    name: str
    description: str = ""
    graph_json: str
    source_workflow_id: Optional[str] = None
    created_at: datetime = SQLField(default_factory=datetime.utcnow)
    updated_at: datetime = SQLField(default_factory=datetime.utcnow)


class TemplateCreate(BaseModel):
    name: str
    description: str = ""
    source_workflow_id: str


class TemplateRead(BaseModel):
    id: str
    name: str
    description: str
    graph: dict
    source_workflow_id: Optional[str]
    created_at: datetime
    updated_at: datetime


class TemplateApplyRequest(BaseModel):
    name: str
    status: Literal["draft", "published"] = "draft"


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class PaginatedTemplates(BaseModel):
    items: List[TemplateRead]
    total: int
    page: int
    page_size: int
