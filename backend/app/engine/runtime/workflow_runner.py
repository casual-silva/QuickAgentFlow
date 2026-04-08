from typing import Any, Dict

from ...core.settings import Settings
from .langgraph_runner import LangGraphRunner
from .legacy_runner import LegacyWorkflowRunner


class WorkflowRunner:
    """执行门面：按配置选择 LangGraph 或 Legacy 引擎。"""

    def __init__(self) -> None:
        self.settings = Settings()
        self.langgraph_runner = LangGraphRunner()
        self.legacy_runner = LegacyWorkflowRunner()

    @property
    def _runner(self):
        mode = self.settings.engine_mode.strip().lower()
        return self.legacy_runner if mode == "legacy" else self.langgraph_runner

    def run(self, graph: Dict[str, Any], input_payload: Dict[str, Any]) -> Dict[str, Any]:
        return self._runner.run(graph, input_payload)

    def run_stream(self, graph: Dict[str, Any], input_payload: Dict[str, Any]):
        yield from self._runner.run_stream(graph, input_payload)

    def debug_step(
        self, graph: Dict[str, Any], input_payload: Dict[str, Any], vars_payload: Dict[str, Any], last_node_id: str | None
    ) -> Dict[str, Any]:
        """单步执行仅支持 LangGraph 引擎。"""
        if self.settings.engine_mode.strip().lower() == "legacy":
            raise ValueError("debug_step requires LangGraph engine_mode")
        return self.langgraph_runner.debug_step(graph, input_payload, vars_payload, last_node_id)

    def run_from_node(
        self, graph: Dict[str, Any], input_payload: Dict[str, Any], vars_payload: Dict[str, Any], from_node_id: str
    ):
        """断点续跑：从指定节点开始流式执行（仅 LangGraph）。"""
        if self.settings.engine_mode.strip().lower() == "legacy":
            raise ValueError("run_from_node requires LangGraph engine_mode")
        yield from self.langgraph_runner.run_from_node(graph, input_payload, vars_payload, from_node_id)
