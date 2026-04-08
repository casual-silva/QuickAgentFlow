from typing import Any, Dict

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..engine.nodes.context import NodeExecutionContext
from ..engine.services.expressions import render_template_with_diagnostics

router = APIRouter(prefix="/api/expressions", tags=["expressions"])


class ExpressionPreviewRequest(BaseModel):
    templates: Dict[str, str] = Field(default_factory=dict)
    input: Dict[str, Any] = Field(default_factory=dict)
    vars: Dict[str, Any] = Field(default_factory=dict)
    globals: Dict[str, Any] = Field(default_factory=dict)


class ExpressionPreviewResponse(BaseModel):
    rendered: Dict[str, str] = Field(default_factory=dict)
    diagnostics: Dict[str, list[Dict[str, Any]]] = Field(default_factory=dict)


@router.post("/preview", response_model=ExpressionPreviewResponse)
def preview_expressions(payload: ExpressionPreviewRequest) -> ExpressionPreviewResponse:
    """
    统一表达式预览入口：
    - 前端仅提交模板字符串与上下文
    - 后端使用与运行时一致的上下文构造与安全执行策略
    """
    context = NodeExecutionContext(
        input_payload=payload.input,
        vars_payload=payload.vars,
        globals_payload=payload.globals,
        edges=[],
    ).render_ctx
    rendered: Dict[str, str] = {}
    diagnostics: Dict[str, list[Dict[str, Any]]] = {}
    for key, template in payload.templates.items():
        out = render_template_with_diagnostics(template, context)
        rendered[key] = str(out.get("rendered", ""))
        diagnostics[key] = out.get("diagnostics", [])
    return ExpressionPreviewResponse(rendered=rendered, diagnostics=diagnostics)
