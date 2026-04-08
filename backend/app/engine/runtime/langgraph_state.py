from typing import Any, Dict, List, TypedDict

# Python 3.10：NotRequired 在 typing_extensions；3.11+ 在标准库 typing。
try:
    from typing import NotRequired
except ImportError:
    from typing_extensions import NotRequired


class TraceItem(TypedDict):
    node_id: str
    node_type: str
    input: Dict[str, Any]
    output: Dict[str, Any]
    duration_ms: int
    usage: NotRequired[Dict[str, Any]]


class LangGraphState(TypedDict):
    input: Dict[str, Any]
    globals: Dict[str, Any]
    vars: Dict[str, Dict[str, Any]]
    trace: List[TraceItem]
    output: Dict[str, Any]
