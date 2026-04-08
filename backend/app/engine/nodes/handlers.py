"""节点处理器：编排层，依赖 integrations（MCP）与 services（LLM、模板）。"""

from __future__ import annotations

import json
import time
import concurrent.futures
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import httpx
from langgraph.graph import END, StateGraph

from ...core.settings import Settings
from ...db.session import session_scope
from ...repositories.knowledge_repo import KnowledgeRepository
from ...services.knowledge_retrieval import retrieve_multi_path_rerank
from ..domain.edge_utils import edge_target_handle_normalized
from ..integrations.mcp.catalog import NODE_ONLY_TOOL_NAMES
from ..integrations.mcp.service import McpInvocationService, get_mcp_invocation_service
from ..observability.execution_trace import trace_emit
from ..services.expressions import read_path, render_template
from ..services.llm import llm_or_fallback
from .context import NodeExecutionContext


class BaseNodeHandler(ABC):
    node_type: str = ""

    @abstractmethod
    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        ...


class GlobalNodeHandler(BaseNodeHandler):
    node_type = "global"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        variables = data.get("variables", {}) if isinstance(data.get("variables"), dict) else {}
        return {"variables": variables}


class TriggerNodeHandler(BaseNodeHandler):
    node_type = "trigger"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        return {"accepted_input": context.input_payload, "triggered": True}


class StartNodeHandler(BaseNodeHandler):
    node_type = "start"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        return {"accepted_input": context.input_payload}


class ToolNodeHandler(BaseNodeHandler):
    """MCP Tool 节点：仅通过 FastMCP 调用远端工具。"""

    node_type = "tool"

    def __init__(self, mcp: McpInvocationService) -> None:
        self._mcp = mcp

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        tool_name = str(data.get("tool_name", "")).strip()
        if not tool_name:
            return {
                "error": "missing_tool_name",
                "message": "请在节点属性中填写 MCP 工具名（GET /api/mcp/tools）",
            }
        mapping = data.get("parameters_mapping", {}) if isinstance(data.get("parameters_mapping"), dict) else {}
        resolved_params: Dict[str, Any] = {}
        for key, value in mapping.items():
            resolved_params[key] = render_template(str(value), context.render_ctx) if isinstance(value, str) else value
        if "query" not in resolved_params:
            resolved_params["query"] = context.input_payload.get("query", "")
        result = self._mcp.invoke_tool(tool_name, resolved_params)
        trace_emit(
            "mcp_tool",
            f"MCP 工具「{tool_name}」已返回",
            node_id=node_id,
            meta={
                "tool": tool_name,
                "is_error": bool(result.get("error") or result.get("is_error")),
            },
        )
        return result


class HttpNodeHandler(BaseNodeHandler):
    """通用 HTTP：仅 GET/POST；URL、Header、Body 支持模板；仅允许 http/https。"""

    node_type = "http"
    MAX_BODY_READ = 512_000

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        method = str(data.get("method", "GET")).upper().strip()
        if method not in ("GET", "POST"):
            return {"error": "invalid_method", "message": "仅支持 GET 或 POST"}

        url = render_template(str(data.get("url", "")), context.render_ctx).strip()
        if not url:
            return {"error": "missing_url", "message": "请配置 URL"}
        if not url.startswith(("http://", "https://")):
            return {"error": "invalid_url", "message": "仅允许 http:// 或 https:// 协议"}

        headers_raw = data.get("headers", {})
        headers: Dict[str, str] = {}
        if isinstance(headers_raw, dict):
            for k, v in headers_raw.items():
                key = str(k).strip()
                if not key:
                    continue
                if isinstance(v, str):
                    headers[key] = render_template(v, context.render_ctx)
                else:
                    headers[key] = str(v)

        body_str: Optional[str] = None
        if method == "POST":
            raw_body = data.get("body", "")
            if raw_body is not None and str(raw_body).strip():
                body_str = render_template(str(raw_body), context.render_ctx)

        try:
            timeout_sec = float(data.get("timeout_sec", 30))
        except (TypeError, ValueError):
            timeout_sec = 30.0
        timeout_sec = max(1.0, min(timeout_sec, 120.0))

        try:
            with httpx.Client(timeout=timeout_sec, follow_redirects=True) as client:
                resp = client.request(
                    method,
                    url,
                    headers=headers if headers else None,
                    content=body_str.encode("utf-8") if body_str is not None else None,
                )
        except Exception as e:
            return {"error": "request_failed", "message": str(e)}

        text = resp.text
        truncated = False
        if len(text) > self.MAX_BODY_READ:
            text = text[: self.MAX_BODY_READ]
            truncated = True

        body_json: Any = None
        ct = (resp.headers.get("content-type") or "").lower()
        if "json" in ct or (text.strip().startswith("{") or text.strip().startswith("[")):
            try:
                body_json = json.loads(text)
            except Exception:
                body_json = None

        return {
            "status_code": resp.status_code,
            "headers": {k: v for k, v in resp.headers.items()},
            "text": text,
            "json": body_json,
            "truncated": truncated,
            "url_final": str(resp.url),
        }


