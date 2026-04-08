"""边字段规范化：API/JSON 中常见 `targetHandle: null`，不能用 `.get(key, default)`（键存在时值仍为 None）。"""

from typing import Any, Dict


def _optional_edge_str(edge: Dict[str, Any], key: str) -> str:
    v = edge.get(key)
    if v is None:
        return ""
    s = str(v).strip()
    return s


def edge_target_handle_normalized(edge: Dict[str, Any]) -> str:
    """入边 targetHandle，缺省或 null 时视为空（走默认数据流逻辑）。"""
    th = _optional_edge_str(edge, "targetHandle")
    if th:
        return th.lower()
    lb = _optional_edge_str(edge, "label")
    return lb.lower() if lb else ""


def edge_route_label_normalized(edge: Dict[str, Any]) -> str:
    """条件边上的 label（if/switch），null 视为空串。"""
    return _optional_edge_str(edge, "label").lower()
