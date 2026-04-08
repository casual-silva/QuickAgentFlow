from contextlib import contextmanager
from typing import Generator

from sqlmodel import Session, SQLModel, create_engine

from ..core.settings import Settings
from ..models import knowledge as _knowledge_models  # noqa: F401
from ..models import run as _run_models  # noqa: F401
from ..models import template as _template_models  # noqa: F401
from ..models import trace as _trace_models  # noqa: F401
from ..models import workflow as _workflow_models  # noqa: F401
from .schema_patch import apply_sqlite_schema_patches

settings = Settings()
settings.ensure_paths()

engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    apply_sqlite_schema_patches(engine)


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
