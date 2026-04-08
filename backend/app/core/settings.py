from pathlib import Path
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    api_host: str = Field(default="0.0.0.0", alias="API_HOST")
    api_port: int = Field(default=8001, alias="API_PORT")
    app_env: str = Field(default="dev", alias="APP_ENV")

    database_url: str = Field(default="sqlite:///./data/workflow.db", alias="DATABASE_URL")
    cors_origins: str = Field(default="http://localhost:5174", alias="CORS_ORIGINS")

    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    embedding_model: str = Field(default="text-embedding-3-small", alias="EMBEDDING_MODEL")
    llm_model: str = Field(default="gpt-4o-mini", alias="LLM_MODEL")
    llm_temperature: float = Field(default=0.2, alias="LLM_TEMPERATURE")

    mcp_mode: str = Field(default="mock", alias="MCP_MODE")
    mcp_server_url: Optional[str] = Field(default=None, alias="MCP_SERVER_URL")
    mcp_base_url: Optional[str] = Field(default=None, alias="MCP_BASE_URL")
    engine_mode: str = Field(default="langgraph", alias="ENGINE_MODE")

    # 可选：从浏览器复制 Cookie 填入，缓解百度返回「安全验证」页导致解析不到结果（服务器/数据中心 IP 常被拦）
    baidu_cookie: Optional[str] = Field(default=None, alias="BAIDU_COOKIE")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    def resolve_mcp_url(self) -> Optional[str]:
        """FastMCP Client 连接串：优先 MCP_SERVER_URL，兼容旧 MCP_BASE_URL。"""
        for raw in (self.mcp_server_url, self.mcp_base_url):
            if raw and str(raw).strip():
                return str(raw).strip()
        return None

    def ensure_paths(self) -> None:
        if self.database_url.startswith("sqlite:///./"):
            local_path = self.database_url.replace("sqlite:///./", "", 1)
            Path(local_path).parent.mkdir(parents=True, exist_ok=True)
