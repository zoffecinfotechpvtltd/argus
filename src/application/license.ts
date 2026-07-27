import type { AppContainer } from "@ports/context";
import { effectiveDeviceLimit } from "@domain/license";

export class LicenseLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseLimitError";
  }
}

/** Throws LicenseLimitError if creating `additionalCount` more devices (default 1) would exceed
 * what the current exe-mode license (or, absent one, the trial cap) allows — pass a larger count
 * for a bulk import (see application/discovery/importDiscoveredDevices.ts), which otherwise
 * bypasses this check entirely by inserting directly via a batch repo call instead of the
 * single-device create path. */
export async function assertLicenseAllowsNewDevice(app: AppContainer, tenantId: string, additionalCount = 1): Promise<void> {
  const state = await app.license.getState(tenantId);
  const limit = effectiveDeviceLimit(state);
  const page = await app.repos.device.list(tenantId, { limit: 1, offset: 0 });
  if (page.total + additionalCount <= limit) return;

  const suffix = additionalCount <= 1 ? "" : ` (importing ${additionalCount} would put you at ${page.total + additionalCount})`;
  if (state.status === "valid" || state.status === "grace") {
    throw new LicenseLimitError(`Your license allows up to ${limit} devices${suffix}. Contact sales to upgrade your plan.`);
  }
  throw new LicenseLimitError(`Trial mode allows up to ${limit} devices${suffix}. Enter a license key in Settings → License to add more.`);
}
