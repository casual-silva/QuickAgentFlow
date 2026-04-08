"""知识库检索与图校验扩展。"""

import pytest
from fastapi import HTTPException
from sqlmodel import Session, SQLModel, create_engine

from app.engine import validate_for_persistence
from app.models.knowledge import KnowledgeBase, KnowledgeChunk
from app.models.workflow import EdgePayload, NodePayload, WorkflowGraph
from app.services.knowledge_retrieval import retrieve_keyword_hits, retrieve_multi_path_rerank, retrieve_multi_path_rerank


def test_validate_persistence_accepts_group_and_set_fields():
    g = WorkflowGraph(
        entry="t1",
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="g1", type="group", data={}),
            NodePayload(id="s1", type="set_fields", data={"assignments": {"x": "1"}}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[
            EdgePayload(source="t1", target="g1"),
            EdgePayload(source="g1", target="s1"),
            EdgePayload(source="s1", target="e1"),
        ],
    )
    validate_for_persistence(g)


def test_validate_persistence_knowledge_requires_kb_id():
    g = WorkflowGraph(
        entry="t1",
        nodes=[
            NodePayload(id="t1", type="trigger", data={}),
            NodePayload(id="k1", type="knowledge_retrieve", data={"knowledge_base_id": ""}),
            NodePayload(id="e1", type="end", data={}),
        ],
        edges=[EdgePayload(source="t1", target="k1"), EdgePayload(source="k1", target="e1")],
    )
    with pytest.raises(HTTPException) as exc:
        validate_for_persistence(g)
    assert "knowledge_base_id" in str(exc.value.detail)


def test_retrieve_keyword_hits_chinese_phrase():
    """中文查询应能命中正文中的连续词组（非仅依赖空白分词）。"""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine, tables=[KnowledgeBase.__table__, KnowledgeChunk.__table__])
    with Session(engine) as session:
        kb = KnowledgeBase(id="kb-zh", name="Z", description="")
        session.add(kb)
        session.add(
            KnowledgeChunk(
                knowledge_base_id="kb-zh",
                title="产品说明",
                content="本知识库用于演示检索功能，支持中文关键词。",
                position=0,
            )
        )
        session.commit()
    with Session(engine) as session:
        hits = retrieve_keyword_hits(session, "kb-zh", "中文关键词", top_k=3)
    assert len(hits) >= 1
    assert "中文" in hits[0]["content"] or "关键词" in hits[0]["content"]


def test_retrieve_multi_path_phrase_ranks_above_keyword_only():
    """整句短语命中应在高 phrase 权重下排在仅词法命中的片段之前。"""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine, tables=[KnowledgeBase.__table__, KnowledgeChunk.__table__])
    with Session(engine) as session:
        kb = KnowledgeBase(id="kb-fuse", name="F", description="")
        session.add(kb)
        session.add(
            KnowledgeChunk(
                knowledge_base_id="kb-fuse",
                title="其他",
                content="文档里只有零散词：产品 功能 说明",
                position=0,
            )
        )
        session.add(
            KnowledgeChunk(
                knowledge_base_id="kb-fuse",
                title="精准条",
                content="本产品支持多路召回与重排整句匹配测试用语",
                position=1,
            )
        )
        session.commit()
    query = "多路召回与重排整句匹配测试"
    with Session(engine) as session:
        hits, meta = retrieve_multi_path_rerank(
            session,
            "kb-fuse",
            query,
            top_k=2,
            rag_weights={"keyword": 0.1, "phrase": 0.85, "title": 0.0, "order": 0.05},
            recall_pool_size=50,
            include_breakdown=True,
        )
    assert len(hits) >= 1
    assert hits[0]["title"] == "精准条"
    assert meta.get("hit_count", 0) >= 1


def test_retrieve_keyword_hits_orders_by_score():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    SQLModel.metadata.create_all(engine, tables=[KnowledgeBase.__table__, KnowledgeChunk.__table__])
    with Session(engine) as session:
        kb = KnowledgeBase(id="kb-test", name="T", description="")
        session.add(kb)
        session.add(KnowledgeChunk(knowledge_base_id="kb-test", title="a", content="foo bar unique", position=0))
        session.add(KnowledgeChunk(knowledge_base_id="kb-test", title="b", content="foo foo", position=1))
        session.commit()

    with Session(engine) as session:
        hits = retrieve_keyword_hits(session, "kb-test", "foo bar", top_k=2)
    assert len(hits) == 2
    assert hits[0]["score"] >= hits[1]["score"]
    assert all("foo" in h["content"] for h in hits)
