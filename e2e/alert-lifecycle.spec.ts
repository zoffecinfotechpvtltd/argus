import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Drives a real alert through open -> acknowledged -> resolved via the Alerts page UI. Rather than
// waiting on a real device to actually go down (slow, flaky, and this dev instance's demo devices
// are meant to stay up for other verification), seeds one throwaway alert row directly into the
// same dev DB the running server reads from, then cleans it up afterward.
//
// Seeding/cleanup shells out to a real `bun` process rather than `import { Database } from
// "bun:sqlite"` directly in this file — Playwright's own test-file loader runs under Node's ESM
// resolver even when invoked via `bunx`, which doesn't understand the `bun:` protocol and fails
// the whole file's collection. Shelling out sidesteps that entirely.

const ALERT_TITLE = "E2E lifecycle test alert — safe to ignore if seen live";

// Writes the script to a temp file and runs it as `bun <file>` rather than `bun -e <script>` —
// passing a bare file path sidesteps both the Windows bun.cmd-shim ENOENT issue (needs shell:true
// to resolve) and cmd.exe mangling a multi-line inline script full of backticks/`$`/quotes.
function runBun(script: string): string {
  const scriptPath = join(tmpdir(), `argus-e2e-${randomUUID()}.ts`);
  writeFileSync(scriptPath, script);
  try {
    return execFileSync("bun", [scriptPath], { cwd: process.cwd(), encoding: "utf-8", shell: true });
  } finally {
    unlinkSync(scriptPath);
  }
}

test("alert moves open -> acknowledged -> resolved through the Alerts page", async ({ page }) => {
  const alertId = randomUUID();

  const seedResult = runBun(`
    import { Database } from "bun:sqlite";
    const db = new Database("data/argus.db");
    const device = db.query("SELECT id, tenant_id FROM devices LIMIT 1").get();
    if (!device) { console.log("NO_DEVICE"); process.exit(0); }
    const now = new Date().toISOString();
    db.query(\`INSERT INTO alerts (id, tenant_id, device_id, condition_key, severity, status, title, detail, opened_at, last_seen_at, acked_by, acked_at, resolved_at, escalation_step)
      VALUES ('${alertId}', $tenant_id, $device_id, 'e2e_lifecycle_test', 'critical', 'open', $title, 'Seeded directly for e2e lifecycle coverage', $now, $now, NULL, NULL, NULL, 0)\`)
      .run({ $tenant_id: device.tenant_id, $device_id: device.id, $title: ${JSON.stringify(ALERT_TITLE)}, $now: now });
    console.log("OK");
  `).trim();
  test.skip(seedResult === "NO_DEVICE", "no device in this dev DB to attach a test alert to");
  expect(seedResult).toBe("OK");

  try {
    await page.goto("/alerts");
    // Default status filter is "open" — acknowledging/resolving would otherwise make the row
    // vanish from a filtered list instead of updating in place, since handleAck/handleResolve
    // re-fetch honoring whatever the current filter is.
    await page.getByRole("combobox").first().selectOption("");

    // Scoped to the specific row card's own class, not a bare "div" — a plain `div` filter matches
    // every ancestor div up to the page root, so text queries inside it saw every alert on the
    // page, not just this one.
    const row = page.locator("div.relative.overflow-hidden.rounded-lg", { has: page.getByRole("heading", { name: ALERT_TITLE, level: 3 }) });
    await expect(row).toBeVisible();
    await expect(row.getByText("open", { exact: true })).toBeVisible();

    await row.getByRole("button", { name: "Acknowledge" }).click();
    await expect(row.getByText("acknowledged", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Acknowledge" })).toHaveCount(0); // open-only action, gone once acked

    await row.getByRole("button", { name: "Resolve" }).click();
    await expect(row.getByText("resolved", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Resolve" })).toHaveCount(0); // no actions left once resolved
  } finally {
    runBun(`
      import { Database } from "bun:sqlite";
      const db = new Database("data/argus.db");
      db.query("DELETE FROM alerts WHERE id = $id").run({ $id: ${JSON.stringify(alertId)} });
    `);
  }
});
