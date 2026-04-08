import re
import ast
import operator
import json
from os import getenv
from typing import Any, Dict, Iterable, List, Set, Callable


def read_path(payload: Dict[str, Any], path: str, default: Any = "") -> Any:
    """点分路径读取；支持 dict 与实现了 __getitem__ 的命名空间（如 env）。"""
    current: Any = payload
    keys = [k for k in (path or "").split(".") if k]
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif hasattr(current, "__getitem__") and not isinstance(current, (str, bytes, list)):
            try:
                current = current[key]  # type: ignore[index]
            except Exception:
                return default
        else:
            return default
    return current


class EnvNamespace:
    """模板 {{env.XXX}}：服务端解析，值来自环境变量，不落库不回显给前端。"""

    def __getitem__(self, key: str) -> str:
        return str(getenv(str(key), "") or "")


_TEMPLATE_TOKEN_RE = re.compile(r"\{\{([^}]+)\}\}")


class ExpressionSafetyError(ValueError):
    """表达式执行安全异常：用于区分普通运行错误。"""


_SAFE_BIN_OPS: Dict[type, Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_SAFE_UNARY_OPS: Dict[type, Callable[[Any], Any]] = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
    ast.Not: operator.not_,
}
_SAFE_CMP_OPS: Dict[type, Callable[[Any, Any], bool]] = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}


def _safe_callables() -> Dict[str, Callable[..., Any]]:
    def _coalesce(*args: Any) -> Any:
        for item in args:
            if item not in (None, "", [], {}):
                return item
        return ""

    def _contains(container: Any, item: Any) -> bool:
        try:
            return item in container
        except Exception:
            return False

    return {
        "len": len,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "min": min,
        "max": max,
        "sum": sum,
        "sorted": sorted,
        "coalesce": _coalesce,
        "contains": _contains,
        "lower": lambda x: str(x).lower(),
        "upper": lambda x: str(x).upper(),
        "to_json": lambda x: json.dumps(x, ensure_ascii=False),
        "from_json": lambda x: json.loads(str(x)),
    }


def _eval_ast(node: ast.AST, names: Dict[str, Any], funcs: Dict[str, Callable[..., Any]]) -> Any:
    if isinstance(node, ast.Expression):
        return _eval_ast(node.body, names, funcs)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id in names:
            return names[node.id]
        raise ExpressionSafetyError(f"unknown name: {node.id}")
    if isinstance(node, ast.Attribute):
        base = _eval_ast(node.value, names, funcs)
        attr = node.attr
        if attr.startswith("_"):
            raise ExpressionSafetyError(f"unsafe attribute: {attr}")
        if isinstance(base, dict):
            return base.get(attr, "")
        return getattr(base, attr)
    if isinstance(node, ast.Subscript):
        base = _eval_ast(node.value, names, funcs)
        key = _eval_ast(node.slice, names, funcs) if not isinstance(node.slice, ast.Slice) else None
        if key is None:
            raise ExpressionSafetyError("slice is not allowed")
        return base[key]
    if isinstance(node, ast.List):
        return [_eval_ast(item, names, funcs) for item in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval_ast(item, names, funcs) for item in node.elts)
    if isinstance(node, ast.Dict):
        return {_eval_ast(k, names, funcs): _eval_ast(v, names, funcs) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.BinOp):
        op = _SAFE_BIN_OPS.get(type(node.op))
        if not op:
            raise ExpressionSafetyError(f"unsupported operator: {type(node.op).__name__}")
        return op(_eval_ast(node.left, names, funcs), _eval_ast(node.right, names, funcs))
    if isinstance(node, ast.UnaryOp):
        op = _SAFE_UNARY_OPS.get(type(node.op))
        if not op:
            raise ExpressionSafetyError(f"unsupported unary operator: {type(node.op).__name__}")
        return op(_eval_ast(node.operand, names, funcs))
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result = True
            for item in node.values:
                result = bool(_eval_ast(item, names, funcs))
                if not result:
                    return False
            return bool(result)
        if isinstance(node.op, ast.Or):
            for item in node.values:
                if bool(_eval_ast(item, names, funcs)):
                    return True
            return False
        raise ExpressionSafetyError(f"unsupported bool operator: {type(node.op).__name__}")
    if isinstance(node, ast.Compare):
        left = _eval_ast(node.left, names, funcs)
        for op_node, comp in zip(node.ops, node.comparators):
            op = _SAFE_CMP_OPS.get(type(op_node))
            if not op:
                raise ExpressionSafetyError(f"unsupported comparator: {type(op_node).__name__}")
            right = _eval_ast(comp, names, funcs)
            if not op(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.IfExp):
        return _eval_ast(node.body if _eval_ast(node.test, names, funcs) else node.orelse, names, funcs)
    if isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name):
            raise ExpressionSafetyError("only simple function calls are allowed")
        fn_name = node.func.id
        fn = funcs.get(fn_name)
        if not fn:
            raise ExpressionSafetyError(f"function not allowed: {fn_name}")
        args = [_eval_ast(arg, names, funcs) for arg in node.args]
        kwargs = {kw.arg: _eval_ast(kw.value, names, funcs) for kw in node.keywords if kw.arg}
        return fn(*args, **kwargs)
    raise ExpressionSafetyError(f"unsupported syntax: {type(node).__name__}")


