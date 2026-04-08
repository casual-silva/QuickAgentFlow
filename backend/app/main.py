from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.router import api_router
from .core.settings import Settings
from .db.session import init_db

settings = Settings()

app = FastAPI(
    title="QuickAgent Workflow Platform API",
    version="0.1.0",
    description="V0 backend with ORM + Pydantic-first design",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}
