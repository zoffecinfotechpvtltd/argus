import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppContainer } from "@bootstrap/container";
import { setupRoutes } from "@api/routes/setup";
import { authRoutes } from "@api/routes/auth";
import { deviceRoutes } from "@api/routes/devices";
import { groupRoutes } from "@api/routes/groups";
import { onCallRoutes } from "@api/routes/oncall";
import { discoveryRoutes } from "@api/routes/discovery";
import { alertRoutes } from "@api/routes/alerts";
import { notificationSettingsRoutes } from "@api/routes/notificationSettings";
import { summaryRoutes } from "@api/routes/summary";
import { metricsRoutes } from "@api/routes/metrics";
import { reportRoutes } from "@api/routes/reports";
import { topologyRoutes } from "@api/routes/topology";
import { checkRoutes } from "@api/routes/checks";
import { maintenanceRoutes } from "@api/routes/maintenance";
import { userRoutes } from "@api/routes/users";
import { auditRoutes } from "@api/routes/audit";
import { backupRoutes } from "@api/routes/backup";
import { generalSettingsRoutes } from "@api/routes/generalSettings";
import { licenseRoutes } from "@api/routes/license";
import { apiKeyRoutes } from "@api/routes/apiKeys";
import { remoteAgentRoutes } from "@api/routes/remoteAgents";
import { signupRoutes } from "@api/routes/signup";
import { ssoRoutes } from "@api/routes/sso";
import { statusPageRoutes } from "@api/routes/statusPage";
import { registerStatic } from "@api/static";
import { VERSION } from "@bootstrap/version";
import { requireAuth } from "@api/middleware/auth";
import type { AppEnv } from "@api/honoTypes";

// M2: replaces the earlier WebSocket broadcast — SSE fans out over plain HTTP (no upgrade
// handshake, works through more proxies/load balancers by default) and the transport is one-way
// anyway (server -> client only; the old /ws route's client->server "echo" was never real
// bidirectional use). Each connected client is a live SSE stream in `sseClients`, scoped to this
// one process. Cross-process fan-out (a pollerMain.ts poller's event reaching this web app's
// clients, or one web replica's event reaching another replica's clients) happens one layer down,
// at app.events itself — saas mode's RedisEventBus (adapters/redis/eventBus.ts) already delivers
// `.on()` handlers in every process, so the bridge below only has to fan out locally from there.
interface SseClient {
  tenantId: string;
  send: (payload: unknown) => Promise<void>;
}
const sseClients = new Set<SseClient>();

