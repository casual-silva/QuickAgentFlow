from dataclasses import dataclass, field
from typing import Any, Dict, List

from ..services.expressions import EnvNamespace


@dataclass
class NodeExecutionContext:
    """单次节点执行可见的输入与上游输出（边列表用于兼容旧图多句柄）。"""

    input_payload: Dict[str, Any]
    vars_payload: Dict[str, Any]
    globals_payload: Dict[str, Any]
    edges: List[Dict[str, Any]]
    # id -> 节点定义（含 type），供 Agent 识别默认连线上的「HTTP / 工具」等上游
    node_map: Dict[str, Dict[str, Any]] = field(default_factory=dict)

    @property
    def render_ctx(self) -> Dict[str, Any]:
        # 核心：模板上下文与产品约定对齐 — input / globals / vars / nodes.<id>.output / env / chat_input
        nodes_ns: Dict[str, Any] = {}
        for nid, out in (self.vars_payload or {}).items():
            if isinstance(out, dict):
                nodes_ns[str(nid)] = {"output": out}
            else:
                nodes_ns[str(nid)] = {"output": {"value": out}}
        merged_input = {**self.globals_payload, **self.input_payload}
        chat_alias = merged_input.get("query", "")
        return {
            "input": merged_input,
            "globals": self.globals_payload,
            "vars": self.vars_payload,
            "nodes": nodes_ns,
            "env": EnvNamespace(),
            "chat_input": chat_alias,
        }
