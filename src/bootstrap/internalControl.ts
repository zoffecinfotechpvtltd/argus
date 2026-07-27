import { Hono } from "hono";
import type { Scheduler } from "@application/scheduler";
import type { AppEnv } from "@api/honoTypes";

/**
 * Loopback-only control surface used exclusively by the `--tray` PowerShell helper (tray.ts) to
 * open the dashboard, toggle monitoring, and request a clean shutdown — things a system tray menu
 * needs that don't fit the authenticated multi-tenant `/api/*` surface (no user session exists in
 * a spawned external process). Guarded by a random per-launch token written only to a file in the
 * data directory (same trust model as instance.key): anyone who can read that file already has
 * filesystem access to the SQLite DB and encryption key, so this grants no new capability.
 */
export function internalControlRoutes(opts: { scheduler: Scheduler; token: string; onQuit: () => void }) {
  const router = new Hono<AppEnv>();

  router.use("*", async (c, next) => {
    if (c.req.header("x-argus-token") !== opts.token) return c.json({ error: "FORBIDDEN" }, 403);
    return next();
  });

  router.get("/internal/status", (c) => c.json({ paused: opts.scheduler.isPaused() }));

  router.post("/internal/pause", (c) => {
    opts.scheduler.pause();
    return c.json({ ok: true, paused: true });
  });

  router.post("/internal/resume", (c) => {
    opts.scheduler.resume();
    return c.json({ ok: true, paused: false });
  });

  router.post("/internal/quit", (c) => {
    setTimeout(opts.onQuit, 100); // let the response flush first
    return c.json({ ok: true });
  });

  return router;
}
