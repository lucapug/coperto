# Coperto — Project Specification

A single-host waitlist and table management tool for a busy seaside restaurant.

## 1. Context

- Seaside tourist restaurant, **100–120 seats**
- Square tables seating **2–4 guests**, combinable into larger units when needed
- **One host**, one dedicated tablet at the podium, no login
- High turnover during peak season; guests frequently disappear and never return
- No customer-facing interface. No SMS, no email, no notifications.

The tool replaces the paper list. Nothing more.

## 2. Scope

### In scope (MVP)

- Shift lifecycle (open / close)
- Waitlist with manual wait-time estimates
- Table list with live status
- Dynamic table merging, chosen manually by the host, with correct seat accounting
- Auto-expire of seated-but-absent parties
- No-show tracking within a shift
- Side-by-side two-panel UI

### Out of scope

| Excluded | Reason |
|---|---|
| Guest-facing app or web page | Host-only tool |
| SMS / WhatsApp / email notifications | Third-party cost and complexity |
| Visual drag-and-drop floor plan | List view is sufficient at this scale |
| Guest history across shifts | Privacy, and no persistent guest data |
| Authentication and roles | Single trusted device |
| Reporting / analytics | Not needed for MVP |
| Multi-location | Single restaurant |
| Reservation booking | Walk-in only |
| L-shaped or square table configurations | Row-only merging in v1, see 3.4 |

## 3. Domain Model

### 3.1 Shift

The root container. Everything belongs to exactly one shift.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| openedAt | datetime | |
| closedAt | datetime? | null while open |
| status | enum | open / closed |

A shift is opened manually at the start of the day and closed at the end.
Closing is **not** destructive: the shift and its data are retained, but a new
shift starts from an empty waitlist and all tables free.

### 3.2 Table

A physical table on the floor. Static per restaurant, seeded once.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| label | string | e.g. "T12" |
| seats | int | 2, 3 or 4 |
| status | enum | free / occupied / reserved / combined |
| groupId | uuid? | set when merged into a combination |
| lockedByPartyId | uuid? | the party currently holding it |

### 3.3 TableGroup

A temporary unit created when the host merges tables. Lives only within a shift.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| shiftId | uuid | |
| tableIds | uuid[] | ordered, in physical adjacency order |
| grossSeats | int | sum of member table seats |
| usableSeats | int | grossSeats minus 2 per junction |
| junctions | int | tableIds.length - 1 |
| partyId | uuid? | party seated on this group |

Rules:

- Only tables with status `free` can be merged.
- A merged group is atomic: it cannot be partially released.
- Dissolving a group returns every table to `free`.
- The host chooses which tables to merge. No suggestion algorithm.
- `tableIds` is **ordered**: adjacency is defined by the host's selection order,
  since tables are combined side by side in a row.

### 3.4 Seat loss on merge (important)

Two tables pushed side by side lose the two facing seats: one from each table.
Every junction costs 2 seats.

    usableSeats = grossSeats - 2 * (tableCount - 1)

| Combined | Gross | Junctions | Usable |
|---|---|---|---|
| 2 x 4 | 8 | 1 | 6 |
| 3 x 4 | 12 | 2 | 8 |
| 4 x 4 | 16 | 3 | 10 |
| 2 x 2 | 4 | 1 | 2 |
| 2 x 4 + 1 x 2 | 10 | 2 | 6 |

Consequences for the implementation:

- **Never** compute capacity as a plain sum. That overestimates by 2 per junction
  and will seat parties at tables that physically cannot hold them.
- Combining two 2-seaters is almost always a waste (4 gross seats become 2).
  The UI must warn the host when `usableSeats` drops below the smallest party
  size currently waiting.
- Row-only geometry is assumed in v1. An L-shaped or square cluster has a
  different junction count and is explicitly out of scope; if it is ever added,
  `junctions` must become an input rather than a derived value.

### 3.5 Party

A group of guests on the waitlist.

| Field | Type | Notes |
|---|---|---|
| id | uuid | |
| shiftId | uuid | |
| name | string | required |
| size | int | required |
| phone | string | required |
| notes | string? | allergies, high chair, wheelchair, etc. |
| estimatedWait | int (minutes) | entered manually by the host |
| status | enum | waiting / seated / no_show / left |
| tableOrGroupId | uuid? | assigned when seated |
| seatedAt | datetime? | when the host seated them |
| bookedUntil | datetime? | seatedAt + grace period |
| createdAt | datetime | |
| position | int | order in the queue |

### 3.6 Party status transitions

    waiting  --(host seats + assigns table)-->  seated
    waiting  --(host marks gone)------------>  left
    seated   --(guest shows up)------------->  seated  (bookedUntil cleared, table stays occupied)
    seated   --(bookedUntil passed)--------->  no_show (tables released)
    seated   --(host marks left)------------>  left    (tables released)

## 4. Core Behaviours

### 4.1 Adding a party

Required: name, party size, phone. Optional: notes, estimated wait.
The host types the estimate by hand ("~20 min"). No calculation.
New parties are appended to the end of the queue.

