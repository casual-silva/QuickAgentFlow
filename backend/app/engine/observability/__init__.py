"""执行可观测性：轻量 trace 事件通道（非 OpenTelemetry）。"""

from .execution_trace import clear_execution_trace_sink, set_execution_trace_sink, trace_emit

__all__ = ["clear_execution_trace_sink", "set_execution_trace_sink", "trace_emit"]
