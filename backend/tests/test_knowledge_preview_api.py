"""知识库检索预览 API。"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_preview_retrieval_unknown_kb_returns_404():
    r = client.post(
        "/api/knowledge/bases/ffffffff-ffff-ffff-ffff-ffffffffffff/preview-retrieval",
        json={"query": "x"},
    )
    assert r.status_code == 404
    assert "not found" in str(r.json().get("detail", "")).lower()


def test_query_preprocessing_explain_nonempty():
    from app.services.knowledge_retrieval import query_preprocessing_explain

    ex = query_preprocessing_explain("中文关键词 AB test")
    assert ex["token_count"] >= 1
    assert isinstance(ex["tokens"], list)
