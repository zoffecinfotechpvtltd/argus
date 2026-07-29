import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Clock, LicenseService } from "@ports/services";
import type { LicenseState } from "@domain/license";
import { verifyLicenseFile } from "@domain/license";

/** Loads/verifies/persists the exe-mode license file (DATA_DIR/license.key) against a fixed
 * public key. File I/O lives here, not in @domain/license.ts, so that module can stay pure. */
export class FileLicenseService implements LicenseService {
  private licensePath: string;
  private state: LicenseState = { status: "unlicensed" };

  constructor(private dataDir: string, private publicKeyPem: string, private clock: Clock) {
    this.licensePath = join(dataDir, "license.key");
    this.reload();
  }

  async getState(): Promise<LicenseState> {
    // Re-verify against the live clock on every read rather than trusting the cached value from
    // construction/last applyLicenseFile() — Argus runs for weeks/months as a background service
    // with no restart, so a status computed once at startup would silently keep reporting "valid"
    // long after real-world expiry (and the grace period) had actually passed, since nothing else
    // in the process was reloading it. This was caught by a test that renewed a license past its
    // grace period without restarting the service and found the cached state still said "valid".
    this.reload();
    return this.state;
  }

  reload(): void {
    if (!existsSync(this.licensePath)) {
      this.state = { status: "unlicensed" };
      return;
    }
    const raw = readFileSync(this.licensePath, "utf-8");
    this.state = verifyLicenseFile(raw, this.publicKeyPem, this.clock.nowIso());
  }

  async applyLicenseFile(raw: string): Promise<LicenseState> {
    const state = verifyLicenseFile(raw, this.publicKeyPem, this.clock.nowIso());
    if (state.status === "invalid") {
      throw new Error(state.reason);
    }
    writeFileSync(this.licensePath, raw.trim(), { mode: 0o600 });
    this.state = state;
    return this.state;
  }
}
