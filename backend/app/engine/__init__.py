"""工作流执行引擎（分层说明）。

- **domain**：图校验、运行前不变式（`domain.graph_validation`）。
- **catalog**：节点类型元数据，供 OpenAPI（`catalog.node_types`）。
- **services**：与编排无关的可复用能力——LLM、模板表达式（`services`）。
- **integrations**：外部系统——MCP（FastMCP Client）等（`integrations`）。
- **nodes**：节点执行上下文、注册表与各类型 Handler（`nodes`）。
- **runtime**：LangGraph / Legacy 运行器与 `WorkflowRunner` 门面（`runtime`）。
"""

from .domain.graph_validation import validate_for_execution, validate_for_persistence
from .runtime.workflow_runner import WorkflowRunner

__all__ = ["WorkflowRunner", "validate_for_execution", "validate_for_persistence"]
