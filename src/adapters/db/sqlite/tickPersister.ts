import type { Database } from "bun:sqlite";
import type { DeviceStatus, Metric } from "@domain/entities";
import type { StateTransitionRecord, TickPersister } from "@ports/services";

export class SqliteTickPersister implements TickPersister {
  constructor(private db: Database) {}

  async persist(statusUpdates: DeviceStatus[], metrics: Metric[], transitions: StateTransitionRecord[] = []): Promise<void> {
    const upsertStatus = this.db.query<any, any>(
      `INSERT INTO device_status (device_id, tenant_id, state, since, last_seen, last_latency_ms, consecutive_fails, consecutive_ok, transition_log)
       VALUES ($device_id,$tenant_id,$state,$since,$last_seen,$last_latency_ms,$consecutive_fails,$consecutive_ok,$transition_log)
       ON CONFLICT(device_id) DO UPDATE SET
         state=excluded.state, since=excluded.since, last_seen=excluded.last_seen,
         last_latency_ms=excluded.last_latency_ms, consecutive_fails=excluded.consecutive_fails,
         consecutive_ok=excluded.consecutive_ok, transition_log=excluded.transition_log`
    );
    const insertMetric = this.db.query<any, any>(
      `INSERT INTO metrics (tenant_id, device_id, check_id, ts, name, value) VALUES ($tenant_id,$device_id,$check_id,$ts,$name,$value)`
    );
    const closeHistory = this.db.query<any, any>(
      `UPDATE device_state_history SET ended_at=$at WHERE device_id=$device_id AND ended_at IS NULL`
    );
    const openHistory = this.db.query<any, any>(
      `INSERT INTO device_state_history (tenant_id, device_id, state, started_at, ended_at) VALUES ($tenant_id,$device_id,$state,$at,NULL)`
    );

    const tx = this.db.transaction(() => {
      for (const s of statusUpdates) {
        upsertStatus.run({
          $device_id: s.deviceId,
          $tenant_id: s.tenantId,
          $state: s.state,
          $since: s.since,
          $last_seen: s.lastSeen,
          $last_latency_ms: s.lastLatencyMs,
          $consecutive_fails: s.consecutiveFails,
          $consecutive_ok: s.consecutiveOk,
          $transition_log: JSON.stringify(s.transitionLog),
        });
      }
      for (const m of metrics) {
        insertMetric.run({
          $tenant_id: m.tenantId,
          $device_id: m.deviceId,
          $check_id: m.checkId,
          $ts: m.ts,
          $name: m.name,
          $value: m.value,
        });
      }
      for (const t of transitions) {
        closeHistory.run({ $device_id: t.deviceId, $at: t.atIso });
        openHistory.run({ $tenant_id: t.tenantId, $device_id: t.deviceId, $state: t.newState, $at: t.atIso });
      }
    });
    tx();
  }
}
