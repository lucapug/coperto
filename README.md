# Coperto

A single-host waitlist and table management tool for a busy seaside restaurant. It replaces the paper list at the host's podium — nothing more.

## What it does

- **Waitlist**: add walk-in parties (name, size, phone, notes) with manual wait-time estimates, in a strict queue.
- **Tables**: live status of every table (free / reserved / occupied / combined).
- **Table merging**: combine square tables side by side into larger units, with correct seat accounting — every junction between two tables costs 2 seats (`usableSeats = grossSeats − 2 × junctions`). The host is blocked from seating a party bigger than the usable seats.
- **Auto-expire**: parties marked as seated but absent expire after a 20-minute grace period, become no-shows, and their tables are released automatically.
- **Shifts**: open/close the day; closing is non-destructive, each shift starts from a clean slate.

Built for one dedicated tablet in landscape, used by one host with one hand while standing. No login, no guest-facing app, no notifications.

## Try it

Run both halves:

```bash
make backend    # FastAPI on :3000, seeded demo data
make frontend   # Vite dev server on :5173, talks to the backend
```

The frontend consumes the backend through a single services layer behind the
`ApiService` interface ([api.ts](frontend/src/services/api.ts)). Two
implementations: [HttpApi](frontend/src/services/http/httpApi.ts) (default —
REST per `openapi.yaml`, set `VITE_API_URL` to override the base URL) and
[MockApi](frontend/src/services/mock/mockApi.ts) (in-memory, used by the
component tests). Run everything with `make test`.

## Run the backend

FastAPI implementation of the contract in [`openapi.yaml`](openapi.yaml), backed
by SQLite through SQLAlchemy:

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 3000
```

The database comes from the `COPERTO_DB` environment variable (default
`sqlite:///coperto.db`). Any SQLAlchemy URL works — e.g.
`COPERTO_DB=postgresql+psycopg://user:pw@host/coperto` — since the schema is
portable (UUID keys, tz-aware datetimes, no SQLite-only features). Demo data
is seeded on first boot only and survives restarts.

Interactive docs at `http://localhost:3000/docs`. Or simply `make backend`
from the repo root (see `make help` for all targets). Tests:

```bash
cd backend && uv run pytest
```

## Docs

The full specification lives in [`docs/plan.md`](docs/plan.md).

## Status

Pre-MVP — see the milestones in the spec.
