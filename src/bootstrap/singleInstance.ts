import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface LockContents {
  pid: number;
  port: number;
}

/** True if a process with this PID is currently running (works cross-platform: signal 0 never actually delivered). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === "EPERM"; // exists but we lack permission to signal it — still alive
  }
}

/**
 * Reads dataDir/argus.lock. Returns the running instance's port if a live process holds it, so
 * the caller can just open a browser to it and exit instead of starting a second server. Cleans up
 * a stale lock (holder process no longer running) automatically.
 */
export function findRunningInstance(dataDir: string): { port: number } | null {
  const lockPath = join(dataDir, "argus.lock");
  if (!existsSync(lockPath)) return null;

  let contents: LockContents;
  try {
    contents = JSON.parse(readFileSync(lockPath, "utf-8"));
  } catch {
    unlinkSync(lockPath); // corrupt lock file — treat as stale
    return null;
  }

  if (typeof contents.pid !== "number" || typeof contents.port !== "number") {
    unlinkSync(lockPath);
    return null;
  }

  if (isProcessAlive(contents.pid)) return { port: contents.port };

  unlinkSync(lockPath); // stale — previous instance crashed or was killed without cleanup
  return null;
}

export function acquireLock(dataDir: string, port: number): void {
  const lockPath = join(dataDir, "argus.lock");
  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, port } satisfies LockContents));
}

export function releaseLock(dataDir: string): void {
  const lockPath = join(dataDir, "argus.lock");
  try {
    if (existsSync(lockPath)) unlinkSync(lockPath);
  } catch {
    // best-effort — a leftover lock is safely detected as stale on next launch via isProcessAlive
  }
}
