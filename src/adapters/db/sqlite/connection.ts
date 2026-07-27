import { Database } from "bun:sqlite";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";

let db: Database | null = null;

export function getDb(dataDir: string): Database {
  if (db) return db;
  const dbPath = join(dataDir, "argus.db");
  db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

export interface MigrationFile {
  filename: string;
  sql: string;
}

/**
 * Reads migrations/*.sql straight off disk — only valid where the source tree actually exists
 * (dev server via `bun run`, tests, scripts/simulate.ts). The compiled exe has no such directory
 * on disk (see src/generated/migrationsManifest.ts's header comment), so production code must go
 * through the embedded manifest instead of this function.
 */
export function loadMigrationsFromDir(migrationsDir: string): MigrationFile[] {
  if (!existsSync(migrationsDir)) return [];
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => ({ filename, sql: readFileSync(join(migrationsDir, filename), "utf-8") }));
}

export function runMigrations(database: Database, migrations: MigrationFile[]): string[] {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database
      .query("SELECT id FROM schema_migrations")
      .all()
      .map((r) => (r as { id: string }).id)
  );

  const newlyApplied: string[] = [];
  for (const { filename, sql } of migrations) {
    if (applied.has(filename)) continue;
    const tx = database.transaction(() => {
      database.exec(sql);
      database
        .query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
        .run(filename, new Date().toISOString());
    });
    tx();
    newlyApplied.push(filename);
  }
  return newlyApplied;
}