### 4.2 Seating a party

1. Host selects a waiting party.
2. Host selects one free table, or several free tables in adjacency order.
3. If several tables are selected, a TableGroup is created and `usableSeats`
   is computed with the formula in 3.4.
4. The host is blocked from seating if `party.size > usableSeats`.
5. Party status becomes `seated`, tables become `reserved`.
6. `bookedUntil` = now + **20 minutes** (configurable constant).

The tables are held but not yet consumed. The guest has not arrived.

### 4.3 Auto-expire

A periodic check (client-side interval and server-side sweep, both) evaluates:

    if party.status == seated and now > party.bookedUntil:
        party.status = no_show
        release every table in the group back to free

The 20 minute window is a single constant, easy to tune.

### 4.4 No-show section

Expired parties move to a separate, visually distinct section of the waitlist panel.
They stay there for the rest of the shift. The host can:

- see who flaked and when
- re-add the party to the queue manually if they walk back in
- **not** restore them automatically

### 4.5 Closing a shift

Host taps "Close shift". Any party still `waiting` or `seated` is marked `left`.
All tables return to `free`, every TableGroup is dissolved. The shift is marked closed.

## 5. UI

Two panels, side by side, on a tablet in landscape.

A combined group is **never** rendered as independent rows. It appears as one
block: a group header with the usable seat count and its member tables, indented
under it, sharing a background tint.

    +--------------------------------+--------------------------------+
    |  WAITLIST                      |  TABLES                        |
    |                                |                                |
    |  [ + Add party ]               |  T2   2 seats   free           |
    |                                |  T3   4 seats   reserved       |
    |  #1 Rossi  4p  ~25m  [Seat]    |  T6   4 seats   occupied       |
    |  #2 Bianchi 2p ~10m  [Seat]    |                                |
    |  #3 Verdi  6p  ~40m  [Seat]    |  G1  8 seats  (T1+T5+T7)       |
    |                                |    T1  4 seats  combined       |
    |  --- No-show ---               |    T5  4 seats  combined       |
    |  Greco  3p  expired 14:22      |    T7  4 seats  combined       |
    |                                |                                |
    |                                |  [ Combine selected ]          |
    +--------------------------------+--------------------------------+

Interaction notes:

- Tapping a waiting party selects it; tapping tables then taps "Seat".
- Multi-tapping tables before seating triggers a merge. Selection order matters.
- The group header updates live during selection, so the host sees the usable
  seat count *before* confirming the merge.
- Warning state on the header when `usableSeats` is lower than the smallest
  waiting party.
- No drag-and-drop. Tap only, usable with one hand while standing.

## 6. Non-functional Requirements

| Concern | Requirement |
|---|---|
| Target device | Tablet, landscape, one dedicated unit |
| Network | Must survive short outages; local-first with server sync |
| Latency | Any action reflected on screen in under 200 ms |
| Auto-expire accuracy | Checked at least every 30 s |
| Data retention | Shifts kept indefinitely, small volume |
| Accessibility | Large tap targets, high contrast (sunlight on a terrace) |
| Privacy | Phone numbers stored, never displayed to any guest |

Minimum body text 16 px, minimum tap target 44 px.

## 7. Suggested Stack

Kept deliberately boring — single developer, small surface area.

- **Frontend:** React + TypeScript, Vite. No component library beyond
  utility CSS (Tailwind) to keep the tablet UI fast to build.
- **Backend:** Node + TypeScript, Fastify or Express. Thin REST API.
- **Database:** SQLite via better-sqlite3. One file, zero ops, and at
  100–120 tables and a few hundred parties per shift it is far beyond
  enough. Swap to Postgres later only if multi-location ever appears.
- **State sync:** Client polls or uses SSE. No WebSocket needed at this scale.
- **Auth:** None.
- **Deploy:** Single Docker container, SQLite volume. Runs on any cheap VPS.

## 8. Open Questions

To resolve before implementation:

1. Should a party be allowed to change its size after being added?
2. Should the host be able to reorder the queue manually, or is it strictly FIFO?
3. Should the grace period differ by party size (larger parties take longer to walk back)?
4. Should the app print or export the list as a fallback if the tablet dies?
5. Do tables ever get taken out of service (broken, reserved for a private event)?
6. Will L-shaped or square table clusters ever be needed? This changes the
   seat formula, see 3.4.

## 9. Milestones

- [ ] **M1 — Skeleton**: repo, CI, SQLite schema, shift open/close
- [ ] **M2 — Tables**: table seed, list view, status transitions, manual merge
- [ ] **M3 — Waitlist**: add party, queue, seat a party onto a table or group
- [ ] **M4 — Auto-expire**: grace period, no-show section, table release
- [ ] **M4b — Merge geometry**: usable seat calculation, group header rendering, wasteful-merge warning, hard block on oversized parties
- [ ] **M5 — UI polish**: two-panel layout, tablet sizing, sunlight contrast
- [ ] **M6 — Hardening**: offline resilience, shift close, edge cases
