import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { buildTestContainer } from "./helpers/testContainer";
import { buildServer } from "@api/server";
import { createSession, SESSION_COOKIE } from "@api/middleware/auth";
import { hashPassword } from "@adapters/crypto";
import { DEFAULT_TENANT_ID } from "@domain/entities";

const CONFIG_PATH = "./config.json";

async function seedAdmin(app: Awaited<ReturnType<typeof buildTestContainer>>["app"]) {
  const now = app.clock.nowIso();
  const user = await app.repos.user.create({
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    email: `admin-${randomUUID()}@test.local`,
    passwordHash: await hashPassword("irrelevant-but-long-enough"),
    role: "admin",
    forcePasswordReset: false,
    disabled: false,
    emailVerifiedAt: now,
    totpSecret: null,
    totpEnabled: false,
    failedLoginCount: 0,
    lockedUntil: null,
    onboardingCompletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const session = await createSession(app, user);
  const csrf = "test-csrf-token";
  return { cookie: `${SESSION_COOKIE}=${session.id}; np_csrf=${csrf}`, csrfHeader: csrf };
}

describe("PUT /settings/general", () => {
  it("applies non-restart-required fields (heartbeatUrl, updateCheckUrl) to the running config immediately, not just config.json on disk", async () => {
    const { app } = buildTestContainer();
    const hono = buildServer(app);
    const { cookie, csrfHeader } = await seedAdmin(app);

    expect(app.config.heartbeatUrl).toBe("");

    // This route hard-codes "./config.json" relative to cwd — the repo root may genuinely have one
    // (e.g. from running the app locally) that this test must not clobber. Snapshot and restore it
    // exactly, rather than deleting, regardless of whether it existed before this test ran.
    const hadExistingConfig = existsSync(CONFIG_PATH);
    const existingConfigContent = hadExistingConfig ? readFileSync(CONFIG_PATH, "utf-8") : null;

    try {
      const res = await hono.request("/api/settings/general", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie, "x-csrf-token": csrfHeader },
        body: JSON.stringify({
          instanceName: "Renamed Instance",
          port: app.config.port,
          logLevel: "info",
          polling: app.config.polling,
          retention: app.config.retention,
          heartbeatUrl: "https://hc-ping.com/some-uuid",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; restartRequired: boolean };
      expect(body.ok).toBe(true);
      expect(body.restartRequired).toBe(false); // port/concurrency unchanged

      // The actual regression: this must reflect the new value on the SAME running app.config,
      // without needing a process restart — previously PUT only wrote config.json to disk.
      expect(app.config.heartbeatUrl).toBe("https://hc-ping.com/some-uuid");
      expect(app.config.instanceName).toBe("Renamed Instance");
    } finally {
      if (hadExistingConfig) writeFileSync(CONFIG_PATH, existingConfigContent!);
      else if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
    }
  });
});
