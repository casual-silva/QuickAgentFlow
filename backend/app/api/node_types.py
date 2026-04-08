from typing import Any, Dict, List

from fastapi import APIRouter

from ..engine.catalog.node_types import list_node_types as get_node_types_catalog, list_tools as get_tools_catalog

router = APIRouter(prefix="/api/node-types", tags=["node-types"])


@router.get("", response_model=List[Dict[str, Any]])
def list_node_types() -> List[Dict[str, Any]]:
    return get_node_types_catalog()


@router.get("/tools", response_model=List[Dict[str, Any]])
def list_tools() -> List[Dict[str, Any]]:
    """兼容旧客户端；新集成请使用 GET /api/mcp/tools。"""
    return get_tools_catalog()
