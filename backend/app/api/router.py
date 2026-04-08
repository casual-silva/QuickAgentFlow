from fastapi import APIRouter

from .expressions import router as expressions_router
from .knowledge import router as knowledge_router
from .mcp import router as mcp_router
from .node_types import router as node_types_router
from .runs import router as runs_router
from .templates import router as templates_router
from .workflows import router as workflows_router

api_router = APIRouter()
api_router.include_router(workflows_router)
api_router.include_router(runs_router)
api_router.include_router(node_types_router)
api_router.include_router(mcp_router)
api_router.include_router(templates_router)
api_router.include_router(expressions_router)
api_router.include_router(knowledge_router)
