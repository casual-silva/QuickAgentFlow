from app.engine.nodes.context import NodeExecutionContext
from app.engine.nodes.handlers import AgentNodeHandler
import app.engine.nodes.handlers as handlers_mod


class _FakeMcp:
    def list_catalog_entries(self):
        return [
            {
                "name": "demo_tool",
                "description": "demo tool",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
            }
        ]

    def invoke_tool(self, tool_name, params):
        return {"tool": tool_name, "data": {"echo": params.get("query", "")}}


def test_react_uses_langgraph_like_state_machine(monkeypatch):
    calls = {"n": 0}

    def _fake_llm(model, system_prompt, user_content, temperature=0.2):
        calls["n"] += 1
        if calls["n"] == 1:
            return ('{"action":"tool","tool":"demo_tool","args":{"query":"R1"},"thought":"need tool"}', None, False)
        return ('{"action":"final","answer":"OK","thought":"done"}', None, False)

    monkeypatch.setattr(handlers_mod, "llm_or_fallback", _fake_llm)
    h = AgentNodeHandler(mcp=_FakeMcp())
    ctx = NodeExecutionContext(
        input_payload={"query": "hello"},
        vars_payload={},
        globals_payload={},
        edges=[],
        node_map={},
    )
    node = {
        "type": "agent",
        "data": {
            "agent_strategy": "react",
            "model": "gpt-4o-mini",
            "max_iterations": 6,
            "use_mcp_tools": True,
            "mcp_tool_names": ["demo_tool"],
        },
    }
    out = h.execute("agent_1", node, ctx)
    assert out["strategy"] == "react"
    assert out["summary"] == "OK"
    assert out["iteration_count"] == 2
    assert out["react_steps"][0]["action"] == "tool"
    assert out["react_steps"][1]["action"] == "final"


def test_react_hits_iteration_limit_then_settles(monkeypatch):
    calls = {"n": 0}

    def _fake_llm(model, system_prompt, user_content, temperature=0.2):
        calls["n"] += 1
        # 前两次都要求 tool，第三次作为 settle 收敛
        if calls["n"] <= 2:
            return ('{"action":"tool","tool":"missing_tool","args":{},"thought":"try"}', None, False)
        return ("FINAL_SETTLE", None, False)

    monkeypatch.setattr(handlers_mod, "llm_or_fallback", _fake_llm)
    h = AgentNodeHandler(mcp=None)
    ctx = NodeExecutionContext(
        input_payload={"query": "q"},
        vars_payload={},
        globals_payload={},
        edges=[],
        node_map={},
    )
    node = {
        "type": "agent",
        "data": {
            "agent_strategy": "react",
            "model": "gpt-4o-mini",
            "max_iterations": 2,
            "use_mcp_tools": True,
            "mcp_tool_names": ["missing_tool"],
        },
    }
    out = h.execute("agent_1", node, ctx)
    assert out["strategy"] == "react"
    assert out["summary"] == "FINAL_SETTLE"
    assert out["iteration_count"] >= 1
