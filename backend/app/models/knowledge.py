"""知识库（Dify 式 RAG 轻量版）：多库、多文本块，检索走关键词打分而非向量（可后续替换）。"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from sqlmodel import SQLModel, Field as SQLField


class KnowledgeBase(SQLModel, table=True):
    id: str = SQLField(primary_key=True)
    name: str
    description: str = ""
    created_at: datetime = SQLField(default_factory=datetime.utcnow)


class KnowledgeChunk(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    knowledge_base_id: str = SQLField(index=True, foreign_key="knowledgebase.id")
    title: str = ""
    content: str
    position: int = 0
    created_at: datetime = SQLField(default_factory=datetime.utcnow)
    # 可选：OpenAI 等 embedding 的 JSON 浮点数组字符串；无向量时仅走词法/短语等路
    embedding_json: Optional[str] = SQLField(default=None)
    embedding_model: Optional[str] = SQLField(default=None)
    # 入库 QC / 来源：JSON，如 source_filename、chunk_index、char_count
    meta_json: Optional[str] = SQLField(default=None)


class KnowledgeBaseCreate(BaseModel):
    name: str
    description: str = ""


class KnowledgeBaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class KnowledgeBaseRead(BaseModel):
    id: str
    name: str
    description: str
    created_at: datetime
    chunk_count: int = 0


class KnowledgeChunkCreate(BaseModel):
    title: str = ""
    content: str
    position: int = 0


class KnowledgeChunkUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    position: Optional[int] = None
    refresh_embedding: bool = False


class KnowledgeChunkRead(BaseModel):
    id: int
    knowledge_base_id: str
    title: str
    content: str
    position: int
    created_at: datetime
    has_embedding: bool = False
    embedding_model: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class KnowledgeIngestTextRequest(BaseModel):
    """长文自动分块入库；可选向量化（需 OPENAI_API_KEY）。"""

    text: str = Field(..., min_length=1)
    title_prefix: str = ""
    chunk_size: int = Field(default=480, ge=80, le=8000)
    chunk_overlap: int = Field(default=72, ge=0, le=2000)
    min_chunk_chars: int = Field(default=20, ge=1, le=500)
    dedupe: bool = True
    embed: bool = True


class KnowledgeIngestResult(BaseModel):
    created_chunks: int
    skipped_short: int
    skipped_duplicate: int
    embedding_ok: int
    embedding_failed: int
    warnings: List[str] = Field(default_factory=list)
    chunk_ids: List[int] = Field(default_factory=list)


class KnowledgeRetrievalPreviewRequest(BaseModel):
    """管理端单库检索测试：与工作流 knowledge_retrieve 节点同一套多路召回 + 重排逻辑。"""

    query: str = Field(..., min_length=1, description="测试查询文本")
    top_k: int = Field(default=8, ge=1, le=50)
    recall_pool_size: int = Field(default=64, ge=8, le=200)
    rag_weights: Optional[Dict[str, float]] = None
    include_score_breakdown: bool = True
    include_query_explain: bool = True


class KnowledgeRetrievalPreviewResponse(BaseModel):
    knowledge_base_id: str
    query: str
    chunks: List[Dict[str, Any]]
    retrieval: Dict[str, Any]
    query_explain: Optional[Dict[str, Any]] = None
    fusion_summary: str = Field(
        default=(
            "融合分 final = Σ (路径权重 × 该路径在召回池内的 min-max 归一化分)；"
            "各路径原始分见 score_breakdown 中 *_raw，归一化见 *_norm。"
            "可选 dense 路为查询与块向量的余弦相似度（需入库时写入 embedding 且配置 OPENAI_API_KEY）。"
        )
    )
