from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import errors
from .routers import maintenance, parties, shift, tables
from .seed import seed_demo_data
from .store import InMemoryStore


def create_app(
    store: InMemoryStore | None = None, seed_demo: bool = True
) -> FastAPI:
    app = FastAPI(
        title="Coperto Backend API",
        version="0.1.0",
        description=(
            "In-memory FastAPI implementation of the contract in openapi.yaml "
            "(domain rules: docs/plan.md). Demo data is seeded at startup."
        ),
    )
    app.state.store = store or InMemoryStore()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    errors.install_error_handlers(app)
    app.include_router(shift.router)
    app.include_router(tables.router)
    app.include_router(parties.router)
    app.include_router(maintenance.router)
    if seed_demo:
        seed_demo_data(app.state.store)
    return app


app = create_app()
