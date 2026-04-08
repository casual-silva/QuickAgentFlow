"""知识检索：多路召回 + 分路归一化 + 加权融合重排（无向量依赖，SQLite 友好）。

四路召回：
- keyword：标题+正文上的中英 token / 二字片段命中（细粒度词法）
- phrase：整查询子串 + 最长中文子串命中（强语义、防拆词）
- title：仅在标题上的词法命中（目录/主题对齐）
- order：用户维护的 position 顺序弱先验（靠前片段略优先）

融合：各路径在召回池内 min-max 归一化后按权重求和，再全序排序取 top_k。
"""

from __future__ import annotations

import json
import math
import re
from typing import Any, Dict, List, Mapping, Optional, Tuple

from sqlmodel import Session, select

from ..models.knowledge import KnowledgeChunk

# 默认权重（和为 1）；可在节点 data.rag_weights 中覆盖；dense 默认 0 保持与旧工作流一致
DEFAULT_RAG_WEIGHTS: Dict[str, float] = {
    "keyword": 0.38,
    "phrase": 0.37,
    "title": 0.20,
    "order": 0.05,
    "dense": 0.0,
}

DEFAULT_RECALL_POOL_SIZE = 64
MAX_RECALL_POOL = 200


def _retrieval_tokens(query: str) -> List[str]:
    """从查询抽取检索词：英文/数字连续段 + 中文连续字串及二字组合（去重保序）。"""
    q = query.strip()
    if not q:
        return []
    tokens: List[str] = []
    lower = q.lower()
    for m in re.finditer(r"[a-z0-9]{2,}", lower):
        tokens.append(m.group(0))
    for seg in re.findall(r"[\u4e00-\u9fff]+", q):
        if len(seg) <= 2:
            tokens.append(seg)
        else:
            tokens.append(seg)
            for i in range(len(seg) - 1):
                tokens.append(seg[i : i + 2])
    seen: set[str] = set()
    out: List[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out if out else [q]


def _longest_cjk_run(query: str) -> str:
    segs = re.findall(r"[\u4e00-\u9fff]+", query)
    return max(segs, key=len) if segs else ""


def _score_keyword_on_text(text: str, text_lower: str, tokens: List[str]) -> float:
    s = 0.0
    for tok in tokens:
        if re.search(r"[\u4e00-\u9fff]", tok):
            s += float(text.count(tok))
        else:
            s += float(text_lower.count(tok.lower()))
    return s


def _raw_keyword_scores(chunks: List[KnowledgeChunk], query: str) -> Dict[int, float]:
    tk = _retrieval_tokens(query)
    out: Dict[int, float] = {}
    for c in chunks:
        blob = f"{c.title}\n{c.content}"
        sc = _score_keyword_on_text(blob, blob.lower(), tk)
        if sc > 0 and c.id is not None:
            out[c.id] = sc
    return out


def _raw_phrase_scores(chunks: List[KnowledgeChunk], query: str) -> Dict[int, float]:
    """短语路：整句/整查询匹配 + 最长中文子串。"""
    q = query.strip()
    if len(q) < 2:
        return {}
    q_lower = q.lower()
    longest = _longest_cjk_run(q)
    out: Dict[int, float] = {}
    for c in chunks:
        if c.id is None:
            continue
        blob = f"{c.title}\n{c.content}"
        blob_l = blob.lower()
        s = 0.0
        if re.search(r"[\u4e00-\u9fff]", q):
            s += 6.0 * float(blob.count(q))
        else:
            s += 6.0 * float(blob_l.count(q_lower))
        if longest and len(longest) >= 2 and longest != q.strip():
            s += 3.0 * float(blob.count(longest))
        if s > 0:
            out[c.id] = s
    return out


def _raw_title_scores(chunks: List[KnowledgeChunk], query: str) -> Dict[int, float]:
    tk = _retrieval_tokens(query)
    out: Dict[int, float] = {}
    for c in chunks:
        if c.id is None:
            continue
        title = (c.title or "").strip()
        if not title:
            continue
        t_lower = title.lower()
        sc = _score_keyword_on_text(title, t_lower, tk)
        if sc > 0:
            out[c.id] = sc
    return out


def _raw_order_scores(chunks: List[KnowledgeChunk]) -> Dict[int, float]:
    """顺序路：position 越小分越高（用户排序先验）。"""
    out: Dict[int, float] = {}
    for c in chunks:
        if c.id is None:
            continue
        out[c.id] = 1.0 / (1.0 + float(c.position))
    return out


def _normalize_weights(user: Optional[Mapping[str, Any]]) -> Dict[str, float]:
    w = dict(DEFAULT_RAG_WEIGHTS)
    if isinstance(user, Mapping):
        for k in DEFAULT_RAG_WEIGHTS:
            if k in user and user[k] is not None:
                try:
                    w[k] = float(user[k])
                except (TypeError, ValueError):
                    pass
    total = sum(max(0.0, v) for v in w.values())
    if total <= 0:
        return dict(DEFAULT_RAG_WEIGHTS)
    return {k: max(0.0, v) / total for k, v in w.items()}


def _parse_embedding_vector(chunk: KnowledgeChunk) -> Optional[List[float]]:
    raw = getattr(chunk, "embedding_json", None) or None
    if not raw or not str(raw).strip():
        return None
    try:
        data = json.loads(str(raw))
        if isinstance(data, list) and data and isinstance(data[0], (int, float)):
            return [float(x) for x in data]
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    return None


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (na * nb)


def _raw_dense_scores(chunks: List[KnowledgeChunk], query_vec: Optional[List[float]]) -> Dict[int, float]:
    """余弦相似度作为原始分；仅维度一致的块参与。"""
    if not query_vec:
        return {}
    out: Dict[int, float] = {}
    for c in chunks:
        if c.id is None:
            continue
        ev = _parse_embedding_vector(c)
        if ev and len(ev) == len(query_vec):
            s = _cosine_similarity(query_vec, ev)
            if s > 0:
                out[c.id] = s
    return out


def _min_max_norm_over_ids(raw: Dict[int, float], ids: List[int]) -> Dict[int, float]:
    """对给定 id 列表做 min-max；全 0 则全 0；单点正值则置 1.0。"""
    vals = [raw.get(i, 0.0) for i in ids]
    pos = [(i, v) for i, v in zip(ids, vals) if v > 0]
    if not pos:
        return {i: 0.0 for i in ids}
    if len(pos) == 1:
        return {i: (1.0 if i == pos[0][0] else 0.0) for i in ids}
    vs = [v for _, v in pos]
    lo, hi = min(vs), max(vs)
    if hi <= lo:
        return {i: (1.0 if raw.get(i, 0) > 0 else 0.0) for i in ids}
    out = {i: 0.0 for i in ids}
    for i, v in pos:
        out[i] = (v - lo) / (hi - lo)
    return out


def _build_recall_pool(
    raw_kw: Dict[int, float],
    raw_ph: Dict[int, float],
    raw_ti: Dict[int, float],
    raw_dn: Dict[int, float],
    pool_limit: int,
) -> List[int]:
    """合并多路候选：任一路>0 入池；过多时按 keyword+phrase+title+dense 粗分截断。"""
    ids_set = set(raw_kw) | set(raw_ph) | set(raw_ti) | {i for i, v in raw_dn.items() if v > 1e-12}
    if not ids_set:
        return []
    cap = max(8, min(max(1, int(pool_limit or DEFAULT_RECALL_POOL_SIZE)), MAX_RECALL_POOL))

    def rough(c_id: int) -> float:
        return (
            raw_kw.get(c_id, 0)
            + raw_ph.get(c_id, 0) * 1.2
            + raw_ti.get(c_id, 0) * 1.1
            + raw_dn.get(c_id, 0) * 1.3
        )

    ranked = sorted(ids_set, key=lambda i: (-rough(i), -i))
    return ranked[:cap]


def query_preprocessing_explain(query: str) -> Dict[str, Any]:
    """供管理端「检索预览」展示：查询如何被拆成 token / 最长中文子串（与执行路径一致）。"""
    q = (query or "").strip()
    if not q:
        return {"tokens": [], "longest_cjk_substring": "", "token_count": 0, "note": "empty_query"}
    tk = _retrieval_tokens(q)
    return {
        "tokens": tk,
        "longest_cjk_substring": _longest_cjk_run(q),
        "token_count": len(tk),
    }


def retrieve_multi_path_rerank(
    session: Session,
    knowledge_base_id: str,
    query: str,
    top_k: int,
    *,
    rag_weights: Optional[Mapping[str, Any]] = None,
    recall_pool_size: Optional[int] = None,
    include_breakdown: bool = True,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """多路召回 + 加权重排；返回 (hits, debug_meta)。"""
    statement = (
        select(KnowledgeChunk)
        .where(KnowledgeChunk.knowledge_base_id == knowledge_base_id)
        .order_by(KnowledgeChunk.position.asc(), KnowledgeChunk.id.asc())
    )
    chunks = list(session.exec(statement).all())
    q = (query or "").strip()
    weights = _normalize_weights(rag_weights)
    pool_sz = int(recall_pool_size or DEFAULT_RECALL_POOL_SIZE)

    meta: Dict[str, Any] = {
        "weights": weights,
        "recall_pool_size": pool_sz,
        "query": q,
        "total_chunks": len(chunks),
    }

    if not chunks or not q:
        return [], meta

    raw_kw = _raw_keyword_scores(chunks, q)
    raw_ph = _raw_phrase_scores(chunks, q)
    raw_ti = _raw_title_scores(chunks, q)
    raw_ord = _raw_order_scores(chunks)

    has_stored_vec = any(_parse_embedding_vector(c) is not None for c in chunks)
    query_vec: Optional[List[float]] = None
    if has_stored_vec and weights.get("dense", 0.0) > 1e-12:
        from .knowledge_embeddings import embed_query_text

        query_vec = embed_query_text(q)
    raw_dn = _raw_dense_scores(chunks, query_vec)
    meta["dense_path_active"] = bool(query_vec and raw_dn)
    meta["chunks_with_embedding"] = sum(1 for c in chunks if _parse_embedding_vector(c) is not None)

    pool_ids = _build_recall_pool(raw_kw, raw_ph, raw_ti, raw_dn, pool_sz)
    if not pool_ids:
        return [], {**meta, "reason": "no_recall_path_hit", "pool_ids_count": 0, "hit_count": 0}

    norm_kw = _min_max_norm_over_ids(raw_kw, pool_ids)
    norm_ph = _min_max_norm_over_ids(raw_ph, pool_ids)
    norm_ti = _min_max_norm_over_ids(raw_ti, pool_ids)
    norm_ord = _min_max_norm_over_ids(raw_ord, pool_ids)
    norm_dn = _min_max_norm_over_ids(raw_dn, pool_ids)

    id_to_chunk = {c.id: c for c in chunks if c.id is not None}
    wd = weights.get("dense", 0.0)
    fused: List[Tuple[float, int]] = []
    for cid in pool_ids:
        final = (
            weights["keyword"] * norm_kw.get(cid, 0.0)
            + weights["phrase"] * norm_ph.get(cid, 0.0)
            + weights["title"] * norm_ti.get(cid, 0.0)
            + weights["order"] * norm_ord.get(cid, 0.0)
            + wd * norm_dn.get(cid, 0.0)
        )
        fused.append((final, cid))

    fused.sort(key=lambda x: (-x[0], -x[1]))
    k = max(1, min(int(top_k or 5), 50))

    hits: List[Dict[str, Any]] = []
    for final_sc, cid in fused[:k]:
        c = id_to_chunk.get(cid)
        if c is None:
            continue
        item: Dict[str, Any] = {
            "id": c.id,
            "title": c.title,
            "content": c.content,
            "score": round(float(final_sc), 6),
        }
        if include_breakdown:
            item["score_breakdown"] = {
                "keyword_raw": round(raw_kw.get(cid, 0.0), 4),
                "phrase_raw": round(raw_ph.get(cid, 0.0), 4),
                "title_raw": round(raw_ti.get(cid, 0.0), 4),
                "order_raw": round(raw_ord.get(cid, 0.0), 4),
                "dense_raw": round(raw_dn.get(cid, 0.0), 4),
                "keyword_norm": round(norm_kw.get(cid, 0.0), 4),
                "phrase_norm": round(norm_ph.get(cid, 0.0), 4),
                "title_norm": round(norm_ti.get(cid, 0.0), 4),
                "order_norm": round(norm_ord.get(cid, 0.0), 4),
                "dense_norm": round(norm_dn.get(cid, 0.0), 4),
                "final": round(float(final_sc), 6),
            }
        hits.append(item)

    meta["pool_ids_count"] = len(pool_ids)
    meta["hit_count"] = len(hits)
    return hits, meta


def retrieve_keyword_hits(session: Session, knowledge_base_id: str, query: str, top_k: int) -> List[Dict[str, Any]]:
    """兼容旧调用：等价于仅 keyword 权重 1、其余为 0 的单路检索。"""
    hits, _ = retrieve_multi_path_rerank(
        session,
        knowledge_base_id,
        query,
        top_k,
        rag_weights={"keyword": 1.0, "phrase": 0.0, "title": 0.0, "order": 0.0, "dense": 0.0},
        recall_pool_size=MAX_RECALL_POOL,
        include_breakdown=False,
    )
    for h in hits:
        h["score"] = round(float(h["score"]), 4)
    return hits
