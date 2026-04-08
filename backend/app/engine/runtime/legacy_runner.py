import time
from typing import Any, Dict, List

from ..domain.edge_utils import edge_route_label_normalized
from ..integrations.mcp.service import get_mcp_invocation_service
from ..nodes.context import NodeExecutionContext
from ..nodes.handlers import build_default_registry


class LegacyWorkflowRunner:
    def __init__(self) -> None:
        self.registry = build_default_registry(get_mcp_invocation_service())

    def run(self, graph: Dict[str, Any], input_payload: Dict[str, Any]) -> Dict[str, Any]:
        node_map = {n["id"]: n for n in graph.get("nodes", [])}
        edges = graph.get("edges", [])
        current = graph.get("entry")
        globals_payload = self._collect_global_context(graph)
        merged_input = {**globals_payload, **(input_payload or {})}
        ctx: Dict[str, Any] = {"input": merged_input, "globals": globals_payload, "output": {}, "trace": [], "vars": {}}

        if current not in node_map:
            raise ValueError("entry node not found")

        max_steps = max(1, len(node_map) * 3)
        step = 0
        while current and step < max_steps:
            step += 1
            node = node_map[current]
            started = time.time()
            node_type = node.get("type", "")
            node_output = self.execute(
                node_id=current,
                node=node,
                context=NodeExecutionContext(
                    input_payload=ctx["input"],
                    vars_payload=ctx["vars"],
                    globals_payload=ctx["globals"],
                    edges=edges,
                    node_map=node_map,
                ),
            )
            ctx["vars"][current] = node_output
            ctx["trace"].append(
                {
                    "node_id": current,
                    "node_type": node_type,
                    "input": {"context_keys": list(ctx.keys())},
                    "output": node_output,
                    "duration_ms": int((time.time() - started) * 1000),
                }
            )
            if node_type == "end":
                ctx["output"] = node_output.get("final", node_output)
                break
            current = self._next_node(current, edges, ctx, node_type)
        return {"output": ctx.get("output", {}), "trace": ctx["trace"]}

    def run_stream(self, graph: Dict[str, Any], input_payload: Dict[str, Any]):
        node_map = {n["id"]: n for n in graph.get("nodes", [])}
        edges = graph.get("edges", [])
        current = graph.get("entry")
        globals_payload = self._collect_global_context(graph)
        merged_input = {**globals_payload, **(input_payload or {})}
        ctx: Dict[str, Any] = {"input": merged_input, "globals": globals_payload, "output": {}, "trace": [], "vars": {}}
        if current not in node_map:
            raise ValueError("entry node not found")

        max_steps = max(1, len(node_map) * 3)
        step = 0
        while current and step < max_steps:
            step += 1
            node = node_map[current]
            node_type = node.get("type", "")
            started = time.time()
            yield {"event": "node_start", "node_id": current, "node_type": node_type}
            node_output = self.execute(
                node_id=current,
                node=node,
                context=NodeExecutionContext(
                    input_payload=ctx["input"],
                    vars_payload=ctx["vars"],
                    globals_payload=ctx["globals"],
                    edges=edges,
                    node_map=node_map,
                ),
            )
            duration_ms = int((time.time() - started) * 1000)
            ctx["vars"][current] = node_output
            trace_item = {
                "node_id": current,
                "node_type": node_type,
                "input": {"context_keys": list(ctx.keys())},
                "output": node_output,
                "duration_ms": duration_ms,
            }
            ctx["trace"].append(trace_item)
            yield {"event": "node_end", **trace_item}

            if node_type == "end":
                ctx["output"] = node_output.get("final", node_output)
                break
            current = self._next_node(current, edges, ctx, node_type)
        yield {"event": "done", "output": ctx.get("output", {}), "trace": ctx["trace"]}

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        node_type = str(node.get("type", ""))
        handler = self.registry.get(node_type=node_type)
        return handler.execute(node_id=node_id, node=node, context=context)

    @staticmethod
    def _collect_global_context(graph: Dict[str, Any]) -> Dict[str, Any]:
        merged: Dict[str, Any] = {}
        for node in graph.get("nodes", []):
            if node.get("type") != "global":
                continue
            data = node.get("data", {})
            variables = data.get("variables", {}) if isinstance(data, dict) else {}
            if isinstance(variables, dict):
                merged.update(variables)
        return merged

    @staticmethod
    def _next_node(current: str, edges: List[Dict[str, Any]], ctx: Dict[str, Any], node_type: str) -> str:
        outgoing = [e for e in edges if e.get("source") == current]
        if not outgoing:
            return ""
        if node_type in ("condition", "if", "switch"):
            route = str((ctx.get("vars", {}).get(current, {}) or {}).get("route", "default"))
            for edge in outgoing:
                if edge_route_label_normalized(edge) == route.lower():
                    return edge.get("target")
        for edge in outgoing:
            if edge_route_label_normalized(edge) in ("default", ""):
                return edge.get("target")
        for edge in outgoing:
            if edge.get("source") == current:
                return edge.get("target")
        return ""
