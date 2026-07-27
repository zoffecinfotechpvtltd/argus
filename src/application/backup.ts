import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppContainer } from "@ports/context";

const CONFIG_PATH = "./config.json";

/** Shared by the manual "Download" button (src/api/routes/backup.ts) and the scheduled backup job
 * (src/application/backupScheduler.ts) — one place decides what a backup archive contains. Zip
 * building itself goes through the DbMaintenance port (`buildZip`) rather than importing the zip
 * adapter directly, per the hexagonal-architecture rule that application/ only depends on ports/. */
export function createBackupZip(app: AppContainer): Buffer {
  app.dbMaintenance.checkpoint(); // flush WAL so the on-disk db file is complete and consistent

  const dbPath = join(app.config.dataDir, "argus.db");
  const entries = [];
  if (existsSync(dbPath)) entries.push({ name: "data/argus.db", data: readFileSync(dbPath) });
  if (existsSync(CONFIG_PATH)) entries.push({ name: "config.json", data: readFileSync(CONFIG_PATH) });

  return app.dbMaintenance.buildZip(entries);
}
