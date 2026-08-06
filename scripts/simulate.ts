#!/usr/bin/env bun
// Load simulation harness (Phase 03 acceptance criterion): seeds N fake devices behind a mock
// Checker (random latency + scripted failures, no real network I/O), runs the real Scheduler for
// a real wall-clock duration, and asserts it never falls more than 5s behind schedule and process
// memory stays under 300MB.
//
// Usage: bun run scripts/simulate.ts [--devices=500] [--duration=300] [--concurrency=50]

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { loadMigrationsFromDir, runMigrations } from "@adapters/db/sqlite/connection";
import { SqliteCheckRepo, SqliteDeviceRepo, SqliteGroupRepo, SqliteStatusRepo } from "@adapters/db/sqlite/deviceRepos";
import { SqliteAlertRepo, SqliteMetricRepo, SqliteNotificationLogRepo } from "@adapters/db/sqlite/metricAlertRepos";
import { SqliteSessionRepo, SqliteUserRepo } from "@adapters/db/sqlite/authRepos";
import { SqliteAuditRepo, SqliteMaintenanceRepo, SqliteNotificationPrefsRepo, SqliteSettingsRepo } from "@adapters/db/sqlite/miscRepos";
import { InMemoryQueue } from "@adapters/queue/inMemoryQueue";
import { SqliteTickPersister } from "@adapters/db/sqlite/tickPersister";
import { SystemClock } from "@adapters/clock";
import { JsonLogger } from "@adapters/logger";
import { DEFAULT_TENANT_ID, type Device } from "@domain/entities";
import { Scheduler } from "@application/scheduler";
import type { AppContainer } from "@ports/context";
import type { Checker } from "@ports/services";

function argNum(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? Number(arg.split("=")[1]) : fallback;
}

const DEVICE_COUNT = argNum("devices", 500);
const DURATION_SEC = argNum("duration", 300); // "5 simulated minutes" per the phase spec
const CONCURRENCY = argNum("concurrency", 50);
const INTERVAL_SEC = argNum("interval", 60); // master context's "500 devices @ 60s polling" target; override for quick smoke runs
const LAG_TOLERANCE_MS = 5000;
const MEMORY_LIMIT_MB = 300;

const runTimestampsByDevice = new Map<string, number[]>();

const mockChecker: Checker = {
  async run(device) {
    // ~2% scripted failure rate, plus a fixed 3% of devices that are "always down" for the run.
    const alwaysDown = Number(device.name.split("-")[1]) % 33 === 0;
    const randomFail = Math.random() < 0.02;
    const latencyMs = Math.round(5 + Math.random() * 40);

    const arr = runTimestampsByDevice.get(device.id) ?? [];
    arr.push(Date.now());
    runTimestampsByDevice.set(device.id, arr);

    if (alwaysDown || randomFail) return { ok: false, error: "simulated failure", values: { lossPct: 100 } };
    return { ok: true, latencyMs, values: { lossPct: 0 } };
  },
};

function buildSimContainer(): AppContainer {
  const db = new Database(":memory:");
  runMigrations(db, loadMigrationsFromDir(join(import.meta.dir, "..", "migrations")));

  const handlers = new Map<string, Set<(p: unknown) => void>>();

  return {
    config: {
      mode: "exe",
      port: 58070,
      dataDir: "./data",
      logLevel: "warn",
      instanceName: "Simulate",
      polling: { defaultIntervalSec: INTERVAL_SEC, concurrency: CONCURRENCY },
      retention: { rawDays: 30, rollupDays: 365 },
    },
    clock: new SystemClock(),
    logger: new JsonLogger("warn"),
    instanceKey: Buffer.alloc(32),
    events: {
      emit: (topic: string, payload: unknown) => handlers.get(topic)?.forEach((h) => h(payload)),
      on: (topic: string, handler: (p: unknown) => void) => {
        if (!handlers.has(topic)) handlers.set(topic, new Set());
        handlers.get(topic)!.add(handler);
        return () => handlers.get(topic)!.delete(handler);
      },
    },
    queue: new InMemoryQueue(),
    scanner: { scan: async () => [] },
    discoveryJobs: { create() {}, get: () => undefined, update() {} },
    checkers: { get: () => mockChecker },
    tickPersister: new SqliteTickPersister(db),
    repos: {
      device: new SqliteDeviceRepo(db),
      group: new SqliteGroupRepo(db),
      check: new SqliteCheckRepo(db),
      status: new SqliteStatusRepo(db),
      metric: new SqliteMetricRepo(db),
      alert: new SqliteAlertRepo(db),
      user: new SqliteUserRepo(db),
      session: new SqliteSessionRepo(db),
      settings: new SqliteSettingsRepo(db),
      audit: new SqliteAuditRepo(db),
      maintenance: new SqliteMaintenanceRepo(db),
      notificationPrefs: new SqliteNotificationPrefsRepo(db),
      notificationLog: new SqliteNotificationLogRepo(db),
    },
  } as unknown as AppContainer;
}