export function buildServer(app: AppContainer) {
  const hono = new Hono<AppEnv>();

  // Tenant isolation: every event this bridges carries tenantId (device/alert/discovery events all
  // thread it through — see the emit call sites in application/). A saas-mode client only ever gets
  // events for its own tenant; exe mode's single tenant means this is always a match, so the filter
  // is a safe no-op there, not new behavior for that path.
  const broadcast = (payload: unknown) => {
    const tenantId = (payload as { tenantId?: string }).tenantId;
    for (const client of sseClients) {
      if (tenantId && client.tenantId !== tenantId) continue;
      client.send(payload).catch(() => sseClients.delete(client));
    }
  };

  // Security headers
  hono.use("*", async (c, next) => {
    await next();
    c.header("X-Frame-Options", "DENY");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    // script-src has no 'unsafe-inline' — every script Argus serves is either a hashed Vite
    // asset or a same-origin file (see api/routes/docs.ts's docs-init.js for why Swagger's
    // bootstrap is a separate file rather than an inline <script>). style-src allows inline
    // because React's inline `style={{}}` props and recharts both rely on it; that's a far lower
    // XSS-relevant surface than inline scripts, which is what this policy actually locks down.
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
    // Deliberately no Access-Control-Allow-Origin header at all — browsers block cross-origin
    // requests by default when it's absent, which is exactly "locked to same-origin". (An
    // empty-string value is not meaningful per the CORS spec; omitting the header entirely is the
    // correct way to express "no origin is allowed.")
  });

  // Request logging
  hono.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    app.logger.info("request", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - start,
    });
  });

  hono.onError((err, c) => {
    app.logger.error("unhandled_error", { message: err.message, stack: err.stack, path: c.req.path });
    return c.json({ error: "INTERNAL_ERROR" }, 500);
  });

  // Liveness: "the process is up." Never touches the DB, so it can't itself hang or fail on a
  // slow/unreachable database — that's exactly the distinction a readiness check exists for.
  hono.get("/api/health", (c) => c.json({ ok: true, mode: app.config.mode, version: VERSION }));

  // Readiness: "the process is up AND can actually serve requests" — confirms the DB is reachable,
  // not just that the process started.
  hono.get("/api/ready", async (c) => {
    try {
      await app.repos.tenant.list();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 503);
    }
  });

  hono.route("/api", authRoutes(app));

  if (app.config.mode === "saas") {
    // Multi-tenant: there is no single global "the one admin" to gate on — any number of
    // workspaces exist independently, each created via /signup whenever a new customer wants one.
    // The exe-mode setup-required gate below (and /setup itself) is specifically the "exactly one
    // fixed tenant, seeded once" model and doesn't apply here.
    hono.route("/api", signupRoutes(app));
    hono.route("/api", ssoRoutes(app));
  } else {
    hono.route("/api", setupRoutes(app));

    // Setup-required gate: a single global admin must exist before anything else is reachable.
    // Exe-mode only — see the saas branch above for why this doesn't apply there.
    hono.use("/api/*", async (c, next) => {
      const path = c.req.path;
      const exempt =
        path === "/api/health" ||
        path === "/api/ready" ||
        path.startsWith("/api/setup") ||
        path === "/api/auth/login";
      if (exempt) return next();

      const count = await app.repos.user.countAll();
      if (count === 0) return c.json({ error: "SETUP_REQUIRED" }, 503);
      return next();
    });
  }

  hono.route("/api", deviceRoutes(app));
  hono.route("/api", groupRoutes(app));
  hono.route("/api", onCallRoutes(app));
  hono.route("/api", discoveryRoutes(app));
  hono.route("/api", alertRoutes(app));
  hono.route("/api", notificationSettingsRoutes(app));
  hono.route("/api", summaryRoutes(app));
  hono.route("/api", metricsRoutes(app));
  hono.route("/api", reportRoutes(app));
  hono.route("/api", topologyRoutes(app));
  hono.route("/api", checkRoutes(app));
  hono.route("/api", maintenanceRoutes(app));
  hono.route("/api", userRoutes(app));
  hono.route("/api", auditRoutes(app));
  hono.route("/api", backupRoutes(app));
  hono.route("/api", generalSettingsRoutes(app));
  hono.route("/api", licenseRoutes(app));
  hono.route("/api", apiKeyRoutes(app));
  hono.route("/api", remoteAgentRoutes(app));
  // M6: the one route tree in this app with a genuinely unauthenticated GET — see
  // statusPageRoutes for why it's still safe to register alongside every authenticated route
  // above rather than needing its own carve-out (no requireAuth() call on the public leg is what
  // makes it reachable without a session, nothing about registration order here).
  hono.route("/api", statusPageRoutes(app));

  // Bridge application-layer domain events onto the WebSocket fan-out.
  app.events.on("discovery.progress", (payload) => broadcast({ type: "discovery.progress", ...(payload as object) }));
  app.events.on("discovery.done", (payload) => broadcast({ type: "discovery.done", ...(payload as object) }));
  app.events.on("discovery.error", (payload) => broadcast({ type: "discovery.error", ...(payload as object) }));
  app.events.on("device.status_changed", (payload) => broadcast({ type: "device.status_changed", ...(payload as object) }));
  app.events.on("alert.changed", (payload) => broadcast({ type: "alert.changed", ...(payload as object) }));

  // SSE_KEEPALIVE_MS: EventSource has no protocol-level ping; some proxies/load balancers silently
  // drop an idle HTTP connection well under a minute. A dedicated "keepalive" event every 20s keeps
  // the connection visibly active — the frontend provider ignores this event type, so it never
  // reaches page-level useWsMessages() consumers as a real message.
  const SSE_KEEPALIVE_MS = 20_000;

  hono.get("/api/events/stream", requireAuth(app), async (c) => {
    const user = c.get("user");
    return streamSSE(c, async (stream) => {
      const client: SseClient = {
        tenantId: user.tenantId,
        send: (payload) => stream.writeSSE({ event: "message", data: JSON.stringify(payload) }),
      };
      sseClients.add(client);

      let alive = true;
      stream.onAbort(() => {
        alive = false;
        sseClients.delete(client);
      });

      while (alive) {
        await stream.sleep(SSE_KEEPALIVE_MS);
        if (!alive) break;
        try {
          await stream.writeSSE({ event: "keepalive", data: "" });
        } catch {
          break;
        }
      }
    });
  });

  registerStatic(hono);

  return hono;
}
