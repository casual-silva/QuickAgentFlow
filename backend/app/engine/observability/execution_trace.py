"""执行轨迹发射器：通过 ContextVar 注入 sink，供 Handler/MCP 高内聚上报，RunService 负责持久化与 SSE。

设计目标：engine 层不依赖 HTTP/DB；仅调用 trace_emit；RunService 在流式迭代中 flush 缓冲。
"""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any, Callable, Dict, Optional

TraceSink = Callable[[Dict[str, Any]], None]

_sink: ContextVar[Optional[TraceSink]] = ContextVar("execution_trace_sink", default=None)


def set_execution_trace_sink(fn: Optional[TraceSink]) -> None:
    _sink.set(fn)


def clear_execution_trace_sink() -> None:
    _sink.set(None)


def trace_emit(
    phase: str,
    message: str,
    *,
    node_id: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    """由节点 Handler、MCP 调用链等发出结构化轨迹（不落库，仅入 RunService 缓冲）。"""
    fn = _sink.get()
    if fn is None:
        return
    fn(
        {
            "phase": phase,
            "message": message,
            "node_id": node_id,
            "meta": dict(meta or {}),
        }
    )
