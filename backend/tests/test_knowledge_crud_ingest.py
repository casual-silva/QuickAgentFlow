"""知识库 CRUD、自动分块入库 API。"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_patch_and_delete_knowledge_base_roundtrip():
    r = client.post("/api/knowledge/bases", json={"name": "tmp-crud-kb", "description": "d0"})
    assert r.status_code == 201
    kb_id = r.json()["id"]
    r2 = client.patch(f"/api/knowledge/bases/{kb_id}", json={"name": "tmp-crud-kb-renamed", "description": "d1"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "tmp-crud-kb-renamed"
    assert r2.json()["description"] == "d1"
    r3 = client.delete(f"/api/knowledge/bases/{kb_id}")
    assert r3.status_code == 204
    r4 = client.get(f"/api/knowledge/bases/{kb_id}/chunks")
    assert r4.status_code == 404


def test_ingest_text_creates_multiple_chunks():
    r = client.post("/api/knowledge/bases", json={"name": "tmp-ingest-kb", "description": ""})
    assert r.status_code == 201
    kb_id = r.json()["id"]
    # 多段空行 + 超长段触发滑窗，期望多块
    long_para = "句子测试。" * 80
    body = {
        "text": "第一段简介。\n\n第二段说明。\n\n" + long_para,
        "title_prefix": "自动",
        "chunk_size": 120,
        "chunk_overlap": 20,
        "min_chunk_chars": 5,
        "dedupe": True,
        "embed": False,
    }
    ir = client.post(f"/api/knowledge/bases/{kb_id}/ingest-text", json=body)
    assert ir.status_code == 200
    data = ir.json()
    assert data["created_chunks"] >= 2
    listed = client.get(f"/api/knowledge/bases/{kb_id}/chunks")
    assert listed.status_code == 200
    assert len(listed.json()) == data["created_chunks"]
    client.delete(f"/api/knowledge/bases/{kb_id}")


def test_patch_chunk_updates_content():
    r = client.post("/api/knowledge/bases", json={"name": "tmp-chunk-patch", "description": ""})
    kb_id = r.json()["id"]
    cr = client.post(f"/api/knowledge/bases/{kb_id}/chunks", json={"title": "t", "content": "hello"})
    assert cr.status_code == 201
    cid = cr.json()["id"]
    pr = client.patch(f"/api/knowledge/chunks/{cid}", json={"content": "hello world", "title": "t2"})
    assert pr.status_code == 200
    assert pr.json()["content"] == "hello world"
    assert pr.json()["title"] == "t2"
    client.delete(f"/api/knowledge/bases/{kb_id}")