async function seedDevices(app: AppContainer, count: number): Promise<void> {
  const now = new Date().toISOString();
  const items = [];
  for (let i = 0; i < count; i++) {
    const device: Device = {
      id: randomUUID(),
      tenantId: DEFAULT_TENANT_ID,
      name: `sim-${i}`,
      ip: `10.${Math.floor(i / 65536)}.${Math.floor(i / 256) % 256}.${i % 256}`,
      mac: null,
      vendor: null,
      type: "unknown",
      location: null,
      groupId: null,
      responsibleUserId: null,
      intervalSec: INTERVAL_SEC,
      enabled: true,
      snmpCredsEnc: null,
      tags: [],
      uplinkDeviceId: null,
      criticalAsset: false,
      model: null,
      firmwareVersion: null,
      serialNumber: null,
      haRole: null,
      apiVendor: null,
      apiCredsEnc: null,
      createdAt: now,
      updatedAt: now,
    };
    const checks = [
      {
        id: randomUUID(),
        tenantId: DEFAULT_TENANT_ID,
        deviceId: device.id,
        kind: "icmp" as const,
        config: {},
        thresholds: { latencyMs: 200, lossPct: 10 },
        enabled: true,
        createdAt: now,
      },
    ];
    items.push({ device, checks });
  }
  await app.repos.device.createBatchWithChecks(items);
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

async function main() {
  console.log(`Argus load simulation: ${DEVICE_COUNT} devices, ${DURATION_SEC}s, concurrency=${CONCURRENCY}, interval=${INTERVAL_SEC}s`);

  const app = buildSimContainer();
  await seedDevices(app, DEVICE_COUNT);

  let maxRssMB = 0;
  const memSampler = setInterval(() => {
    const rssMB = process.memoryUsage().rss / 1024 / 1024;
    maxRssMB = Math.max(maxRssMB, rssMB);
  }, 2000);

  const scheduler = new Scheduler(app);
  const startedAt = Date.now();
  await scheduler.start();

  const progressLogger = setInterval(() => {
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    const totalRuns = [...runTimestampsByDevice.values()].reduce((s, a) => s + a.length, 0);
    console.log(`  t+${elapsedSec}s — ${totalRuns} checks run so far, rss=${fmtMB(process.memoryUsage().rss)}`);
  }, 15_000);

  await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));

  clearInterval(progressLogger);
  clearInterval(memSampler);
  await scheduler.stop();

  // Lag analysis: the scheduler applies +/-10% jitter to every interval by design (see
  // application/scheduler.ts), so a gap up to interval*1.1 is expected, not lag. Real scheduler
  // lag is time spent waiting for a concurrency slot *beyond* that already-jittered upper bound.
  const SCHEDULER_JITTER_FRACTION = 0.1;
  const maxExpectedGapMs = INTERVAL_SEC * 1000 * (1 + SCHEDULER_JITTER_FRACTION);
  let maxLagMs = 0;
  let lagViolations = 0;
  for (const timestamps of runTimestampsByDevice.values()) {
    for (let i = 1; i < timestamps.length; i++) {
      const gap = timestamps[i]! - timestamps[i - 1]!;
      const lag = gap - maxExpectedGapMs;
      if (lag > maxLagMs) maxLagMs = lag;
      if (lag > LAG_TOLERANCE_MS) lagViolations++;
    }
  }

  const totalRuns = [...runTimestampsByDevice.values()].reduce((s, a) => s + a.length, 0);
  const devicesEverRun = runTimestampsByDevice.size;

  console.log("\n--- Results ---");
  console.log(`Devices seeded:        ${DEVICE_COUNT}`);
  console.log(`Devices that ran:      ${devicesEverRun}`);
  console.log(`Total check executions: ${totalRuns}`);
  console.log(`Max scheduler lag:     ${maxLagMs.toFixed(0)} ms (tolerance ${LAG_TOLERANCE_MS} ms)`);
  console.log(`Lag violations (>5s):  ${lagViolations}`);
  console.log(`Max RSS observed:      ${maxRssMB.toFixed(1)} MB (limit ${MEMORY_LIMIT_MB} MB)`);

  const lagOk = lagViolations === 0;
  const memOk = maxRssMB < MEMORY_LIMIT_MB;

  console.log(`\nLag assertion:    ${lagOk ? "PASS" : "FAIL"}`);
  console.log(`Memory assertion: ${memOk ? "PASS" : "FAIL"}`);

  if (!lagOk || !memOk) {
    process.exit(1);
  }
  console.log("\nSIMULATION PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("Simulation crashed:", err);
  process.exit(1);
});