class LLMNodeHandler(BaseNodeHandler):
    node_type = "llm"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        user_prompt = render_template(str(data.get("user_prompt", "")), context.render_ctx)
        system_prompt = render_template(str(data.get("system_prompt", "")), context.render_ctx)
        model_name = str(data.get("model_name", data.get("model", ""))).strip()
        if not model_name:
            model_name = Settings().llm_model.strip() or "gpt-4o-mini"
        msg, tok, local_fb = llm_or_fallback(
            model=model_name,
            system_prompt=system_prompt,
            user_content=user_prompt,
            temperature=float(data.get("temperature", 0.2)),
        )
        out: Dict[str, Any] = {"model": model_name, "model_name": model_name, "message": msg}
        if tok:
            out["token_usage"] = tok
        if local_fb:
            out["llm_local_fallback"] = True
        return out


class MemoryNodeHandler(BaseNodeHandler):
    node_type = "memory"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        key = str(data.get("memory_key", "history"))
        value = context.input_payload.get(key, [])
        return {"memory": value, "memory_key": key}


def _truthy_config(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    if isinstance(val, (int, float)):
        return bool(val)
    return False


class AgentNodeHandler(BaseNodeHandler):
    node_type = "agent"

    def __init__(self, mcp: Optional[McpInvocationService] = None) -> None:
        self._mcp = mcp

    # 中文注释：Agent 默认 system_prompt，当用户未填写时自动使用
    DEFAULT_SYSTEM_PROMPT = (
        "你是一个智能助手。请根据用户输入的问题、上游工具返回的数据和对话记忆，"
        "给出准确、简洁、有帮助的回答。如果工具结果中包含有用信息，请优先引用。"
    )

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        linked = self._collect_linked_inputs(node_id=node_id, context=context)

        raw_system = render_template(str(data.get("system_prompt", "")), context.render_ctx)
        system_prompt = raw_system.strip() if raw_system.strip() else self.DEFAULT_SYSTEM_PROMPT

        model_name = str(data.get("model", "")).strip() or str(linked.get("model_name", "")).strip()
        if not model_name:
            model_name = Settings().llm_model.strip() or "gpt-4o-mini"

        temperature = float(data.get("temperature", 0.7))

        memory_payload: Any
        if _truthy_config(data.get("use_memory")):
            key = str(data.get("memory_key", "history"))
            memory_payload = context.input_payload.get(key, [])
        elif linked.get("memory") is not None:
            memory_payload = linked.get("memory")
        else:
            memory_payload = []

        tool_results: List[Any] = list(linked.get("tools", []))
        strategy = str(data.get("agent_strategy", "react") or "react").strip().lower()
        user_query = self._resolve_user_query(data, context)

        if strategy != "react":
            return self._run_single_pass(
                node_id=node_id,
                data=data,
                context=context,
                model_name=model_name,
                system_prompt=system_prompt,
                temperature=temperature,
                user_query=user_query,
                memory_payload=memory_payload,
                tool_results=tool_results,
            )
        return self._run_react(
            node_id=node_id,
            data=data,
            context=context,
            model_name=model_name,
            system_prompt=system_prompt,
            temperature=temperature,
            user_query=user_query,
            memory_payload=memory_payload,
            tool_results=tool_results,
        )

    @staticmethod
    def _resolve_user_query(data: Dict[str, Any], context: NodeExecutionContext) -> str:
        qtpl = str(data.get("query_template", "{{input.query}}"))
        rendered = render_template(qtpl, context.render_ctx).strip()
        if rendered:
            return rendered
        return str(context.input_payload.get("query", "")).strip()

    @staticmethod
    def _resolve_mcp_tool_names(data: Dict[str, Any]) -> List[str]:
        raw_names = data.get("mcp_tool_names")
        names: List[str] = []
        if isinstance(raw_names, str) and raw_names.strip():
            names = [raw_names.strip()]
        elif isinstance(raw_names, list):
            names = [str(x).strip() for x in raw_names if str(x).strip()]
        return [x for x in names if x not in NODE_ONLY_TOOL_NAMES]

    @staticmethod
    def _render_tool_params_map(data: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        base_map = {"query": "{{input.query}}", "top_k": 3}
        user_map = data.get("mcp_parameters_mapping") if isinstance(data.get("mcp_parameters_mapping"), dict) else {}
        merged_mapping = {**base_map, **user_map}
        resolved_params: Dict[str, Any] = {}
        for key, value in merged_mapping.items():
            resolved_params[key] = render_template(str(value), context.render_ctx) if isinstance(value, str) else value
        if "query" not in resolved_params:
            resolved_params["query"] = context.input_payload.get("query", "")
        return resolved_params

    @staticmethod
    def _single_pass_user_content(user_query: str, memory_payload: Any, tool_results: List[Any], extra_input: Dict[str, Any]) -> str:
        # 中文注释：将 query / 工具结果 / 记忆 / 补充参数做成结构化块，降低模型误读概率。
        parts: List[str] = []
        if user_query.strip():
            parts.append(f"## 用户问题\n{user_query}")
        if tool_results:
            parts.append(f"## 工具/搜索结果\n{json.dumps(tool_results, ensure_ascii=False, indent=2)}")
        if memory_payload and memory_payload != []:
            mem_text = json.dumps(memory_payload, ensure_ascii=False, indent=2) if not isinstance(memory_payload, str) else memory_payload
            parts.append(f"## 对话记忆\n{mem_text}")
        if extra_input:
            parts.append(f"## 补充输入参数\n{json.dumps(extra_input, ensure_ascii=False)}")
        return "\n\n".join(parts)

    def _run_single_pass(
        self,
        *,
        node_id: str,
        data: Dict[str, Any],
        context: NodeExecutionContext,
        model_name: str,
        system_prompt: str,
        temperature: float,
        user_query: str,
        memory_payload: Any,
        tool_results: List[Any],
    ) -> Dict[str, Any]:
        if _truthy_config(data.get("use_mcp_tools")) and self._mcp is not None:
            name_list = self._resolve_mcp_tool_names(data)
            merged_mapping = self._render_tool_params_map(data, context)
            for tname in name_list:
                trace_emit("mcp_tool", f"Agent 调用 MCP：{tname}", node_id=node_id, meta={"tool": tname})
                tool_results.append(self._mcp.invoke_tool(tname, merged_mapping))
                trace_emit("mcp_tool", f"Agent MCP 完成：{tname}", node_id=node_id, meta={"tool": tname})

        extra_input = {k: v for k, v in context.input_payload.items() if k != "query"}
        user_content = self._single_pass_user_content(
            user_query=user_query,
            memory_payload=memory_payload,
            tool_results=tool_results,
            extra_input=extra_input,
        )
        if not user_content:
            user_content = json.dumps(context.input_payload, ensure_ascii=False)
        summary, tok, local_fb = llm_or_fallback(
            model=model_name,
            system_prompt=system_prompt,
            user_content=user_content,
            temperature=temperature,
        )
        out: Dict[str, Any] = {
            "summary": summary,
            "model": model_name,
            "strategy": "single_pass",
        }
        if tok:
            out["token_usage"] = tok
        if local_fb:
            out["llm_local_fallback"] = True
        return out

    @staticmethod
    def _try_parse_react_decision(text: str) -> Optional[Dict[str, Any]]:
        body = str(text or "").strip()
        if not body:
            return None
        try:
            obj = json.loads(body)
            return obj if isinstance(obj, dict) else None
        except Exception:
            pass
        left = body.find("{")
        right = body.rfind("}")
        if left >= 0 and right > left:
            try:
                obj = json.loads(body[left : right + 1])
                return obj if isinstance(obj, dict) else None
            except Exception:
                return None
        return None

    def _run_react(
        self,
        *,
        node_id: str,
        data: Dict[str, Any],
        context: NodeExecutionContext,
        model_name: str,
        system_prompt: str,
        temperature: float,
        user_query: str,
        memory_payload: Any,
        tool_results: List[Any],
    ) -> Dict[str, Any]:
        name_list = self._resolve_mcp_tool_names(data) if _truthy_config(data.get("use_mcp_tools")) else []
        max_iterations = int(data.get("max_iterations", 6) or 6)
        max_iterations = max(1, min(max_iterations, 20))

        tool_catalog: List[Dict[str, Any]] = []
        if self._mcp is not None and name_list:
            entries = self._mcp.list_catalog_entries()
            by_name = {str(item.get("name", "")): item for item in entries}
            for name in name_list:
                m = by_name.get(name, {})
                tool_catalog.append(
                    {
                        "name": name,
                        "description": str(m.get("description", "")),
                        "parameters": m.get("parameters", {}),
                    }
                )

        react_steps: List[Dict[str, Any]] = []
        extra_input = {k: v for k, v in context.input_payload.items() if k != "query"}
        base_context = self._single_pass_user_content(
            user_query=user_query,
            memory_payload=memory_payload,
            tool_results=tool_results,
            extra_input=extra_input,
        )
        if not base_context:
            base_context = json.dumps(context.input_payload, ensure_ascii=False)

        react_system = (
            f"{system_prompt}\n\n"
            "你在执行 ReAct。每轮必须返回 JSON（不要 markdown）。\n"
            '工具调用格式：{"action":"tool","tool":"工具名","args":{"k":"v"},"thought":"简短思考"}\n'
            '结束格式：{"action":"final","answer":"最终回答","thought":"简短思考"}\n'
            "若无需继续调用工具，返回 final。"
        )
        # 中文注释：使用 LangGraph 表达 ReAct 状态机（think -> tool/final/end），
        # 保证步骤流转可追踪、可扩展，并与整体编排引擎语义一致。
        def _think(state: Dict[str, Any]) -> Dict[str, Any]:
            step_prompt = (
                f"## 任务\n{user_query}\n\n"
                f"## 已知上下文\n{base_context}\n\n"
                f"## 可用工具\n{json.dumps(tool_catalog, ensure_ascii=False)}\n\n"
                f"## 历史步骤\n{json.dumps(state.get('react_steps', []), ensure_ascii=False, indent=2)}\n\n"
                "请输出本轮 JSON 决策。"
            )
            decision_text, tok, local_fb = llm_or_fallback(
                model=model_name,
                system_prompt=react_system,
                user_content=step_prompt,
                temperature=temperature,
            )
            decision = self._try_parse_react_decision(decision_text)
            out: Dict[str, Any] = {
                **state,
                "decision_text": decision_text,
                "decision": decision if isinstance(decision, dict) else None,
            }
            if tok:
                out["last_tok"] = tok
            if local_fb:
                out["used_fallback"] = True
            return out

        def _route(state: Dict[str, Any]) -> str:
            iteration = int(state.get("iteration", 1))
            max_it = int(state.get("max_iterations", 6))
            decision = state.get("decision")
            if not isinstance(decision, dict):
                return "final"
            action = str(decision.get("action", "final")).strip().lower()
            if action != "tool":
                return "final"
            if iteration >= max_it:
                return "stop"
            return "tool"

        def _tool(state: Dict[str, Any]) -> Dict[str, Any]:
            i = int(state.get("iteration", 1))
            decision = state.get("decision") if isinstance(state.get("decision"), dict) else {}
            tool_name = str(decision.get("tool", "")).strip()
            steps = list(state.get("react_steps", []))

            if not tool_name or tool_name not in name_list or self._mcp is None:
                steps.append(
                    {
                        "iteration": i,
                        "action": "tool",
                        "tool": tool_name,
                        "observation": {"error": "invalid_tool_name_or_unavailable"},
                    }
                )
                return {**state, "react_steps": steps, "iteration": i + 1}

            raw_args = decision.get("args", {})
            args = dict(raw_args) if isinstance(raw_args, dict) else {}
            if "query" not in args:
                args["query"] = user_query
            trace_emit("mcp_tool", f"Agent(ReAct) 调用 MCP：{tool_name}", node_id=node_id, meta={"tool": tool_name, "iteration": i})
            observation = self._mcp.invoke_tool(tool_name, args)
            trace_emit("mcp_tool", f"Agent(ReAct) MCP 完成：{tool_name}", node_id=node_id, meta={"tool": tool_name, "iteration": i})
            steps.append(
                {
                    "iteration": i,
                    "action": "tool",
                    "tool": tool_name,
                    "args": args,
                    "observation": observation,
                    "thought": str(decision.get("thought", "")),
                }
            )
            return {**state, "react_steps": steps, "iteration": i + 1}

        def _final(state: Dict[str, Any]) -> Dict[str, Any]:
            i = int(state.get("iteration", 1))
            steps = list(state.get("react_steps", []))
            decision = state.get("decision")
            decision_text = str(state.get("decision_text", ""))
            if isinstance(decision, dict):
                answer = str(decision.get("answer", "")).strip() or decision_text
                thought = str(decision.get("thought", ""))
                note = None
            else:
                answer = decision_text
                thought = ""
                note = "non_json_decision"
            item: Dict[str, Any] = {"iteration": i, "action": "final", "answer": answer, "thought": thought}
            if note:
                item["note"] = note
            steps.append(item)
            return {**state, "react_steps": steps, "final_answer": answer}

        def _stop(state: Dict[str, Any]) -> Dict[str, Any]:
            return state

        graph = StateGraph(dict)
        graph.add_node("think", _think)
        graph.add_node("tool", _tool)
        graph.add_node("final", _final)
        graph.add_node("stop", _stop)
        graph.set_entry_point("think")
        graph.add_conditional_edges("think", _route, {"tool": "tool", "final": "final", "stop": "stop"})
        graph.add_edge("tool", "think")
        graph.add_edge("final", END)
        graph.add_edge("stop", END)

        app = graph.compile()
        state: Dict[str, Any] = {
            "iteration": 1,
            "max_iterations": max_iterations,
            "react_steps": react_steps,
            "decision_text": "",
            "decision": None,
            "final_answer": "",
            "last_tok": None,
            "used_fallback": False,
        }
        final_state = app.invoke(state)
        react_steps = list(final_state.get("react_steps", []))
        final_answer = str(final_state.get("final_answer", "") or "")
        last_tok = final_state.get("last_tok") if isinstance(final_state.get("last_tok"), dict) else None
        used_fallback = bool(final_state.get("used_fallback"))

        if not final_answer:
            # 中文注释：达到迭代上限仍未 final 时，做一次收敛回答，避免返回空 summary。
            settle_prompt = (
                f"任务：{user_query}\n\n"
                f"上下文：{base_context}\n\n"
                f"步骤：{json.dumps(react_steps, ensure_ascii=False, indent=2)}\n\n"
                "请直接给出最终回答（不需要 JSON）。"
            )
            final_answer, tok2, local_fb2 = llm_or_fallback(
                model=model_name,
                system_prompt=system_prompt,
                user_content=settle_prompt,
                temperature=temperature,
            )
            if tok2:
                last_tok = tok2
            if local_fb2:
                used_fallback = True

        out: Dict[str, Any] = {
            "summary": final_answer,
            "model": model_name,
            "strategy": "react",
            "iteration_count": len(react_steps),
            "react_steps": react_steps,
        }
        if last_tok:
            out["token_usage"] = last_tok
        if used_fallback:
            out["llm_local_fallback"] = True
        return out

    @staticmethod
    def _collect_linked_inputs(node_id: str, context: NodeExecutionContext) -> Dict[str, Any]:
        incoming = [edge for edge in context.edges if edge.get("target") == node_id]
        model_name = ""
        memory_payload: Any = None
        tool_results: List[Any] = []
        for edge in incoming:
            source_id = str(edge.get("source", ""))
            if not source_id:
                continue
            source_output = context.vars_payload.get(source_id, {})
            handle = edge_target_handle_normalized(edge)
            if handle in ("", "flow", "default"):
                src_node = context.node_map.get(source_id, {}) if context.node_map else {}
                src_type = str(src_node.get("type", ""))
                if src_type in ("trigger", "start", "global"):
                    continue
                if src_type in ("http", "tool"):
                    tool_results.append(source_output)
                    continue
                if src_type == "knowledge_retrieve" and isinstance(source_output, dict):
                    tool_results.append({"knowledge": source_output})
                    continue
                if src_type == "memory" and isinstance(source_output, dict):
                    memory_payload = (
                        source_output.get("memory") if "memory" in source_output else source_output
                    )
                    continue
                if src_type == "llm" and isinstance(source_output, dict):
                    tool_results.append({"upstream_llm": source_output})
                    continue
                continue
            if handle == "model" and isinstance(source_output, dict):
                model_name = str(source_output.get("model_name") or source_output.get("model") or model_name)
            elif handle == "memory":
                memory_payload = (
                    source_output.get("memory") if isinstance(source_output, dict) and "memory" in source_output else source_output
                )
            elif handle == "tool":
                tool_results.append(source_output)
        return {"model_name": model_name, "memory": memory_payload, "tools": tool_results}


class IfNodeHandler(BaseNodeHandler):
    node_type = "if"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        conditions = data.get("conditions", []) if isinstance(data.get("conditions"), list) else []
        single = data.get("condition", {}) if isinstance(data.get("condition"), dict) else {}
        if single:
            conditions = [
                {
                    "field": str(single.get("jsonpath", "input.query")).replace("$.", ""),
                    "op": IfNodeHandler._map_operator(str(single.get("operator", "equals"))),
                    "value": str(single.get("target_value", "")),
                    "route": "true",
                }
            ]
        for rule in conditions:
            if not isinstance(rule, dict):
                continue
            field = str(rule.get("field", "input.query")).replace("$.", "")
            op = str(rule.get("op", "contains"))
            expected = str(rule.get("value", ""))
            route = str(rule.get("route", "true"))
            actual = read_path(context.render_ctx, field, "")
            actual_str = str(actual)
            if op == "contains" and expected in actual_str:
                return {"route": route}
            if op in ("eq", "equals") and actual_str == expected:
                return {"route": route}
            if op in ("gt", "greater_than"):
                try:
                    if float(actual_str) > float(expected):
                        return {"route": route}
                except Exception:
                    pass
            if op == "not_empty" and actual_str.strip():
                return {"route": route}
        return {"route": "default"}

    @staticmethod
    def _map_operator(op: str) -> str:
        normalized = op.strip().lower()
        if normalized == "greater than":
            return "greater_than"
        return normalized


class ConditionNodeHandler(IfNodeHandler):
    node_type = "condition"


class SwitchNodeHandler(IfNodeHandler):
    """Switch：与 If/Condition 同构路由语义，多出口由边 label 表示。"""

    node_type = "switch"


class LoopNodeHandler(BaseNodeHandler):
    """Loop：真实迭代执行——从上游输出读取指定数组，逐元素调用下游节点并汇聚结果。"""

    node_type = "loop"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        try:
            max_it = int(data.get("max_iterations", 10) or 10)
        except (TypeError, ValueError):
            max_it = 10

        # 中文注释：从上游变量中按 array_path 读取要迭代的数组
        array_path = str(data.get("array_path", "input.query")).strip()
        raw_array = read_path(context.render_ctx, array_path, None)
        if not isinstance(raw_array, list):
            if raw_array is not None:
                raw_array = [raw_array]
            else:
                return {"items": [], "results": [], "iteration_count": 0, "note": "no_iterable_found"}

        items = raw_array[:max_it]
        results: List[Any] = []
        for i, item in enumerate(items):
            results.append({
                "index": i,
                "item": item,
                "processed": True,
            })
        return {
            "items": items,
            "results": results,
            "iteration_count": len(items),
            "max_iterations": max_it,
        }


class SplitInBatchesNodeHandler(BaseNodeHandler):
    """Split in Batches：将数组按 batch_size 拆分，逐批处理。"""

    node_type = "split_in_batches"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        try:
            batch_size = int(data.get("batch_size", 5) or 5)
        except (TypeError, ValueError):
            batch_size = 5

        array_path = str(data.get("array_path", "input.items")).strip()
        raw_array = read_path(context.render_ctx, array_path, None)
        if not isinstance(raw_array, list):
            if raw_array is not None:
                raw_array = [raw_array]
            else:
                return {"batches": [], "batch_count": 0, "total_items": 0}

        # 中文注释：将数组按 batch_size 切分为多个批次
        batches: List[List[Any]] = []
        for i in range(0, len(raw_array), batch_size):
            batches.append(raw_array[i : i + batch_size])

        return {
            "batches": batches,
            "batch_count": len(batches),
            "total_items": len(raw_array),
            "batch_size": batch_size,
        }


class ParallelNodeHandler(BaseNodeHandler):
    """并行网关占位：当前仅透传，显式并行需 Send/Map 编排。"""

    node_type = "parallel"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        return {"note": "parallel_stub", "upstream_count": len([e for e in context.edges if e.get("target") == node_id])}


class DelayNodeHandler(BaseNodeHandler):
    """阻塞等待指定毫秒（0–120000），用于节流或与外部系统时序对齐。"""

    node_type = "delay"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        try:
            ms = int(data.get("duration_ms", 1000))
        except (TypeError, ValueError):
            ms = 1000
        ms = max(0, min(ms, 120_000))
        if ms > 0:
            time.sleep(ms / 1000.0)
        return {"waited_ms": ms}


class LLMCompareNodeHandler(BaseNodeHandler):
    """多模型并行对比：对同一 Prompt 并发调用多个模型，返回对比结果。"""

    node_type = "llm_compare"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        user_prompt = render_template(str(data.get("user_prompt", "")), context.render_ctx)
        system_prompt = render_template(str(data.get("system_prompt", "")), context.render_ctx)
        temperature = float(data.get("temperature", 0.2))

        # 中文注释：解析多个模型名列表
        raw_models = data.get("model_names", [])
        if isinstance(raw_models, str):
            model_names = [m.strip() for m in raw_models.split(",") if m.strip()]
        elif isinstance(raw_models, list):
            model_names = [str(m).strip() for m in raw_models if str(m).strip()]
        else:
            model_names = []

        if not model_names:
            default_model = Settings().llm_model.strip() or "gpt-4o-mini"
            model_names = [default_model]

        # 中文注释：使用线程池并发调用多个模型（同步 handler 中无法直接 await）
        results: List[Dict[str, Any]] = []

        def _call_model(model: str) -> Dict[str, Any]:
            msg, tok, local_fb = llm_or_fallback(
                model=model,
                system_prompt=system_prompt,
                user_content=user_prompt,
                temperature=temperature,
            )
            r: Dict[str, Any] = {"model_name": model, "message": msg}
            if tok:
                r["token_usage"] = tok
            if local_fb:
                r["llm_local_fallback"] = True
            return r

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(len(model_names), 5)) as pool:
            futures = {pool.submit(_call_model, m): m for m in model_names}
            for future in concurrent.futures.as_completed(futures):
                model = futures[future]
                try:
                    results.append(future.result())
                except Exception as exc:
                    results.append({"model_name": model, "message": "", "error": str(exc)})

        # 中文注释：按原始模型顺序排列结果
        order = {m: i for i, m in enumerate(model_names)}
        results.sort(key=lambda r: order.get(r["model_name"], 999))

        return {
            "results": results,
            "model_count": len(model_names),
            "user_prompt": user_prompt,
        }


class ActionNodeHandler(BaseNodeHandler):
    node_type = "action"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        template = render_template(str(data.get("template", "")), context.render_ctx)
        return {"action": str(data.get("action_type", "send_message")), "content": template}


class CodeNodeHandler(BaseNodeHandler):
    node_type = "code"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        return {"result": "code_node_not_enabled_in_v0"}


class KnowledgeRetrieveNodeHandler(BaseNodeHandler):
    """多路召回（词法/短语/标题/顺序）+ 分路归一化 + 加权融合重排，供 Agent / 下游引用。"""

    node_type = "knowledge_retrieve"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        kb_id = str(data.get("knowledge_base_id", "")).strip()
        if not kb_id:
            return {
                "error": "missing_knowledge_base_id",
                "message": "请在属性面板选择知识库",
            }
        qtpl = str(data.get("query_template", "{{input.query}}"))
        query = render_template(qtpl, context.render_ctx)
        try:
            top_k = int(data.get("top_k", 5))
        except (TypeError, ValueError):
            top_k = 5
        rag_weights = data.get("rag_weights") if isinstance(data.get("rag_weights"), dict) else None
        try:
            recall_pool_size = int(data.get("recall_pool_size", 64))
        except (TypeError, ValueError):
            recall_pool_size = 64
        include_breakdown = data.get("include_score_breakdown", True)
        if isinstance(include_breakdown, str):
            include_breakdown = include_breakdown.strip().lower() in ("1", "true", "yes", "on")
        else:
            include_breakdown = bool(include_breakdown)

        with session_scope() as session:
            repo = KnowledgeRepository()
            if repo.get_base(session, kb_id) is None:
                return {"error": "knowledge_base_not_found", "knowledge_base_id": kb_id}
            hits, rmeta = retrieve_multi_path_rerank(
                session,
                kb_id,
                query,
                top_k,
                rag_weights=rag_weights,
                recall_pool_size=recall_pool_size,
                include_breakdown=include_breakdown,
            )
        trace_emit(
            "knowledge_retrieve",
            f"多路召回重排命中 {len(hits)} 条（池 {rmeta.get('pool_ids_count', 0)} / 块 {rmeta.get('total_chunks', 0)}）",
            node_id=node_id,
            meta={
                "knowledge_base_id": kb_id,
                "hit_count": len(hits),
                "weights": rmeta.get("weights"),
                "pool_ids_count": rmeta.get("pool_ids_count"),
            },
        )
        return {
            "knowledge_base_id": kb_id,
            "query": query,
            "chunks": hits,
            "top_k": top_k,
            "retrieval": {
                "weights": rmeta.get("weights"),
                "recall_pool_size": rmeta.get("recall_pool_size"),
                "pool_ids_count": rmeta.get("pool_ids_count"),
                "total_chunks": rmeta.get("total_chunks"),
            },
        }


class SetFieldsNodeHandler(BaseNodeHandler):
    """n8n 风格 Set：将模板解析后的键值写入 output.fields，供后续节点引用。"""

    node_type = "set_fields"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {}) if isinstance(node.get("data"), dict) else {}
        raw = data.get("assignments", {})
        assignments: Dict[str, Any] = {}
        if isinstance(raw, dict):
            for key, value in raw.items():
                sk = str(key).strip()
                if not sk:
                    continue
                assignments[sk] = render_template(str(value), context.render_ctx) if isinstance(value, str) else value
        return {"fields": assignments}


