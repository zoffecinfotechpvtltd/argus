import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLock, findRunningInstance, releaseLock } from "@bootstrap/singleInstance";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "argus-lock-test-"));
}

describe("singleInstance", () => {
  test("no lock file means no running instance", () => {
    const dir = tempDir();
    try {
      expect(findRunningInstance(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("acquireLock then findRunningInstance detects the live process (self)", () => {
    const dir = tempDir();
    try {
      acquireLock(dir, 7070);
      const found = findRunningInstance(dir);
      expect(found).toEqual({ port: 7070 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("releaseLock removes the lock file", () => {
    const dir = tempDir();
    try {
      acquireLock(dir, 7070);
      expect(existsSync(join(dir, "argus.lock"))).toBe(true);
      releaseLock(dir);
      expect(existsSync(join(dir, "argus.lock"))).toBe(false);
      expect(findRunningInstance(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stale lock (dead pid) is cleaned up and treated as not running", () => {
    const dir = tempDir();
    try {
      // PID 999999 is exceedingly unlikely to be alive on any real machine.
      writeFileSync(join(dir, "argus.lock"), JSON.stringify({ pid: 999999, port: 7070 }));
      expect(findRunningInstance(dir)).toBeNull();
      expect(existsSync(join(dir, "argus.lock"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt lock file is treated as not running and removed", () => {
    const dir = tempDir();
    try {
      writeFileSync(join(dir, "argus.lock"), "not json{{{");
      expect(findRunningInstance(dir)).toBeNull();
      expect(existsSync(join(dir, "argus.lock"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
