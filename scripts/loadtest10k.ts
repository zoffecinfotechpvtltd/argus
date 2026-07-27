#!/usr/bin/env bun
// M8: 10k-device scale proof against the real sharded-poller architecture (Postgres + Redis +
// pollerMain.ts), not the SQLite in-memory simulate.ts harness (that proves single-process
// scheduler correctness at ~500 devices; this proves the M1 sharding claim at 10k). Bulk-inserts
// devices/checks directly via the pg driver (bypassing the API — 10k individual HTTP requests
// would dominate the timing this is trying to measure) into a dedicated load-test tenant, each
// device pointed at one real local HTTP target so pollers do real (if trivial) network I/O, not a
// no-op.
//
// Usage: DATABASE_URL=postgresql://... bun run scripts/loadtest10k.ts [--devices=10000]

import { Pool } from "pg";
import { randomUUID } from "node:crypto";

function argNum(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? Number(arg.split("=")[1]) : fallback;
}

const DEVICE_COUNT = argNum("devices", 10_000);
const TARGET_PORT = argNum("targetPort", 9195);
const BATCH_SIZE = 500;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = new Pool({ connectionString });
const now = new Date().toISOString();
const tenantId = "loadtest-" + randomUUID();

async function main() {
  console.log(`Seeding ${DEVICE_COUNT} devices for tenant ${tenantId}...`);

  await db.query(`INSERT INTO tenants (id, name, plan, device_limit, poller_limit, created_at) VALUES ($1,$2,'enterprise',999999,10,$3)`, [
    tenantId,
    "Load Test",
    now,
  ]);

  const startInsert = Date.now();
  for (let batchStart = 0; batchStart < DEVICE_COUNT; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, DEVICE_COUNT);
    const deviceRows: unknown[] = [];
    const deviceValuesSql: string[] = [];
    const checkRows: unknown[] = [];
    const checkValuesSql: string[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const deviceId = randomUUID();
      const di = deviceRows.length;
      // devices.(tenant_id, ip) has a real unique index (idx_devices_tenant_ip) — every device
      // needs a distinct IP. All of 127.0.0.0/8 routes to loopback on Windows/Linux/macOS, and
      // the target's Bun.serve() binds every interface by default, so encoding the loop index
      // into the low 3 octets gives 16M+ distinct addresses that all still reach the one real
      // local target — real distinct devices, without needing 10k real hosts.
      const n = i + 2; // +2 avoids 127.0.0.0 (network) and 127.0.0.1 (host loopback, already in use)
      const ip = `127.${(n >> 16) & 0xff}.${(n >> 8) & 0xff}.${n & 0xff}`;
      deviceValuesSql.push(`($${di + 1},$${di + 2},$${di + 3},$${di + 4},$${di + 5},$${di + 6},$${di + 7},$${di + 8},$${di + 9},$${di + 10})`);
      deviceRows.push(deviceId, tenantId, `loadtest-${i}`, ip, "server", 60, true, JSON.stringify([]), now, now);

      const ci = checkRows.length;
      checkValuesSql.push(`($${ci + 1},$${ci + 2},$${ci + 3},'http',$${ci + 4},$${ci + 5},true,$${ci + 6})`);
      checkRows.push(
        randomUUID(),
        tenantId,
        deviceId,
        JSON.stringify({ port: TARGET_PORT, allowLocalhost: true, timeoutMs: 3000 }),
        JSON.stringify({ latencyMs: 1000 }),
        now
      );
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO devices (id, tenant_id, name, ip, type, interval_sec, enabled, tags, created_at, updated_at) VALUES ${deviceValuesSql.join(",")}`,
        deviceRows
      );
      await client.query(
        `INSERT INTO checks (id, tenant_id, device_id, kind, config, thresholds, enabled, created_at) VALUES ${checkValuesSql.join(",")}`,
        checkRows
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
    process.stdout.write(`\r  ${batchEnd}/${DEVICE_COUNT} seeded`);
  }
  console.log(`\nSeed complete in ${((Date.now() - startInsert) / 1000).toFixed(1)}s`);
  console.log(`tenantId=${tenantId}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
