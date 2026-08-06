import { chromium, type FullConfig } from "@playwright/test";

const TEST_EMAIL = "e2e-playwright@argus.local";
const TEST_PASSWORD = "E2ePlaywright!9";

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto(`${baseURL}/login`);
  await page.getByLabel("Email", { exact: true }).fill(TEST_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${baseURL}/`);

  // Brand-new accounts get a first-login product tour modal that blocks every other click until
  // dismissed — skip it once here so it doesn't need handling in every test.
  const skipTour = page.getByRole("button", { name: "Skip" });
  if (await skipTour.isVisible().catch(() => false)) await skipTour.click();

  await page.context().storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
}