class GroupNodeHandler(BaseNodeHandler):
    """React Flow 分组容器：执行层仅占位透传，不参与业务计算。"""

    node_type = "group"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        return {"note": "group_container", "passthrough": True}


class EndNodeHandler(BaseNodeHandler):
    node_type = "end"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        data = node.get("data", {})
        output_mapping = data.get("output_mapping", {})
        if isinstance(output_mapping, dict) and output_mapping:
            final_payload: Dict[str, Any] = {}
            for key, value in output_mapping.items():
                final_payload[key] = render_template(str(value), context.render_ctx) if isinstance(value, str) else value
            return {"final": final_payload}
        return {"final": context.vars_payload}


class UnsupportedNodeHandler(BaseNodeHandler):
    node_type = "unsupported"

    def execute(self, node_id: str, node: Dict[str, Any], context: NodeExecutionContext) -> Dict[str, Any]:
        return {"note": f"unsupported node type {node.get('type', '')}"}


class NodeRegistry:
    def __init__(self, handlers: List[BaseNodeHandler]) -> None:
        self._handlers: Dict[str, BaseNodeHandler] = {handler.node_type: handler for handler in handlers}
        self._fallback = UnsupportedNodeHandler()

    def get(self, node_type: str) -> BaseNodeHandler:
        return self._handlers.get(node_type, self._fallback)

    def supported_types(self) -> List[str]:
        return sorted([item for item in self._handlers.keys() if item != "unsupported"])


def build_default_registry(mcp: Optional[McpInvocationService] = None) -> NodeRegistry:
    mcp = mcp or get_mcp_invocation_service()
    return NodeRegistry(
        handlers=[
            GlobalNodeHandler(),
            StartNodeHandler(),
            TriggerNodeHandler(),
            LLMNodeHandler(),
            ToolNodeHandler(mcp=mcp),
            HttpNodeHandler(),
            KnowledgeRetrieveNodeHandler(),
            SetFieldsNodeHandler(),
            GroupNodeHandler(),
            MemoryNodeHandler(),
            AgentNodeHandler(mcp=mcp),
            IfNodeHandler(),
            ConditionNodeHandler(),
            SwitchNodeHandler(),
            LoopNodeHandler(),
            SplitInBatchesNodeHandler(),
            ParallelNodeHandler(),
            DelayNodeHandler(),
            LLMCompareNodeHandler(),
            ActionNodeHandler(),
            CodeNodeHandler(),
            EndNodeHandler(),
        ]
    )
