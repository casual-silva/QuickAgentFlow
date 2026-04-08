"""MCP 工具目录 API：过滤画布独占工具名，与 MCP 工具名空间分离。"""

from typing import Any, Dict, List

from .service import get_mcp_invocation_service

# 画布独占、不应出现在 MCP 多选中的逻辑名（当前无）
NODE_ONLY_TOOL_NAMES = frozenset()


def list_mcp_tools_public() -> List[Dict[str, Any]]:
    """GET /api/mcp/tools 使用；不含画布独占工具名。"""
    raw = get_mcp_invocation_service().list_catalog_entries()
    return [item for item in raw if item.get("name") and item["name"] not in NODE_ONLY_TOOL_NAMES]
