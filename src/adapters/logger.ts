import type { Logger } from "@ports/services";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

type Level = "debug" | "info" | "warn" | "error";
const LEVEL_ORDER: Level[] = ["debug", "info", "warn", "error"];

export class JsonLogger implements Logger {
  private minLevel: number;
  private filePath: string | null = null;

  constructor(minLevel: Level = "info", dataDir?: string) {
    this.minLevel = LEVEL_ORDER.indexOf(minLevel);
    if (dataDir) {
      const logsDir = join(dataDir, "logs");
      if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
      this.filePath = join(logsDir, "argus.log");
    }
  }

  private write(level: Level, msg: string, meta?: Record<string, unknown>) {
    if (LEVEL_ORDER.indexOf(level) < this.minLevel) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
    // eslint-disable-next-line no-console
    console[level === "debug" ? "log" : level](line);
    if (this.filePath) {
      try {
        appendFileSync(this.filePath, line + "\n");
      } catch {
        // best-effort file logging; console output above is authoritative
      }
    }
  }

  debug(msg: string, meta?: Record<string, unknown>) {
    this.write("debug", msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>) {
    this.write("info", msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>) {
    this.write("warn", msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    this.write("error", msg, meta);
  }
}
