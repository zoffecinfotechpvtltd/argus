import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isServiceInstalled } from "@bootstrap/selfUpdate";

describe("isServiceInstalled", () => {
  it("is false when no Argus-service.xml sits next to the exe", () => {
    const dir = mkdtempSync(join(tmpdir(), "np-selfupdate-"));
    try {
      expect(isServiceInstalled(join(dir, "Argus.exe"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is true when Argus-service.xml sits next to the exe", () => {
    const dir = mkdtempSync(join(tmpdir(), "np-selfupdate-"));
    try {
      writeFileSync(join(dir, "Argus-service.xml"), "<service/>");
      expect(isServiceInstalled(join(dir, "Argus.exe"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
