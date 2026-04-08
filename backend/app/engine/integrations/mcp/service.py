"""MCP 调用：基于开源 fastmcp.Client，与画布节点执行层解耦。"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from fastmcp import Client

from ....core.settings import Settings

_mcp_service: Optional["McpInvocationService"] = None


class McpInvocationService:
    """同步门面：内部用 asyncio.run 驱动 FastMCP 异步 Client（节点执行线程无 running loop）。"""

    def __init__(self, server_url: Optional[str], timeout_seconds: float = 60.0) -> None:
        self._url = (server_url or "").strip() or None
        self._timeout = timeout_seconds

    @property
    def is_configured(self) -> bool:
        return self._url is not None

    def list_catalog_entries(self) -> List[Dict[str, Any]]:
        """原始 MCP tools/list，供 catalog 过滤后对外暴露。"""
        if not self.is_configured:
            return []
        return asyncio.run(self._list_tools_async())

    async def _list_tools_async(self) -> List[Dict[str, Any]]:
        async with Client(self._url, timeout=self._timeout) as client:
            tools = await client.list_tools()
            out: List[Dict[str, Any]] = []
            for t in tools:
                name = getattr(t, "name", "") or ""
                if not name:
                    continue
                desc = getattr(t, "description", None) or ""
                title = getattr(t, "title", None) or ""
                schema = getattr(t, "inputSchema", None)
                params: Dict[str, Any] = schema if isinstance(schema, dict) else {}
                out.append(
                    {
                        "name": name,
                        "label": str(title).strip() or name,
                        "description": desc,
                        "parameters": params,
                    }
                )
            return out

    def invoke_tool(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        if not self.is_configured:
            return {
                "tool": tool_name,
                "error": "mcp_not_configured",
                "message": "请配置 MCP_SERVER_URL 或 MCP_BASE_URL 指向 MCP 服务端点",
            }
        return asyncio.run(self._invoke_async(tool_name, params))

    async def _invoke_async(self, tool_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
        async with Client(self._url, timeout=self._timeout) as client:
            result = await client.call_tool(tool_name, params or {}, raise_on_error=False)
            if result.is_error:
                return {
                    "tool": tool_name,
                    "error": True,
                    "is_error": True,
                    "content": [str(getattr(c, "text", c)) for c in (result.content or [])],
                }
            payload: Dict[str, Any] = {"tool": tool_name}
            if result.data is not None:
                payload["data"] = result.data
            if result.structured_content is not None:
                payload["structured_content"] = result.structured_content
            return payload


def get_mcp_invocation_service() -> McpInvocationService:
    global _mcp_service
    if _mcp_service is None:
        settings = Settings()
        _mcp_service = McpInvocationService(server_url=settings.resolve_mcp_url())
    return _mcp_service
