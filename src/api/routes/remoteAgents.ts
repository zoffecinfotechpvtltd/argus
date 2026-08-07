import { Hono } from "hono";
import { z } from "zod";
import type { AppContainer } from "@bootstrap/container";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { requireAgentToken, generateAgentToken } from "@api/middleware/agentToken";
import { validateJson, getValidated } from "@api/middleware/validate";
import { processAgentDeviceResults } from "@application/agentIngest";
import type { AppEnv } from "@api/honoTypes";
import { randomUUID } from "node:crypto";

const CreateAgentSchema = z.object({ name: z.string().min(1).max(200) });

const CheckResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  values: z.record(z.string(), z.number()).optional(),
  error: z.string().optional(),
});

const PushResultsSchema = z.object({
  deviceId: z.string().min(1),
  results: z.array(z.object({ checkId: z.string().min(1), result: CheckResultSchema })).min(1).max(50),
});

export function remoteAgentRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.post("/remote-agents", requireAuth(app), requireRole("admin"), validateJson(CreateAgentSchema), async (c) => {
    const { name } = getValidated<typeof CreateAgentSchema>(c);
    const { prefix, token, hash } = generateAgentToken();
    const nowIso = app.clock.nowIso();
    const agent = await app.repos.remoteAgent.create({
      id: randomUUID(),
      tenantId: tenantOf(c),
      name,
      tokenHash: hash,
      tokenPrefix: prefix,
      createdAt: nowIso,
      lastSeenAt: null,
      revokedAt: null,
    });
    // The only time the full token is ever returned — same one-time-reveal convention as API keys
    // and the invite-a-user temporary password.
    return c.json({ id: agent.id, name: agent.name, token, createdAt: agent.createdAt });
  });

  router.get("/remote-agents", requireAuth(app), requireRole("admin"), async (c) => {
    const agents = await app.repos.remoteAgent.list(tenantOf(c));
    return c.json(agents.map((a) => ({ id: a.id, name: a.name, createdAt: a.createdAt, lastSeenAt: a.lastSeenAt, revokedAt: a.revokedAt })));
  });

  router.delete("/remote-agents/:id", requireAuth(app), requireRole("admin"), async (c) => {
    const ok = await app.repos.remoteAgent.revoke(tenantOf(c), c.req.param("id")!);
    if (!ok) return c.json({ error: "NOT_FOUND" }, 404);
    return c.json({ ok: true });
  });

  // What this agent should be polling. Only icmp/tcp/http checks are included — those three
  // checkers (unlike snmp/fortigate_api/sophos_api) need no credential material at all, so an
  // agent can run them standalone with nothing beyond ip/port/path. SNMP/vendor-API checks on an
  // agent-assigned device are a known, documented gap (see AdminRemoteAgents.tsx's assignment
  // warning) rather than solved via a shakier "ship the central instance's decrypted secrets over
  // the wire to a whole separate process on a whole separate machine" mechanism.
  router.get("/agent/devices", requireAgentToken(app), async (c) => {
    const agent = c.get("agent");
    const { items } = await app.repos.device.list(agent.tenantId, { limit: 2000 });
    const assigned = items.filter((d) => d.remoteAgentId === agent.id && d.enabled);
    const out = await Promise.all(
      assigned.map(async (d) => {
        const checks = await app.repos.check.listByDevice(agent.tenantId, d.id);
        const runnable = checks.filter((c) => c.enabled && (c.kind === "icmp" || c.kind === "tcp" || c.kind === "http"));
        return { id: d.id, ip: d.ip, name: d.name, intervalSec: d.intervalSec, checks: runnable.map((c) => ({ id: c.id, kind: c.kind, config: c.config })) };
      })
    );
    return c.json(out);
  });

  // Agent-token-authed, not session-authed — a remote agent has no user/role, just a narrow write
  // capability scoped to devices explicitly assigned to it (enforced inside processAgentDeviceResults).
  router.post("/agent/checks", requireAgentToken(app), validateJson(PushResultsSchema), async (c) => {
    const agent = c.get("agent");
    const body = getValidated<typeof PushResultsSchema>(c);
    const outcome = await processAgentDeviceResults(app, agent, body.deviceId, body.results);
    if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);
    return c.json({ ok: true });
  });

  return router;
}
