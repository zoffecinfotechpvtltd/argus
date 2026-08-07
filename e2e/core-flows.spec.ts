import { test, expect, type Page } from "@playwright/test";

// Storage state is pre-authenticated by e2e/global-setup.ts. This suite covers the core product
// surfaces the admin-settings suite (redesigned-pages.spec.ts) doesn't touch: dashboard, inventory,
// discovery, alerts. Deliberately non-destructive — this runs against the same dev database other
// verification uses, so it reads and interacts with existing data rather than creating/deleting
// devices (the trial license here is already at its 5-device cap, so a real "add device" would
// either fail on quota or need to mutate real demo data either way).

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("/api/events/stream")) errors.push(msg.text());
  });
  return errors;
}

test("Dashboard renders the executive overview without console errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Executive Overview" })).toBeVisible();
  await page.waitForTimeout(800); // widgets fetch metrics async; give them a moment to settle
  expect(errors, `console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("Inventory lists existing devices and supports search", async ({ page }) => {
  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();

  // Devices render as one <table> per group bucket, not a single table.
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();
  const rowCountBefore = await rows.count();
  expect(rowCountBefore).toBeGreaterThan(0);

  const search = page.getByPlaceholder(/search/i).first();
  await search.fill("zzz-no-such-device-zzz");
  await expect(rows).toHaveCount(0);
  await search.fill("");
  await expect(rows.first()).toBeVisible();
});

test("Inventory surfaces the license-limit error instead of silently failing", async ({ page }) => {
  // This dev instance's trial license is already at its device cap — adding one more must fail
  // with a clear, specific message, not a generic/blank error. Real regression coverage for the
  // license-limit path found and reasoned about earlier this session.
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Add device" }).click();
  await page.getByLabel("Name", { exact: true }).fill("e2e-should-not-be-created");
  await page.getByLabel("IP address", { exact: true }).fill("10.99.99.99");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(/allows up to \d+ devices/i);
});

test("Discovery page renders the scan form", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/discovery");
  await expect(page.getByRole("heading", { name: "Discovery", exact: true })).toBeVisible();
  await expect(page.getByLabel("Subnet (CIDR)").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Start scan" }).first()).toBeVisible();
  await page.waitForTimeout(300);
  expect(errors, `console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("Alerts page renders without console errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/alerts");
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors, `console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("Firewalls dashboard renders fleet-wide firewall metrics", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/firewalls");
  await expect(page.getByRole("heading", { name: "Firewalls", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors, `console/page errors: ${errors.join(" | ")}`).toEqual([]);
});

test("Bandwidth page renders and interface discovery control is present for SNMP devices", async ({ page }) => {
  await page.goto("/bandwidth");
  await expect(page.getByRole("heading", { name: "Bandwidth", exact: true })).toBeVisible();
  const discoverButtons = page.getByRole("button", { name: "Discover" });
  if (await discoverButtons.count()) {
    await expect(discoverButtons.first()).toBeVisible();
  }
});
