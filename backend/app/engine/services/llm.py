from os import getenv
from typing import Any, Dict, Optional, Tuple

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from ...core.settings import Settings


def _resolved_openai_api_key() -> str:
    """优先环境变量，其次 pydantic-settings 从 .env 注入的 OPENAI_API_KEY（与 os.getenv 单一路径不一致会导致永远走本地回退）。"""
    from_env = (getenv("OPENAI_API_KEY") or "").strip()
    if from_env:
        return from_env
    sk = Settings().openai_api_key
    return (sk or "").strip() if sk is not None else ""


def llm_or_fallback(
    model: str, system_prompt: str, user_content: str, temperature: float = 0.2
) -> Tuple[str, Optional[Dict[str, Any]], bool]:
    """返回 (文本, token_usage 或 None, 是否使用了本地回退而非真实 API)。"""
    try:
        api_key = _resolved_openai_api_key()
        if not api_key:
            raise ValueError("missing_api_key")
        llm = ChatOpenAI(model=model, temperature=temperature, api_key=api_key)
        res = llm.invoke([SystemMessage(content=system_prompt), HumanMessage(content=user_content)])
        text = str(res.content)
        usage: Optional[Dict[str, Any]] = None
        meta = getattr(res, "response_metadata", None) or {}
        if isinstance(meta, dict):
            raw_usage = meta.get("token_usage")
            if isinstance(raw_usage, dict):
                usage = dict(raw_usage)
            elif raw_usage is not None and hasattr(raw_usage, "model_dump"):
                usage = raw_usage.model_dump()  # type: ignore[assignment]
        return text, usage, False
    except Exception:
        text = user_content.replace("\n", " ").strip()
        if len(text) > 500:
            text = text[:500] + "..."
        return f"【本地回退总结】{system_prompt}\n{text}", None, True
