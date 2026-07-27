import type { Pool } from "pg";
import type { LicenseService } from "@ports/services";
import type { LicensePlan, LicenseState } from "@domain/license";
import { findTenantPlan } from "@adapters/db/postgres/tenantRepos";

/** Saas-mode `LicenseService`: a tenant's tier lives in the `tenants` row (`plan`, `device_limit`,
 * `poller_limit`) set at signup and changed by billing/an admin action — not a license file a user
 * uploads (that's exe-mode's model, for a self-hosted copy with no billing system behind it). Every
 * call reads Postgres directly rather than caching — tenant rows change rarely and a stale cached
 * device limit right after a plan upgrade would be a worse bug than one extra query per check. */
export class PgTenantLicenseService implements LicenseService {
  constructor(private db: Pool) {}

  async getState(tenantId?: string): Promise<LicenseState> {
    if (!tenantId) return { status: "unlicensed" };
    const plan = await findTenantPlan(this.db, tenantId);
    if (!plan) return { status: "unlicensed" };
    const now = new Date().toISOString();
    return {
      status: "valid",
      payload: {
        licenseId: plan.id,
        customer: plan.id,
        plan: plan.plan as LicensePlan,
        deviceLimit: plan.deviceLimit,
        issuedAt: now,
        // Saas tiers don't expire on a calendar date the way a self-host license file does —
        // billing status (active/past-due/canceled) is a separate, not-yet-built concern (see
        // SAAS_GAPS.md M0 notes); represented here as a far-future expiry so `verifyLicenseFile`'s
        // grace/expired branches (which don't apply to a billing-driven tier) never trigger.
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    };
  }

  reload(): void {
    // No-op — nothing cached to invalidate (see class doc comment).
  }

  async applyLicenseFile(): Promise<LicenseState> {
    throw new Error("Saas-mode tenants don't apply license files — plan changes go through billing/admin, not a signed file upload.");
  }
}
