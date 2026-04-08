"""SQLite 轻量补丁：在 create_all 之后为已存在的表追加列（ORM 不会自动 ALTER）。"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Engine


def apply_sqlite_schema_patches(engine: Engine) -> None:
    url = str(engine.url)
    if not url.startswith("sqlite"):
        return
    with engine.connect() as conn:
        r = conn.execute(text("PRAGMA table_info(knowledgechunk)"))
        cols = {row[1] for row in r.fetchall()}
        alters: list[str] = []
        if "embedding_json" not in cols:
            alters.append("ALTER TABLE knowledgechunk ADD COLUMN embedding_json TEXT")
        if "embedding_model" not in cols:
            alters.append("ALTER TABLE knowledgechunk ADD COLUMN embedding_model TEXT")
        if "meta_json" not in cols:
            alters.append("ALTER TABLE knowledgechunk ADD COLUMN meta_json TEXT")
        for stmt in alters:
            conn.execute(text(stmt))
        conn.commit()
