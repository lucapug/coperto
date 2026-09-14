# Coperto

A single-host waitlist and table management tool for a busy seaside restaurant. It replaces the paper list at the host's podium — nothing more.

## What it does

- **Waitlist**: add walk-in parties (name, size, phone, notes) with manual wait-time estimates, in a strict queue.
- **Tables**: live status of every table (free / reserved / occupied / combined).
- **Table merging**: combine square tables side by side into larger units, with correct seat accounting — every junction between two tables costs 2 seats (`usableSeats = grossSeats − 2 × junctions`). The host is blocked from seating a party bigger than the usable seats.
- **Auto-expire**: parties marked as seated but absent expire after a 20-minute grace period, become no-shows, and their tables are released automatically.
- **Shifts**: open/close the day; closing is non-destructive, each shift starts from a clean slate.

Built for one dedicated tablet in landscape, used by one host with one hand while standing. No login, no guest-facing app, no notifications.

## Docs

The full specification lives in [`docs/plan.md`](docs/plan.md).

## Status

Pre-MVP — see the milestones in the spec.
