from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Engine
from sqlalchemy.orm import sessionmaker

from . import errors
from .db import database_url_from_env, make_engine
from .orm import Base
from .routers import maintenance, parties, shift, tables
from .seed import seed_demo_data
from .store import DatabaseStore, seed_tables


def create_app(
    engine: Engine | None = None,
    db_url: str | None = None,
    now_fn=None,
    seed_demo: bool = True,
) -> FastAPI:
    """Build the app. Database resolution order: explicit engine, explicit
    URL, then the COPERTO_DB environment variable (default sqlite file)."""
    engine = engine or make_engine(db_url or database_url_from_env())
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, expire_on_commit=False)
    store = DatabaseStore(session_factory, now_fn=now_fn)
    seed_tables(session_factory)
    if seed_demo:
        seed_demo_data(store)

    app = FastAPI(
        title="Coperto Backend API",
        version="0.1.0",
        description=(
            "FastAPI implementation of the contract in openapi.yaml (domain "
            "rules: docs/plan.md), backed by SQLAlchemy. The database comes "
            "from the COPERTO_DB environment variable; demo data is seeded "
            "on first boot only."
        ),
    )
    app.state.store = store
    app.state.session_factory = session_factory
    app.state.engine = engine
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
    return app


app = create_app()