def safe_eval_expression(expr: str, context: Dict[str, Any]) -> Any:
    """安全执行 Python 表达式，仅允许白名单 AST 节点与函数。"""
    source = str(expr or "").strip()
    if not source:
        return ""
    parsed = ast.parse(source, mode="eval")
    return _eval_ast(parsed, dict(context or {}), _safe_callables())


def render_template_with_diagnostics(text: str, context: Dict[str, Any]) -> Dict[str, Any]:
    """
    支持两种模板 token：
    - {{path.to.value}} 读取上下文路径
    - {{= python_expr }} 安全表达式执行
    """
    result = text or ""
    diagnostics: List[Dict[str, Any]] = []
    for token in _TEMPLATE_TOKEN_RE.findall(result):
        raw = token.strip()
        if raw.startswith("="):
            expr = raw[1:].strip()
            try:
                value = safe_eval_expression(expr, context)
                diagnostics.append({"token": raw, "ok": True, "value": value})
            except Exception as exc:
                value = ""
                diagnostics.append({"token": raw, "ok": False, "error": str(exc)})
        else:
            value = read_path(context, raw, "")
            diagnostics.append({"token": raw, "ok": True, "value": value})
        result = result.replace(f"{{{{{token}}}}}", str(value))
    return {"rendered": result, "diagnostics": diagnostics}


def render_template(text: str, context: Dict[str, Any]) -> str:
    return str(render_template_with_diagnostics(text, context)["rendered"])


def extract_template_tokens(text: str) -> List[str]:
    if not text or "{{" not in text:
        return []
    return [t.strip() for t in _TEMPLATE_TOKEN_RE.findall(text)]


def _walk_strings(obj: Any) -> Iterable[str]:
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_strings(v)


def collect_template_tokens_from_graph(nodes: List[Any]) -> Set[str]:
    """从图中所有字符串配置收集模板占位路径（不含大括号）。"""
    out: Set[str] = set()
    for node in nodes:
        data = getattr(node, "data", None)
        if not isinstance(data, dict):
            continue
        for s in _walk_strings(data):
            out.update(extract_template_tokens(s))
    return out


def validate_template_references(*, node_ids: Set[str], tokens: Set[str]) -> List[str]:
    """校验模板路径前缀；未知 nodes.xxx 返回问题文案列表。"""
    issues: List[str] = []
    for raw in sorted(tokens):
        if raw.startswith("="):
            # 表达式 token：运行时由安全解释器执行，这里仅做语法存在性豁免
            continue
        if raw.startswith("env."):
            continue
        if raw.startswith("input.") or raw == "input":
            continue
        if raw == "chat_input" or raw.startswith("chat_input."):
            continue
        if raw.startswith("globals."):
            continue
        if raw.startswith("vars."):
            continue
        if raw.startswith("nodes."):
            parts = raw.split(".")
            if len(parts) < 4:
                issues.append(f"模板引用格式应为 nodes.<nodeId>.output.<字段>：{raw}")
                continue
            nid = parts[1]
            if parts[2] != "output":
                issues.append(f"模板引用 nodes 命名空间需包含 .output.：{raw}")
                continue
            if nid not in node_ids:
                issues.append(f"模板引用了不存在的节点 id「{nid}」：{raw}")
            continue
        if "." not in raw and raw in ("input", "chat_input", "globals", "vars", "nodes", "env"):
            continue
        issues.append(f"未识别的模板根命名空间（请使用 input / nodes / env / globals / vars）：{raw}")
    return issues
