import { Hono } from "hono";
import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { validateJson, getValidated } from "@api/middleware/validate";
import { isNewerVersion } from "@domain/semver";
import { verifyUpdateFeed } from "@domain/updateFeed";
import { UPDATE_FEED_PUBLIC_KEY_PEM } from "@domain/updateFeedPublicKey";
import { isBlockedAddress, isPrivateAddress } from "@domain/ssrfGuard";
import { VERSION as CURRENT_VERSION } from "@bootstrap/version";
import { isServiceInstalled, spawnSelfUpdateHelper } from "@bootstrap/selfUpdate";
import { createBackupZip } from "@application/backup";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const CONFIG_PATH = "./config.json";
const UPDATE_CHECK_TIMEOUT_MS = 5000;
const UPDATE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** SSRF guard for the update-check/update-apply URLs, same rationale and DNS-rebinding caveat as
 * @adapters/notify/webhookNotifier.ts's validateWebhookUrl: both the admin-configured check URL
 * and the signed feed's download URL are meant to point at an external update server, not the LAN
 * this product monitors, so private ranges are blocked in addition to loopback/link-local. Only
 * https:// is allowed — plain http would let a network-position attacker tamper with the download
 * even though the payload is separately signature- and checksum-verified. */
async function assertSafeUpdateUrl(target: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error(`Invalid URL: ${target}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`URL must be https://: ${target}`);

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve hostname: ${parsed.hostname}`);
  }
  for (const addr of addresses) {
    // Checked regardless of family — see ssrfGuard.ts; a hostname with only a AAAA record used to
    // skip validation entirely here since the loop never found an IPv4 address to check.
    if (isBlockedAddress(addr.address)) throw new Error(`Blocked by SSRF guard: ${parsed.hostname} resolves to a link-local/loopback address`);
    if (isPrivateAddress(addr.address)) throw new Error(`Blocked by SSRF guard: ${parsed.hostname} resolves to a private network address`);
  }
}

/** True only when the instance can actually apply an update by itself: Windows (the only platform
 * bootstrap/selfUpdate.ts implements the swap-and-relaunch script for), and not running as a
 * Windows service (see isServiceInstalled). Whether the *feed itself* is trustworthy is a separate
 * question, checked by verifyUpdateFeed before any of this matters. */
function canAutoUpdate(): boolean {
  return process.platform === "win32" && !isServiceInstalled(process.execPath);
}

const GeneralSettingsSchema = z.object({
  instanceName: z.string().min(1).max(120),
  port: z.number().int().min(1).max(65535),
  logLevel: z.enum(["debug", "info", "warn", "error"]),
  polling: z.object({
    defaultIntervalSec: z.number().int().min(10),
    concurrency: z.number().int().min(1).max(2000),
  }),
  retention: z.object({
    rawDays: z.number().int().min(1),
    rollupDays: z.number().int().min(1),
  }),
  updateCheckUrl: z
    .union([z.string().url().refine((u) => u.startsWith("https://"), "Update check URL must be https://"), z.literal("")])
    .optional(),
});

export function generalSettingsRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/settings/general", requireAuth(app), requireRole("admin"), (c) => {
    return c.json({
      instanceName: app.config.instanceName,
      port: app.config.port,
      logLevel: app.config.logLevel,
      polling: app.config.polling,
      retention: app.config.retention,
      mode: app.config.mode,
      updateCheckUrl: app.config.updateCheckUrl ?? "",
      version: CURRENT_VERSION,
      restartRequired: false,
    });
  });

  router.get("/settings/update-check", requireAuth(app), requireRole("admin"), async (c) => {
    const url = app.config.updateCheckUrl;
    if (!url) return c.json({ configured: false, currentVersion: CURRENT_VERSION });

    try {
      await assertSafeUpdateUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS) });
      if (!res.ok) return c.json({ configured: true, currentVersion: CURRENT_VERSION, error: `Update server returned ${res.status}` }, 502);

      const raw = await res.text();
      const verified = verifyUpdateFeed(raw, UPDATE_FEED_PUBLIC_KEY_PEM);
      if (verified.status === "invalid") {
        return c.json({ configured: true, currentVersion: CURRENT_VERSION, error: `Update feed failed verification: ${verified.reason}` }, 502);
      }

      return c.json({
        configured: true,
        currentVersion: CURRENT_VERSION,
        latestVersion: verified.payload.version,
        updateAvailable: isNewerVersion(verified.payload.version, CURRENT_VERSION),
        releaseUrl: verified.payload.url,
        notes: verified.payload.notes,
        canAutoUpdate: canAutoUpdate(),
      });
    } catch (err) {
      return c.json({ configured: true, currentVersion: CURRENT_VERSION, error: `Could not reach update feed: ${(err as Error).message}` }, 502);
    }
  });

  router.post("/settings/update-apply", requireAuth(app), requireRole("admin"), async (c) => {
    const url = app.config.updateCheckUrl;
    if (!url) return c.json({ error: "NOT_CONFIGURED", message: "Set an update check URL first." }, 400);
    if (process.platform !== "win32") return c.json({ error: "UNSUPPORTED_PLATFORM", message: "Automatic update is only implemented for Windows." }, 400);
    if (isServiceInstalled(process.execPath)) {
      return c.json(
        { error: "SERVICE_INSTALLED", message: "Argus is running as a Windows service — stop the service, replace the exe manually, then start it again." },
        400
      );
    }

    let raw: string;
    try {
      await assertSafeUpdateUrl(url);
      const res = await fetch(url, { signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Update server returned ${res.status}`);
      raw = await res.text();
    } catch (err) {
      return c.json({ error: "FEED_UNREACHABLE", message: `Could not reach update feed: ${(err as Error).message}` }, 502);
    }

    // Re-verified here independently of update-check — this is a separate request, and trusting
    // an earlier check would let a feed that flips between a valid and a malicious response slip
    // a tampered payload through on the request that actually downloads and executes it.
    const verified = verifyUpdateFeed(raw, UPDATE_FEED_PUBLIC_KEY_PEM);
    if (verified.status === "invalid") {
      return c.json({ error: "FEED_INVALID", message: `Update feed failed verification: ${verified.reason} — refusing to download a binary that can't be authenticated.` }, 502);
    }
    const feed = verified.payload;

    if (!isNewerVersion(feed.version, CURRENT_VERSION)) {
      return c.json({ error: "ALREADY_CURRENT", message: "Already running the latest version." }, 400);
    }

    let bytes: ArrayBuffer;
    try {
      await assertSafeUpdateUrl(feed.url);
      const dl = await fetch(feed.url, { signal: AbortSignal.timeout(UPDATE_DOWNLOAD_TIMEOUT_MS) });
      if (!dl.ok) throw new Error(`Download returned ${dl.status}`);
      bytes = await dl.arrayBuffer();
    } catch (err) {
      return c.json({ error: "DOWNLOAD_FAILED", message: `Could not download update: ${(err as Error).message}` }, 502);
    }

    const actualSha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    if (actualSha256 !== feed.sha256.toLowerCase()) {
      return c.json({ error: "CHECKSUM_MISMATCH", message: "Downloaded file's checksum doesn't match the signed update feed — refusing to apply it." }, 502);
    }

    // A safety snapshot tied specifically to this update, independent of whatever the scheduled
    // backup's own cadence happens to be — the self-update helper only ever swaps the exe file
    // (never touches dataDir), so this is protection against a genuinely bad build, not against
    // the update mechanism itself. Best-effort: a failed backup write logs and falls through
    // rather than blocking a legitimate update, since a transient disk hiccup here shouldn't trap
    // an install on a known-bad version it was trying to move off of.
    try {
      const backupsDir = join(app.config.dataDir, "backups");
      mkdirSync(backupsDir, { recursive: true });
      const zip = createBackupZip(app);
      const safeVersion = feed.version.replace(/[^a-zA-Z0-9.-]/g, "_");
      writeFileSync(join(backupsDir, `pre-update-${safeVersion}-${Date.now()}.zip`), zip);
    } catch (err) {
      app.logger.error("pre_update_backup_failed", { error: (err as Error).message });
    }

    // Resolved to an absolute path — config.dataDir is commonly relative ("./data"), and the
    // self-update helper is a detached process that must not depend on inheriting the right cwd.
    const newExePath = resolve(app.config.dataDir, "update-download.exe");
    await Bun.write(newExePath, bytes);
    spawnSelfUpdateHelper({ pid: process.pid, currentExePath: process.execPath, newExePath });

    await app.repos.audit.record({
      tenantId: tenantOf(c),
      userId: c.get("user").id,
      action: "update.apply",
      entityType: "instance",
      entityId: null,
      detail: { fromVersion: CURRENT_VERSION, toVersion: feed.version },
      createdAt: app.clock.nowIso(),
    });

    setTimeout(() => app.shutdownRequester.requestShutdown("self-update"), 300);
    return c.json({ ok: true, applying: true, toVersion: feed.version });
  });

  router.put("/settings/general", requireAuth(app), requireRole("admin"), validateJson(GeneralSettingsSchema), async (c) => {
    const body = getValidated<typeof GeneralSettingsSchema>(c);
    const current = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) : {};
    const updated = { ...current, ...body };
    writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2));

    await app.repos.audit.record({
      tenantId: tenantOf(c),
      userId: c.get("user").id,
      action: "settings.update",
      entityType: "settings",
      entityId: "general",
      detail: { changedKeys: Object.keys(body) },
      createdAt: app.clock.nowIso(),
    });

    const restartRequired = body.port !== app.config.port || body.polling.concurrency !== app.config.polling.concurrency;
    return c.json({ ok: true, restartRequired, message: restartRequired ? "Some changes require a restart to take effect." : undefined });
  });

  return router;
}
