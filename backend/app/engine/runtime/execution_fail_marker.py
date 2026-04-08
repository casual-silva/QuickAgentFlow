"""同步执行失败时记录当前节点 id，供 RunService 写入 failed 日志（线程内列表，后台任务单线程消费）。"""

from typing import List, Optional

_failed_stack: List[str] = []


def note_failed_node(node_id: str) -> None:
    _failed_stack.append(node_id)


def pop_failed_node() -> Optional[str]:
    return _failed_stack.pop() if _failed_stack else None


def clear_failed_nodes() -> None:
    _failed_stack.clear()
