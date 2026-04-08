"""工作流图校验单测。"""

import pytest
from fastapi import HTTPException

from app.engine import validate_for_execution, validate_for_persistence
from app.models.workflow import EdgePayload, NodePayload, WorkflowGraph


def _minimal_graph(**kwargs):
    defaults = dict(
        entry="t1",
        nodes=[
            NodePayload(id="t1", type="trigger", data={"label": "T"}),
            NodePayload(id="a1", type="agent", data={"model": "gpt-4o-mini", "system_prompt": "s"}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[
            EdgePayload(source="t1", target="a1"),
            EdgePayload(source="a1", target="e1"),
        ],
    )
    defaults.update(kwargs)
    return WorkflowGraph(**defaults)


def test_validate_for_execution_ok():
    validate_for_execution(_minimal_graph())


def test_validate_for_execution_agent_empty_model_uses_default():
    """Agent 未写 model 时与 LLM 一致走环境默认，校验应通过。"""
    g = _minimal_graph(
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="a1", type="agent", data={"system_prompt": "x"}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[EdgePayload(source="t1", target="a1"), EdgePayload(source="a1", target="e1")],
    )
    validate_for_execution(g)


def test_validate_for_execution_llm_empty_model_uses_default():
    """未写 model 时使用 Settings 默认模型，不应 400。"""
    g = _minimal_graph(
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="l1", type="llm", data={"user_prompt": "hi"}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[EdgePayload(source="t1", target="l1"), EdgePayload(source="l1", target="e1")],
    )
    validate_for_execution(g)


def test_validate_for_execution_tool_requires_explicit_mcp_tool_name():
    g = _minimal_graph(
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="k1", type="tool", data={}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[EdgePayload(source="t1", target="k1"), EdgePayload(source="k1", target="e1")],
    )
    with pytest.raises(HTTPException) as exc:
        validate_for_execution(g)
    assert "tool_name" in str(exc.value.detail).lower() or "mcp" in str(exc.value.detail).lower()


def test_validate_for_execution_tool_ok_with_mcp_tool_name():
    g = _minimal_graph(
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="k1", type="tool", data={"tool_name": "example_tool"}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[EdgePayload(source="t1", target="k1"), EdgePayload(source="k1", target="e1")],
    )
    validate_for_execution(g)


def test_validate_for_execution_agent_ok_with_model_edge():
    g = _minimal_graph(
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="l1", type="llm", data={"model_name": "gpt-4o-mini", "system_prompt": "s", "user_prompt": "{{input.query}}"}),
            NodePayload(id="a1", type="agent", data={"system_prompt": "x"}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[
            EdgePayload(source="t1", target="l1"),
            EdgePayload(source="l1", target="a1", targetHandle="model"),
            EdgePayload(source="a1", target="e1"),
        ],
    )
    validate_for_execution(g)


def test_validate_for_persistence_rejects_unknown_edge():
    g = _minimal_graph(
        edges=[
            EdgePayload(source="t1", target="a1"),
            EdgePayload(source="a1", target="missing"),
        ],
    )
    with pytest.raises(HTTPException) as exc:
        validate_for_persistence(g)
    assert "unknown node" in str(exc.value.detail)
