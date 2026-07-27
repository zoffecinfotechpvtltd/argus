import type { Pool } from "pg";
import type { HistoryRepo, StateInterval } from "@ports/repos";

/** M6: mirrors SqliteHistoryRepo (src/adapters/db/sqlite/reportingRepos.ts) exactly — same query
 * semantics (overlap of [fromIso, toIso] against [started_at, ended_at ?? open-ended]), translated
 * to parameterized Postgres. `device_state_history` already exists in migrations-pg/0001_init.sql,
 * so no new migration is needed for this port. TopologyRepo stays `notYetPortedRepo` — that one's
 * M7 (see SAAS_GAPS.md), not touched here. */
export class PgHistoryRepo implements HistoryRepo {
  constructor(private db: Pool) {}

  async listStateIntervals(tenantId: string, deviceId: string, state: string, fromIso: string, toIso: string): Promise<StateInterval[]> {
    const { rows } = await this.db.query(
      `SELECT started_at, ended_at FROM device_state_history
       WHERE tenant_id=$1 AND device_id=$2 AND state=$3
         AND started_at <= $4 AND (ended_at IS NULL OR ended_at >= $5)
       ORDER BY started_at`,
      [tenantId, deviceId, state, toIso, fromIso]
    );
    return rows.map((r: any) => ({ startedAt: r.started_at, endedAt: r.ended_at }));
  }
}
