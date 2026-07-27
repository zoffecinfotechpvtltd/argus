import { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let pool: Pool | null = null;

/** One process-wide pool, mirroring the SQLite adapter's single-connection-per-process pattern
 * (`src/adapters/db/sqlite/connection.ts`'s `getDb`) — a fresh `Pool` per call would leak
 * connections under `bun --watch`'s hot-reload the same way a fresh `Database` handle would. */
export function getPgPool(connectionString: string): Pool {
  if (pool) return pool;
  pool = new Pool({ connectionString });
  // pg's own documented contract: an idle pooled client that errors (connection dropped, network
  // blip, Postgres itself restarting) emits 'error' on the Pool, not on any individual query's
  // promise — an EventEmitter with no 'error' listener throws on the next tick, taking the whole
  // process down on what should be a transient, retryable condition. Every process that holds this
  // pool (the web app, every pollerMain.ts poller) needs this or a single dropped idle connection
  // crashes it outright, discovered by a live poller actually crashing this way during testing.
  pool.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("pg_pool_idle_client_error", err.message);
  });
  return pool;
}

export function loadPgMigrationsFromDir(dir: string): Array<{ id: string; sql: string }> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((f) => ({ id: f, sql: readFileSync(join(dir, f), "utf-8") }));
}

/** Applies every migration not already recorded in `schema_migrations`, each in its own
 * transaction — same "run exactly once, in filename order" contract as the SQLite migration
 * runner, translated to Postgres transactions instead of `db.transaction()`. */
export async function runPgMigrations(db: Pool, migrations: Array<{ id: string; sql: string }>): Promise<string[]> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`
  );
  const { rows } = await db.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(rows.map((r) => r.id));

  const newlyApplied: string[] = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(m.sql);
      await client.query("INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)", [m.id, new Date().toISOString()]);
      await client.query("COMMIT");
      newlyApplied.push(m.id);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`Postgres migration ${m.id} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}
