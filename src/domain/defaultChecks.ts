// Pure logic — no I/O. Decides which checks a newly created/imported device should get by default.
import { randomUUID } from "node:crypto";
import type { Check } from "@domain/entities";

export interface DefaultChecksInput {
  tenantId: string;
  deviceId: string;
  hasHttp: boolean;
  hasHttps: boolean;
  hasSnmp: boolean;
  nowIso: string;
}

/** ICMP is always included; +HTTP(S) if a web port was seen open; +SNMP if credentials were supplied. */
export function buildDefaultChecks(input: DefaultChecksInput): Check[] {
  const checks: Check[] = [
    {
      id: randomUUID(),
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      kind: "icmp",
      config: {},
      thresholds: { latencyMs: 200, lossPct: 10 },
      enabled: true,
      createdAt: input.nowIso,
    },
  ];

  if (input.hasHttp || input.hasHttps) {
    checks.push({
      id: randomUUID(),
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      kind: "http",
      config: {
        port: input.hasHttps ? 443 : 80,
        tls: input.hasHttps,
        expectedStatus: [200, 301, 302, 401, 403],
        timeoutMs: 5000,
        allowSelfSigned: true,
      },
      thresholds: { latencyMs: 500 },
      enabled: true,
      createdAt: input.nowIso,
    });
  }

  if (input.hasSnmp) {
    checks.push({
      id: randomUUID(),
      tenantId: input.tenantId,
      deviceId: input.deviceId,
      kind: "snmp",
      config: { version: "2c" },
      thresholds: {},
      enabled: true,
      createdAt: input.nowIso,
    });
  }

  return checks;
}
