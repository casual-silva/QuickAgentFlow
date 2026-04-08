from __future__ import annotations

import uuid
from typing import Any, Dict, List

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from ..integrations.mcp.service import get_mcp_invocation_service
from ..nodes.context import NodeExecutionContext
from ..nodes.handlers import build_default_registry
from .langgraph_executor import LangGraphNodeExecutor
from .langgraph_state import LangGraphState


class LangGraphRunner:
    def __init__(self) -> None:
        self.registry = build_default_registry(get_mcp_invocation_service())
        self.checkpointer = MemorySaver()

    def run(self, graph: Dict[str, Any], input_payload: Dict[str, Any]) -> Dict[str, Any]:
        compiled = self._compile(graph)
        initial_state = self._build_initial_state(graph, input_payload)
        run_id = str(uuid.uuid4())
        thread_id = f"thread-{run_id}"
        result = compiled.invoke(
            initial_state,
            config={"configurable": {"thread_id": thread_id, "run_id": run_id}},
        )
        return {"output": result.get("output", {}), "trace": result.get("trace", [])}

    def run_stream(self, graph: Dict[str, Any], input_payload: Dict[str, Any]):
        compiled = self._compile(graph)
        initial_state = self._build_initial_state(graph, input_payload)
        run_id = str(uuid.uuid4())
        thread_id = f"thread-{run_id}"
        last_trace_size = 0
        for update in compiled.stream(
            initial_state,
            config={"configurable": {"thread_id": thread_id, "run_id": run_id}},
            stream_mode="values",
        ):
            trace = update.get("trace", [])
            if len(trace) <= last_trace_size:
                continue
            new_events = trace[last_trace_size:]
            for item in new_events:
                yield {"event": "node_start", "node_id": item["node_id"], "node_type": item["node_type"]}
                yield {"event": "node_end", **item}
            last_trace_size = len(trace)

        final_state = compiled.get_state({"configurable": {"thread_id": thread_id, "run_id": run_id}}).values
        yield {"event": "done", "output": final_state.get("output", {}), "trace": final_state.get("trace", [])}

    def debug_step(
        self,
        workflow_graph: Dict[str, Any],
        input_payload: Dict[str, Any],
        vars_payload: Dict[str, Any],
        last_node_id: str | None,
    ) -> Dict[str, Any]:
        """单步调试：从 entry 或上一节点路由，执行下一个节点并返回合并后的 vars。"""
        nodes = workflow_graph.get("nodes", [])
        edges = workflow_graph.get("edges", [])
        entry = str(workflow_graph.get("entry", ""))
        node_map = {str(item.get("id", "")): item for item in nodes if item.get("id")}
        if not entry or entry not in node_map:
            raise ValueError("entry node not found")
        executor = LangGraphNodeExecutor(registry=self.registry, node_map=node_map, edges=edges)
        globals_payload = self._collect_globals(workflow_graph)
        merged_input = {**globals_payload, **(input_payload or {})}
        state: LangGraphState = {
            "input": merged_input,
            "globals": globals_payload,
            "vars": dict(vars_payload or {}),
            "trace": [],
            "output": {},
        }
        if not last_node_id:
            next_id = entry
        else:
            next_id = executor.route_next(str(last_node_id), state)
        if next_id == "__end__":
            return {
                "finished": True,
                "node_id": None,
                "node_type": None,
                "output": {},
                "vars": state["vars"],
            }
        node = node_map[next_id]
        node_type = str(node.get("type", ""))
        context = NodeExecutionContext(
            input_payload=merged_input,
            vars_payload=state["vars"],
            globals_payload=globals_payload,
            edges=edges,
            node_map=node_map,
        )
        handler = self.registry.get(node_type=node_type)
        output = handler.execute(node_id=next_id, node=node, context=context)
        next_vars = {**state["vars"], next_id: output}
        return {
            "finished": False,
            "node_id": next_id,
            "node_type": node_type,
            "output": output,
            "vars": next_vars,
        }

    def run_from_node(
        self,
        graph: Dict[str, Any],
        input_payload: Dict[str, Any],
        vars_payload: Dict[str, Any],
        from_node_id: str,
    ):
        """中文注释：断点续跑——从指定节点开始流式执行，复用已有 vars。"""
        compiled = self._compile(graph, entry_override=from_node_id)
        globals_payload = self._collect_globals(graph)
        merged_input = {**globals_payload, **(input_payload or {})}
        initial_state: LangGraphState = {
            "input": merged_input,
            "globals": globals_payload,
            "vars": dict(vars_payload or {}),
            "trace": [],
            "output": {},
        }
        run_id = str(uuid.uuid4())
        thread_id = f"thread-resume-{run_id}"
        last_trace_size = 0
        for update in compiled.stream(
            initial_state,
            config={"configurable": {"thread_id": thread_id, "run_id": run_id}},
            stream_mode="values",
        ):
            trace = update.get("trace", [])
            if len(trace) <= last_trace_size:
                continue
            new_events = trace[last_trace_size:]
            for item in new_events:
                yield {"event": "node_start", "node_id": item["node_id"], "node_type": item["node_type"]}
                yield {"event": "node_end", **item}
            last_trace_size = len(trace)

        final_state = compiled.get_state({"configurable": {"thread_id": thread_id, "run_id": run_id}}).values
        yield {"event": "done", "output": final_state.get("output", {}), "trace": final_state.get("trace", [])}

    def _compile(self, workflow_graph: Dict[str, Any], entry_override: str | None = None):
        nodes = workflow_graph.get("nodes", [])
        edges = workflow_graph.get("edges", [])
        entry = entry_override or str(workflow_graph.get("entry", ""))
        node_map = {str(item.get("id", "")): item for item in nodes if item.get("id")}
        if not entry or entry not in node_map:
            raise ValueError("entry node not found")

        graph = StateGraph(LangGraphState)
        executor = LangGraphNodeExecutor(registry=self.registry, node_map=node_map, edges=edges)

        for node_id in node_map.keys():
            graph.add_node(node_id, executor.build_node_fn(node_id))
        graph.set_entry_point(entry)

        for node_id in node_map.keys():
            outgoing_targets = {
                str(edge.get("target", ""))
                for edge in edges
                if str(edge.get("source", "")) == node_id and str(edge.get("target", "")) in node_map
            }
            mapping = {target: target for target in outgoing_targets}
            mapping["__end__"] = END
            graph.add_conditional_edges(
                node_id,
                lambda state, nid=node_id: executor.route_next(nid, state),
                mapping,
            )
        return graph.compile(checkpointer=self.checkpointer)

    @staticmethod
    def _collect_globals(workflow_graph: Dict[str, Any]) -> Dict[str, Any]:
        merged: Dict[str, Any] = {}
        for node in workflow_graph.get("nodes", []):
            if str(node.get("type", "")) != "global":
                continue
            data = node.get("data", {})
            variables = data.get("variables", {}) if isinstance(data, dict) else {}
            if isinstance(variables, dict):
                merged.update(variables)
        return merged

    def _build_initial_state(self, workflow_graph: Dict[str, Any], input_payload: Dict[str, Any]) -> LangGraphState:
        globals_payload = self._collect_globals(workflow_graph)
        merged_input = {**globals_payload, **(input_payload or {})}
        return {
            "input": merged_input,
            "globals": globals_payload,
            "vars": {},
            "trace": [],
            "output": {},
        }
