#!/usr/bin/env bun
/**
 * Remote poller agent — a lightweight standalone process for network segments the central Argus
 * instance can't reach directly. Fetches the list of devices assigned to it (see
 * @api/routes/remoteAgents's GET /agent/devices), runs their icmp/tcp/http checks locally (the
 * only checks that need no credential material — see that route's own doc comment for why SNMP/
 * vendor-API checks aren't supported here yet), and pushes results back.
 *
 * Usage:
 *   ARGUS_AGENT_TOKEN=argus_agent_... ARGUS_CENTRAL_URL=https://central.example.com bun run agent
 *
 * This is deliberately not built into the main Argus.exe / Windows-service infrastructure — it's
 * meant to run as its own small process (a scheduled task, a systemd unit, `pm2`, whatever fits
 * the segment it's deployed into), not a mode flag on the full product binary.
 */
import { IcmpChecker } from "@adapters/net/checkers/icmpChecker";
import { TcpChecker } from "@adapters/net/checkers/tcpChecker";
import { HttpChecker } from "@adapters/net/checkers/httpChecker";
import type { Check, CheckKind, Device } from "@domain/entities";
import type { Checker } from "@ports/services";

const TOKEN = process.env.ARGUS_AGENT_TOKEN;
const CENTRAL_URL = process.env.ARGUS_CENTRAL_URL;
const POLL_INTERVAL_MS = Number(process.env.ARGUS_AGENT_INTERVAL_MS ?? 30_000);

if (!TOKEN || !CENTRAL_URL) {
  console.error("ARGUS_AGENT_TOKEN and ARGUS_CENTRAL_URL are both required.");
  console.error("Usage: ARGUS_AGENT_TOKEN=... ARGUS_CENTRAL_URL=https://... bun run agent");
  process.exit(1);
}

const checkers: Record<"icmp" | "tcp" | "http", Checker> = {
  icmp: new IcmpChecker(),
  tcp: new TcpChecker(),
  http: new HttpChecker(),
};

interface AgentDevice {
  id: string;
  ip: string;
  name: string;
  intervalSec: number;
  checks: Array<{ id: string; kind: CheckKind; config: Check["config"] }>;
}

function log(msg: string, meta?: Record<string, unknown>) {
  console.log(`[${new Date().toISOString()}] ${msg}${meta ? " " + JSON.stringify(meta) : ""}`);
}

async function fetchDevices(): Promise<AgentDevice[]> {
  const res = await fetch(`${CENTRAL_URL}/api/agent/devices`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`GET /agent/devices failed: HTTP ${res.status}`);
  return (await res.json()) as AgentDevice[];
}

/** Only the fields icmp/tcp/http checkers actually read (ip, and check.config) are real — the
 * rest of Device/Check just needs to type-check, since this process has no DB of its own and the
 * central instance already owns every other field's real value. */
function stubDevice(ad: AgentDevice): Device {
  const now = new Date().toISOString();
  return {
    id: ad.id,
    tenantId: "",
    name: ad.name,
    ip: ad.ip,
    mac: null,
    vendor: null,
    type: "unknown",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: ad.intervalSec,
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
    remoteAgentId: null,
    createdAt: now,
    updatedAt: now,
  };
}

function stubCheck(ad: AgentDevice, c: AgentDevice["checks"][number]): Check {
  return { id: c.id, tenantId: "", deviceId: ad.id, kind: c.kind, config: c.config, thresholds: {}, enabled: true, createdAt: new Date().toISOString() };
}

async function pushResults(deviceId: string, results: Array<{ checkId: string; result: unknown }>): Promise<void> {
  const res = await fetch(`${CENTRAL_URL}/api/agent/checks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId, results }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`POST /agent/checks failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
}

async function runCycle(): Promise<void> {
  const devices = await fetchDevices();
  log(`polling ${devices.length} device(s)`);

  for (const ad of devices) {
    if (ad.checks.length === 0) continue;
    const device = stubDevice(ad);
    const results = await Promise.all(
      ad.checks.map(async (c) => {
        const checker = checkers[c.kind as "icmp" | "tcp" | "http"];
        const result = await checker.run(device, stubCheck(ad, c));
        return { checkId: c.id, result };
      })
    );
    try {
      await pushResults(ad.id, results);
    } catch (err) {
      log(`push failed for device ${ad.name} (${ad.id})`, { error: (err as Error).message });
    }
  }
}

log("Argus remote agent starting", { centralUrl: CENTRAL_URL, intervalMs: POLL_INTERVAL_MS });

async function loop(): Promise<void> {
  try {
    await runCycle();
  } catch (err) {
    log("cycle failed", { error: (err as Error).message });
  }
  setTimeout(loop, POLL_INTERVAL_MS);
}

void loop();
