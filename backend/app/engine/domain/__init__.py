"""领域层：工作流图不变式与运行前校验（不依赖 HTTP 框架细节时可进一步抽离）。"""

from .graph_validation import validate_for_execution, validate_for_persistence

__all__ = ["validate_for_execution", "validate_for_persistence"]
