import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "@ports/config";

const ConfigSchema = z.object({
  // "exe" (default) is the single-tenant Windows build this product ships as — see GUIDE.md. Old
  // config.json files with no "mode" field, or "mode":"exe", keep working unchanged. "saas" is a
  // separate multi-tenant Postgres deployment path, not part of the shipped product.
  mode: z.enum(["exe", "saas"]).default("exe"),
  port: z.coerce.number().int().min(1).max(65535).default(7070),
  dataDir: z.string().default("./data"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  instanceName: z.string().default("Argus"),
  // https-only: this URL is fetched server-side and trusted to point update-apply at a binary to
  // download and execute (see api/routes/generalSettings.ts) — a plain-http feed is interceptable
  // by anyone on the network path. Validated here too, not just on the settings-PUT route, so
  // setting it via env var or a hand-edited config.json can't bypass the same protection.
  updateCheckUrl: z
    .string()
    .refine((u) => u === "" || u.startsWith("https://"), "updateCheckUrl must be https://")
    .optional(),
  polling: z
    .object({
      defaultIntervalSec: z.coerce.number().int().min(10).default(60),
      concurrency: z.coerce.number().int().min(1).max(500).default(50),
    })
    .default({ defaultIntervalSec: 60, concurrency: 50 }),
  retention: z
    .object({
      rawDays: z.coerce.number().int().min(1).default(30),
      rollupDays: z.coerce.number().int().min(1).default(365),
    })
    .default({ rawDays: 30, rollupDays: 365 }),
  postgres: z.object({ url: z.string().min(1) }).optional(),
  // Not required by the base saas web process (only pollerMain.ts's lease coordinator and M2's SSE
  // fan-out actually need it) — no cross-field refine forcing it the way postgres.url is forced.
  redis: z.object({ url: z.string().min(1) }).optional(),
})
  // Cross-field: saas mode is meaningless without a Postgres connection string. Checked here
  // (not just "the pool constructor will throw eventually") so a misconfigured saas deployment
  // fails at startup with a clear message instead of a confusing later error the first time a
  // route touches the database.
  .refine((cfg) => cfg.mode !== "saas" || !!cfg.postgres?.url, {
    message: "postgres.url (or DATABASE_URL) is required when mode is \"saas\"",
    path: ["postgres", "url"],
  });

// Compile-time check that the zod schema's inferred shape matches the pure port type applications depend on.
type _AssertConfigMatchesPort = z.infer<typeof ConfigSchema> extends AppConfig ? true : never;
const _configShapeCheck: _AssertConfigMatchesPort = true;
void _configShapeCheck;

export type { AppConfig };
export { ConfigSchema };

function readConfigFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse config.json at ${path}: ${(err as Error).message}`);
  }
}

function envOverrides(): Record<string, unknown> {
  const env = process.env;
  const out: Record<string, unknown> = {};
  if (env.PORT) out.port = env.PORT;
  if (env.DATA_DIR) out.dataDir = env.DATA_DIR;
  if (env.LOG_LEVEL) out.logLevel = env.LOG_LEVEL;
  if (env.INSTANCE_NAME) out.instanceName = env.INSTANCE_NAME;
  if (env.UPDATE_CHECK_URL) out.updateCheckUrl = env.UPDATE_CHECK_URL;
  if (env.MODE) out.mode = env.MODE;
  // DATABASE_URL is the 12-factor/Docker-Compose convention every Postgres image and hosting
  // platform (Render, Fly, Railway, Heroku) already sets — matching it means no bespoke env var
  // name to document for the saas deployment path.
  if (env.DATABASE_URL) out.postgres = { url: env.DATABASE_URL };
  if (env.REDIS_URL) out.redis = { url: env.REDIS_URL };
  return out;
}

let cached: AppConfig | null = null;

export function loadConfig(configPath = "./config.json"): AppConfig {
  if (cached) return cached;

  const fileConfig = readConfigFile(configPath);
  const merged = { ...fileConfig, ...envOverrides() };

  const result = ConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid configuration in ${configPath}:\n${issues}`);
    process.exit(1);
  }

  const cfg = result.data;
  if (!existsSync(cfg.dataDir)) mkdirSync(cfg.dataDir, { recursive: true });

  cached = cfg;
  return cfg;
}

/** Loads or creates a persistent per-instance secret used to derive encryption keys (SNMP creds, ack tokens). */
export function loadOrCreateInstanceKey(dataDir: string): Buffer {
  const keyPath = join(dataDir, "instance.key");
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, "utf-8").trim(), "hex");
  }
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  return key;
}
