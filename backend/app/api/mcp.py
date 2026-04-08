"""MCP 工具 HTTP 接口：与节点类型目录 /api/node-types 分离。"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter

from ..engine.integrations.mcp.catalog import list_mcp_tools_public
from ..engine.integrations.mcp.service import get_mcp_invocation_service

router = APIRouter(prefix="/api/mcp", tags=["mcp"])


@router.get("/tools", response_model=List[Dict[str, Any]])
def list_mcp_tools() -> List[Dict[str, Any]]:
    # 返回项不含画布独占能力，与 Agent/Tool 节点的 MCP 多选一致
    return list_mcp_tools_public()


@router.get("/health")
def mcp_health() -> Dict[str, Any]:
    """探测 MCP 服务端是否可达及工具数量（不做 OpenTelemetry，仅运维友好 JSON）。"""
    svc = get_mcp_invocation_service()
    if not svc.is_configured:
        return {"configured": False, "reachable": False, "tool_count": 0, "error": None}
    err: Optional[str] = None
    count = 0
    try:
        tools = svc.list_catalog_entries()
        count = len(tools)
    except Exception as exc:
        err = str(exc)
        return {"configured": True, "reachable": False, "tool_count": 0, "error": err}
    return {"configured": True, "reachable": True, "tool_count": count, "error": None}
