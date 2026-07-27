import type { Pool } from "pg";
import type { DeviceStatus, Metric } from "@domain/entities";
import type { StateTransitionRecord, TickPersister } from "@ports/services";

/**
 * Multiple poller processes (M1's sharded pollers, each owning a disjoint set of leased devices)
 * write through this concurrently — unlike the single-process SQLite version, there's no shared
 * in-memory transaction object to serialize against, so each persist() call gets its own pooled
 * client + transaction. Device-status upserts are naturally conflict-free across pollers (each
 * status row is only ever written by the one poller currently leasing that device), so no
 * cross-poller locking is needed beyond Postgres's own row-level locking on the UPSERT itself.
 */
export class PgTickPersister implements TickPersister {
  constructor(private db: Pool) {}

  async persist(statusUpdates: DeviceStatus[], metrics: Metric[], transitions: StateTransitionRecord[] = []): Promise<void> {
    if (statusUpdates.length === 0 && metrics.length === 0 && transitions.length === 0) return;

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");

      for (const s of statusUpdates) {
        await client.query(
          `INSERT INTO device_status (device_id, tenant_id, state, since, last_seen, last_latency_ms, consecutive_fails, consecutive_ok, transition_log)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (device_id) DO UPDATE SET
             state=excluded.state, since=excluded.since, last_seen=excluded.last_seen,
             last_latency_ms=excluded.last_latency_ms, consecutive_fails=excluded.consecutive_fails,
             consecutive_ok=excluded.consecutive_ok, transition_log=excluded.transition_log`,
          [
            s.deviceId,
            s.tenantId,
            s.state,
            s.since,
            s.lastSeen,
            s.lastLatencyMs,
            s.consecutiveFails,
            s.consecutiveOk,
            JSON.stringify(s.transitionLog),
          ]
        );
      }

      for (const m of metrics) {
        await client.query(
          `INSERT INTO metrics (tenant_id, device_id, check_id, ts, name, value) VALUES ($1,$2,$3,$4,$5,$6)`,
          [m.tenantId, m.deviceId, m.checkId, m.ts, m.name, m.value]
        );
      }

      for (const t of transitions) {
        await client.query(`UPDATE device_state_history SET ended_at=$1 WHERE device_id=$2 AND ended_at IS NULL`, [t.atIso, t.deviceId]);
        await client.query(
          `INSERT INTO device_state_history (tenant_id, device_id, state, started_at, ended_at) VALUES ($1,$2,$3,$4,NULL)`,
          [t.tenantId, t.deviceId, t.newState, t.atIso]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
