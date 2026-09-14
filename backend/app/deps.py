from fastapi import Request

from .store import DatabaseStore


def get_store(request: Request) -> DatabaseStore:
    return request.app.state.store
