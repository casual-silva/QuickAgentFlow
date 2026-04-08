"""工作流图校验：保存与执行共用。"""

from collections import defaultdict
from typing import Set

from fastapi import HTTPException

from ...core.settings import Settings
from ...models.workflow import WorkflowGraph
from ..catalog.node_types import supported_node_types
from ..services.expressions import collect_template_tokens_from_graph, validate_template_references


def _required_tool_name(data: dict) -> bool:
    """Tool 节点必须显式配置 MCP 工具名。"""
    return bool(str(data.get("tool_name", "")).strip())


def _effective_llm_model(data: dict) -> str:
    raw = str(data.get("model_name", data.get("model", ""))).strip()
    if raw:
        return raw
    m = Settings().llm_model.strip()
    return m or "gpt-4o-mini"


def _validate_node_runtime_config(graph: WorkflowGraph) -> None:
    for node in graph.nodes:
        data = node.data if isinstance(node.data, dict) else {}
        if node.type == "tool" and not _required_tool_name(data):
            raise HTTPException(
                status_code=400,
                detail=f"tool node {node.id} missing tool_name（须为 MCP 目录中的工具，见 GET /api/mcp/tools）",
            )
        if node.type == "llm" and not _effective_llm_model(data):
            raise HTTPException(status_code=400, detail=f"llm node {node.id} missing model/model_name")
        if node.type == "knowledge_retrieve" and not str(data.get("knowledge_base_id", "")).strip():
            raise HTTPException(
                status_code=400,
                detail=f"knowledge_retrieve node {node.id} missing knowledge_base_id（请在属性面板选择知识库）",
            )


def _has_directed_cycle(node_ids: Set[str], graph: WorkflowGraph) -> bool:
    """有向图环检测：任意节点出发 DFS 遇 GRAY 集即存在回边。"""
    adj: dict[str, list[str]] = defaultdict(list)
    for edge in graph.edges:
        s, t = edge.source, edge.target
        if s in node_ids and t in node_ids:
            adj[s].append(t)
    visited: Set[str] = set()
    stack: Set[str] = set()

    def dfs(u: str) -> bool:
        visited.add(u)
        stack.add(u)
        for v in adj[u]:
            if v not in visited:
                if dfs(v):
                    return True
            elif v in stack:
                return True
        stack.remove(u)
        return False

    for nid in node_ids:
        if nid not in visited and dfs(nid):
            return True
    return False


def _validate_dag(graph: WorkflowGraph) -> None:
    node_ids = {n.id for n in graph.nodes}
    if _has_directed_cycle(node_ids, graph):
        raise HTTPException(status_code=400, detail="workflow graph contains a cycle（DAG 不允许环路）")


def _validate_template_paths(graph: WorkflowGraph) -> None:
    node_ids = {n.id for n in graph.nodes}
    tokens = collect_template_tokens_from_graph(graph.nodes)
    issues = validate_template_references(node_ids=node_ids, tokens=tokens)
    if issues:
        raise HTTPException(status_code=400, detail="template validation: " + "; ".join(issues[:25]))


def validate_for_execution(graph: WorkflowGraph) -> None:
    node_ids = {n.id for n in graph.nodes}
    if graph.entry not in node_ids:
        raise HTTPException(status_code=400, detail="entry node not found in graph nodes")
    _validate_dag(graph)
    _validate_node_runtime_config(graph)
    _validate_template_paths(graph)


def validate_for_persistence(graph: WorkflowGraph) -> None:
    if not graph.nodes:
        raise HTTPException(status_code=400, detail="graph nodes cannot be empty")
    allowed_types = set(supported_node_types())
    if len({item.id for item in graph.nodes}) != len(graph.nodes):
        raise HTTPException(status_code=400, detail="node id must be unique")
    for node in graph.nodes:
        if node.type not in allowed_types:
            raise HTTPException(status_code=400, detail=f"unsupported node type: {node.type}")
    node_ids = {item.id for item in graph.nodes}
    if graph.entry not in node_ids:
        raise HTTPException(status_code=400, detail="entry node not found in graph nodes")
    for edge in graph.edges:
        if edge.source not in node_ids or edge.target not in node_ids:
            raise HTTPException(status_code=400, detail="edge contains unknown node id")
    _validate_dag(graph)
    _validate_node_runtime_config(graph)
    _validate_template_paths(graph)
