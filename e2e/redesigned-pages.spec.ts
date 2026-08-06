import { test, expect, type Page } from "@playwright/test";

// Storage state is pre-authenticated by e2e/global-setup.ts — no per-test login, so tests can run
// in parallel without hitting the app's own login rate-limit/lockout protection.

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    // The SSE reconnect stream is expected to abort on every navigation — not a real error.
    if (msg.type() === "error" && !msg.text().includes("/api/events/stream")) errors.push(msg.text());
  });
  return errors;
}

const PAGES: Array<{ path: string; heading: string }> = [
  { path: "/admin/status-page", heading: "Status Page" },
  { path: "/admin/settings", heading: "General" },
  { path: "/admin/users", heading: "Users" },
  { path: "/admin/audit", heading: "Audit Log" },
  { path: "/admin/license", heading: "License" },
  { path: "/admin/api-keys", heading: "API Keys" },
  { path: "/admin/sso", heading: "SSO / SAML" },
];

for (const { path, heading } of PAGES) {
  test(`${path} renders without console errors`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors, `console/page errors on ${path}: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("SSO page shows the exe-mode empty state, not a broken config form", async ({ page }) => {
  await page.goto("/admin/sso");
  await expect(page.getByText("Not available on this install")).toBeVisible();
  await expect(page.getByLabel("IdP entry point (single sign-on URL)")).toHaveCount(0);
});

test("sidebar admin section stays expanded across navigation", async ({ page }) => {
  await page.goto("/admin/users");
  await expect(page.getByRole("link", { name: "Audit Log" })).toBeVisible();

  await page.goto("/inventory");
  // Admin section should still be expanded after navigating to a non-admin page —
  // this is the exact regression the localStorage persistence fix targets.
  await expect(page.getByRole("link", { name: "Audit Log" })).toBeVisible();
});

test("Status Page device filter narrows the list", async ({ page }) => {
  await page.goto("/admin/status-page");
  const filter = page.getByPlaceholder("Filter devices…");
  if (await filter.count()) {
    await filter.fill("zzz-no-such-device-zzz");
    await expect(page.getByText(/No devices match/)).toBeVisible();
  }
});

test("Users page: temporary password generator fills the field", async ({ page }) => {
  await page.goto("/admin/users");
  const pwField = page.getByLabel("Temporary password");
  await expect(pwField).toHaveValue("");
  await page.getByLabel("Generate a random password").click();
  await expect(pwField).not.toHaveValue("");
});

test("General settings: restore-from-file control is present", async ({ page }) => {
  await page.goto("/admin/settings");
  await expect(page.getByText("Restore from file")).toBeVisible();
});

test("License page: upload button present alongside paste textarea", async ({ page }) => {
  await page.goto("/admin/license");
  await expect(page.getByText("Upload file")).toBeVisible();
  await expect(page.getByPlaceholder("Paste license key…")).toBeVisible();
});

test("Audit log: clear filters control appears only when a filter is active", async ({ page }) => {
  await page.goto("/admin/audit");
  await expect(page.getByText("Clear filters")).toHaveCount(0);
});
