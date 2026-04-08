"""LangGraph 与节点注册表的适配（仅编排，不含业务）。"""

from __future__ import annotations

import time
from typing import Any, Dict, List

from ..domain.edge_utils import edge_route_label_normalized
from ..nodes.context import NodeExecutionContext
from ..nodes.handlers import NodeRegistry
from .execution_fail_marker import note_failed_node
from .langgraph_state import LangGraphState, TraceItem


class LangGraphNodeExecutor:
    def __init__(self, registry: NodeRegistry, node_map: Dict[str, Dict[str, Any]], edges: List[Dict[str, Any]]) -> None:
        self.registry = registry
        self.node_map = node_map
        self.edges = edges

    def build_node_fn(self, node_id: str):
        def _run(state: LangGraphState) -> LangGraphState:
            node = self.node_map[node_id]
            node_type = str(node.get("type", ""))
            data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
            retry_cfg = data.get("retry") if isinstance(data.get("retry"), dict) else {}
            max_retries = int(retry_cfg.get("max", 0))
            backoff_ms = float(retry_cfg.get("backoff_ms", 0))

            started = time.time()
            context = NodeExecutionContext(
                input_payload=state["input"],
                vars_payload=state["vars"],
                globals_payload=state["globals"],
                edges=self.edges,
                node_map=self.node_map,
            )
            handler = self.registry.get(node_type=node_type)
            output: Dict[str, Any] = {}
            execution_error: str | None = None

            for attempt in range(max_retries + 1):
                try:
                    output = handler.execute(node_id=node_id, node=node, context=context)
                    if isinstance(output, dict) and output.get("error") is not None and attempt < max_retries:
                        time.sleep(backoff_ms / 1000.0)
                        continue
                    break
                except Exception as exc:
                    if attempt < max_retries:
                        time.sleep(backoff_ms / 1000.0)
                        continue
                    execution_error = str(exc)
                    output = {"error": execution_error}
                    # 中文注释：OnError 机制——异常时不立即抛出，先尝试走 on_error 边
                    has_error_branch = any(
                        edge_route_label_normalized(e) == "on_error"
                        for e in self.edges
                        if e.get("source") == node_id
                    )
                    if has_error_branch:
                        output["route"] = "on_error"
                        break
                    note_failed_node(node_id)
                    raise

            # 中文注释：fallback 在节点返回 error 字段时单跳执行备用节点（不修改 LangGraph 静态边表）
            fallback = data.get("fallback") if isinstance(data.get("fallback"), dict) else None
            if (
                isinstance(output, dict)
                and output.get("error") is not None
                and fallback
                and str(fallback.get("on", "error")) == "error"
            ):
                fid = str(fallback.get("node_id", "")).strip()
                if fid and fid in self.node_map:
                    fnode = self.node_map[fid]
                    ftype = str(fnode.get("type", ""))
                    output = self.registry.get(node_type=ftype).execute(node_id=fid, node=fnode, context=context)

            # 中文注释：OnError 路由标记——如果节点出错且存在 on_error 出边，则通过 route 字段引导路由
            if (
                isinstance(output, dict)
                and output.get("error") is not None
                and "route" not in output
            ):
                has_error_branch = any(
                    edge_route_label_normalized(e) == "on_error"
                    for e in self.edges
                    if e.get("source") == node_id
                )
                if has_error_branch:
                    output["route"] = "on_error"

            duration_ms = int((time.time() - started) * 1000)
            usage: Dict[str, Any] | None = None
            if isinstance(output, dict):
                u = output.get("token_usage")
                if isinstance(u, dict):
                    usage = u

            trace_item: TraceItem = {
                "node_id": node_id,
                "node_type": node_type,
                "input": {"context_keys": ["input", "globals", "vars", "trace", "output"]},
                "output": output,
                "duration_ms": duration_ms,
            }
            if usage:
                trace_item["usage"] = usage

            next_vars = {**state["vars"], node_id: output}
            next_trace = [*state["trace"], trace_item]
            next_output = state["output"]
            if node_type == "end":
                next_output = output.get("final", output)
            return {
                "input": state["input"],
                "globals": state["globals"],
                "vars": next_vars,
                "trace": next_trace,
                "output": next_output,
            }

        return _run

    def route_next(self, current_node_id: str, state: LangGraphState) -> str:
        """中文注释：根据当前节点输出和出边 label 决定下一跳，支持 on_error 分支。"""
        current_node = self.node_map[current_node_id]
        node_type = str(current_node.get("type", ""))
        outgoing = [edge for edge in self.edges if edge.get("source") == current_node_id]
        if not outgoing:
            return "__end__"

        current_output = state.get("vars", {}).get(current_node_id, {}) or {}

        # 中文注释：如果节点输出标记了 on_error 路由，优先走错误分支
        if isinstance(current_output, dict) and current_output.get("route") == "on_error":
            for edge in outgoing:
                if edge_route_label_normalized(edge) == "on_error":
                    return str(edge.get("target", "__end__"))

        if node_type in ("if", "condition", "switch"):
            route = str(current_output.get("route", "default") if isinstance(current_output, dict) else "default")
            for edge in outgoing:
                if edge_route_label_normalized(edge) == route.lower():
                    return str(edge.get("target", "__end__"))

        # 中文注释：默认路由——跳过 on_error 边，走 default 或第一条正常边
        for edge in outgoing:
            label = edge_route_label_normalized(edge)
            if label == "on_error":
                continue
            if label in ("default", ""):
                return str(edge.get("target", "__end__"))
        # 如果只剩 on_error 边但没有触发错误，走 __end__
        non_error = [e for e in outgoing if edge_route_label_normalized(e) != "on_error"]
        if non_error:
            return str(non_error[0].get("target", "__end__"))
        return "__end__"
