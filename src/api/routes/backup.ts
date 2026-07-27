import { Hono } from "hono";
import { z } from "zod";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { requireAuth, requireRole, tenantOf } from "@api/middleware/auth";
import { readZip } from "@adapters/backup/zip";
import { createBackupZip } from "@application/backup";
import { BACKUP_SCHEDULE_KEY, type BackupScheduleConfig } from "@application/backupScheduler";
import { DEFAULT_TENANT_ID } from "@domain/entities";
import { validateJson, getValidated } from "@api/middleware/validate";
import type { AppContainer } from "@bootstrap/container";
import type { AppEnv } from "@api/honoTypes";

const CONFIG_PATH = "./config.json";
const SQLITE_MAGIC = "SQLite format 3\0";

export function backupRoutes(app: AppContainer) {
  const router = new Hono<AppEnv>();

  router.get("/backup", requireAuth(app), requireRole("admin"), async (c) => {
    const zip = createBackupZip(app);

    await app.repos.audit.record({
      tenantId: tenantOf(c),
      userId: c.get("user").id,
      action: "backup.download",
      entityType: "backup",
      entityId: null,
      detail: null,
      createdAt: app.clock.nowIso(),
    });

    return new Response(new Uint8Array(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="argus-backup-${Date.now()}.zip"`,
      },
    });
  });

  const BackupScheduleSchema = z.object({
    enabled: z.boolean(),
    recurrence: z.enum(["daily", "weekly"]),
    keepCount: z.number().int().min(1).max(90),
  });

  router.get("/settings/backup-schedule", requireAuth(app), requireRole("admin"), async (c) => {
    const raw = await app.repos.settings.get(DEFAULT_TENANT_ID, BACKUP_SCHEDULE_KEY);
    const config: BackupScheduleConfig = raw
      ? JSON.parse(raw)
      : { enabled: false, recurrence: "daily", keepCount: 7, lastRunAt: null };
    return c.json(config);
  });

  router.put(
    "/settings/backup-schedule",
    requireAuth(app),
    requireRole("admin"),
    validateJson(BackupScheduleSchema),
    async (c) => {
      const body = getValidated<typeof BackupScheduleSchema>(c);
      const raw = await app.repos.settings.get(DEFAULT_TENANT_ID, BACKUP_SCHEDULE_KEY);
      const existing: BackupScheduleConfig = raw
        ? JSON.parse(raw)
        : { enabled: false, recurrence: "daily", keepCount: 7, lastRunAt: null };
      const config: BackupScheduleConfig = { ...body, lastRunAt: existing.lastRunAt };
      await app.repos.settings.set(DEFAULT_TENANT_ID, BACKUP_SCHEDULE_KEY, JSON.stringify(config));
      return c.json({ ok: true });
    }
  );

  router.post("/backup/restore", requireAuth(app), requireRole("admin"), async (c) => {
    const body = await c.req.arrayBuffer();
    const buf = Buffer.from(body);

    let entries;
    try {
      entries = readZip(buf);
    } catch (err) {
      return c.json({ error: "INVALID_ZIP", message: err instanceof Error ? err.message : String(err) }, 400);
    }

    const dbEntry = entries.find((e) => e.name === "data/argus.db");
    const configEntry = entries.find((e) => e.name === "config.json");
    if (!dbEntry) return c.json({ error: "MISSING_DATABASE", message: "Archive does not contain data/argus.db" }, 400);

    if (dbEntry.data.subarray(0, 16).toString("utf-8") !== SQLITE_MAGIC) {
      return c.json({ error: "INVALID_DATABASE", message: "data/argus.db is not a valid SQLite file" }, 400);
    }
    if (configEntry) {
      try {
        JSON.parse(configEntry.data.toString("utf-8"));
      } catch {
        return c.json({ error: "INVALID_CONFIG", message: "config.json in the archive is not valid JSON" }, 400);
      }
    }

    const actorEmail = c.get("user").email;
    const dbPath = join(app.config.dataDir, "argus.db");
    const timestamp = Date.now();

    // Windows refuses to rename/overwrite a file with an open handle, so the live SQLite
    // connection must be closed *before* touching the file — which means no more DB-backed work
    // (including an audit-log row for this very action) can happen in this process afterward.
    // Logged to the file logger instead, and the process exits shortly after responding so a
    // clean restart picks up the restored data with a fresh connection.
    app.logger.warn("backup_restore_initiated", { by: actorEmail, hadConfig: !!configEntry });
    app.dbMaintenance.close();

    // Safety net: never overwrite without first preserving what was there.
    if (existsSync(dbPath)) renameSync(dbPath, `${dbPath}.pre-restore-${timestamp}`);
    if (existsSync(CONFIG_PATH)) renameSync(CONFIG_PATH, `${CONFIG_PATH}.pre-restore-${timestamp}`);

    writeFileSync(dbPath, dbEntry.data);
    if (configEntry) writeFileSync(CONFIG_PATH, configEntry.data);

    setTimeout(() => process.exit(0), 300); // let the HTTP response flush before the process dies
    return c.json({ ok: true, message: "Restore complete. Argus is restarting — reload this page in a few seconds." });
  });

  return router;
}
