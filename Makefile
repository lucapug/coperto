.DEFAULT_GOAL := help

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

backend: ## Run the FastAPI backend on :3000 (seeded demo data)
	cd backend && uv run uvicorn app.main:app --reload --port 3000

frontend: ## Run the Vite dev server on :5173 (in-memory mock backend)
	cd frontend && npm run dev

install: ## Install dependencies for backend and frontend
	cd backend && uv sync
	cd frontend && npm install

test: test-backend test-frontend ## Run all tests

test-backend: ## Run backend tests (pytest)
	cd backend && uv run pytest

test-frontend: ## Run frontend tests (vitest)
	cd frontend && npm test

.PHONY: help backend frontend install test test-backend test-frontend
