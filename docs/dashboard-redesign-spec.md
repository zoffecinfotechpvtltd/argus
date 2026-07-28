# Dashboard redesign — Phase 1 audit + Phase 2 spec

Written before touching code, per the requested process. Everything under "Widget inventory"
below is grounded in a real API route or a value derivable from one — nothing here is invented
data. Where the source doesn't exist yet, it's called out explicitly under "Needs new backend."

## Phase 1 — Audit findings

**Current duplication** (already fixed in v0.3.9): Availability appeared in 3 places (hero tile,
a gauge card, SLA headroom card). Reduced to 2 — hero tile (headline number) and SLA headroom
(framed as target/headroom, not a repeat of the same number).

**Current chart-type inventory** (`ui/src/pages/Dashboard.tsx`): donut ×2, treemap ×1 (was a
strip), grouped bar ×1 (was radar), stacked bar ×1, horizontal bar ×1, area ×2, scatter ×1,
custom heatmap ×1, custom sparklines. Reasonable variety already; the real gaps are library
capability (no zoom/brush, no calendar-correct heatmap, no graph layout beyond d3-force's basic
physics sim) and missing widget categories entirely (no incident view, no table library, no geo).

**Backend data inventory** (from `src/api/routes/*`):
- `/summary` — fleet totals, today's availability, open-alert counts by severity.
- `/devices?withStatus=true` — per-device state, latency, group, type.
- `/reports/sla?groupId&from&to` — per-device availability % and downtime over any window.
- `/reports/alerts-summary?from&to` — alert counts by day+severity.
- `/reports/inventory` — device breakdown by type/vendor.
- `/metrics/:deviceId?range&name` — any named time series (latency, `ifN.inBps/outBps`), raw
  ≤24h then hourly rollups.
- `/metrics/:deviceId/percentile95` — p95 for a metric/range.
- `/audit` — paginated audit log, filterable by user/action/time.
- `/topology/positions`, `/groups` — existing Map page's graph structure.
- `/alerts?status&limit` — open alerts list.

**Missing entirely** (confirmed by grep, not assumed): incident correlation (grouping "4 devices
down" into one incident), MTTD/MTTA/MTTR calculation, alert-noise classification
(actionable/duplicate/suppressed), geographic site coordinates, packet-loss/jitter metrics (only
latency and bandwidth are polled today), capacity/threshold-band configuration per interface.

## Phase 2 — Spec

### Widget inventory & chart-type mapping

| Widget | Chart type | Data source | Phase |
|---|---|---|---|
| KPI strip (8 tiles: health score, devices up/degraded/down, critical alerts, SLA, avg latency) | KPI card + sparkline (Recharts, existing) | `/summary` + client-buffered history (existing `statHistory` pattern) | 4a |
| Alert table | TanStack Table | `/alerts` | 4b |
| Device inventory table | TanStack Table | `/devices` | 4b |
| Network topology | ECharts `graph` series | `/devices`, `/groups`, `/topology/positions` (same data the current Map page uses) | 5a |
| Alert activity calendar | ECharts `calendar` + `heatmap` | `/reports/alerts-summary` | 5b |
| Network traffic (in/out, zoomable) | ECharts dual-line + `dataZoom` | `/metrics/:id?name=ifN.inBps/outBps` | 5c |
| Latency trend (p50/p95/p99) | ECharts multi-line | `/metrics/:id` + `/metrics/:id/percentile95` | 5c |
| Device health by group | Recharts 100% stacked bar (existing `GroupStateBarCard`, restyle only) | `/devices` | 3 |
| Device type composition | Recharts `Treemap` (existing, v0.3.9) | `/devices` | done |
| Latency vs. reliability | Recharts `Scatter` (existing, v0.3.8) | `/devices` + `/reports/sla` | done |
| SLA / error budget | Bullet-style linear progress (new small component, no chart lib needed) | `/reports/sla` | 5d |
| Group health comparison | Recharts grouped bar (existing, v0.3.9) | `/devices` | done |

### Explicitly NOT buildable without new backend work (Phase 6)

- **Incident timeline / correlation** ("4 devices unreachable through core-router-01") — needs a
  real correlation algorithm (e.g., group simultaneous alerts by shared uplink/group within a time
  window) as a new backend module, not a frontend grouping of already-independent alert rows.
- **MTTD/MTTA/MTTR** — needs alert-lifecycle timestamps (detected/acked/resolved deltas) aggregated
  server-side; partially derivable from existing `alerts` table columns (`opened_at`, `acked_at`,
  `resolved_at` already exist per the schema) — smaller lift than I first estimated, worth doing
  as a real Phase 6 item.
- **Alert noise ratio** — needs a definition of "duplicate" and "suppressed" that doesn't exist in
  the domain model yet.
- **Geographic site map** — needs site lat/long stored somewhere; groups have no location field
  today.
- **Packet loss / jitter chart** — needs a new check type; only ICMP latency is polled, not loss %.

These will get their own design pass once Phases 3-5 are shipped and reviewed.

### Bento layout (desktop, 12-col)

Row 1: KPI strip (full width, 8 tiles).
Row 2: Alert table (full width) — promoted above charts since "what needs attention" beats
charts on a NOC screen, per the brief's own stated priority order.
Row 3: Network topology (span 8) + Group health comparison (span 4).
Row 4: Alert activity calendar (span 5) + Alerts trend (span 7).
Row 5: Device mix treemap (span 4) + Latency vs. reliability (span 4) + SLA headroom (span 4).
Row 6: Device inventory table (full width).

Customizable drag/resize (Phase 7) deferred — ship a good fixed layout first, add
personalization once the widget set is stable enough to be worth persisting layouts for.

### Design tokens

No change. `ui/tailwind.config.js` already has a complete token set (status colors, categorical
palette, spacing/type/radius/shadow scales, `Geist`/`Geist Mono`) — every new widget below draws
from these, not new ad-hoc values.
