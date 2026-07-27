import type { Database } from "bun:sqlite";
import type { HistoryRepo, StateInterval, TopologyPosition, TopologyRepo } from "@ports/repos";

export class SqliteHistoryRepo implements HistoryRepo {
  constructor(private db: Database) {}

  async listStateIntervals(tenantId: string, deviceId: string, state: string, fromIso: string, toIso: string): Promise<StateInterval[]> {
    const rows = this.db
      .query<any, any>(
        `SELECT started_at, ended_at FROM device_state_history
         WHERE tenant_id=$tenant_id AND device_id=$device_id AND state=$state
           AND started_at <= $to AND (ended_at IS NULL OR ended_at >= $from)
         ORDER BY started_at`
      )
      .all({ $tenant_id: tenantId, $device_id: deviceId, $state: state, $from: fromIso, $to: toIso }) as any[];
    return rows.map((r) => ({ startedAt: r.started_at, endedAt: r.ended_at }));
  }
}

export class SqliteTopologyRepo implements TopologyRepo {
  constructor(private db: Database) {}

  async savePosition(tenantId: string, userId: string, nodeId: string, x: number, y: number): Promise<void> {
    this.db
      .query<any, any>(
        `INSERT INTO topology_positions (tenant_id, user_id, node_id, x, y, updated_at)
         VALUES ($tenant_id,$user_id,$node_id,$x,$y,$updated_at)
         ON CONFLICT(tenant_id, user_id, node_id) DO UPDATE SET x=excluded.x, y=excluded.y, updated_at=excluded.updated_at`
      )
      .run({ $tenant_id: tenantId, $user_id: userId, $node_id: nodeId, $x: x, $y: y, $updated_at: new Date().toISOString() });
  }

  async listPositions(tenantId: string, userId: string): Promise<TopologyPosition[]> {
    const rows = this.db
      .query<any, any>("SELECT node_id, x, y FROM topology_positions WHERE tenant_id=$tenant_id AND user_id=$user_id")
      .all({ $tenant_id: tenantId, $user_id: userId }) as any[];
    return rows.map((r) => ({ nodeId: r.node_id, x: r.x, y: r.y }));
  }
}
