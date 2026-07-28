#!/usr/bin/env bun
/**
 * One-command release pipeline (Phase 7 acceptance criterion): clean -> test -> build UI ->
 * compile exe -> stamp icon/version -> smoke test (spawn in a clean temp dir, hit /api/health,
 * complete setup, create a device via the real API, verify it persisted, kill) -> checksum. Any
 * step failing aborts the release — a broken build should never reach dist/.
 *
 * Usage: bun run release   (== bun run scripts/release.ts)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { rcedit } from "rcedit";
import pkg from "../package.json";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const EXE_NAME = "Argus.exe";
const EXE_PATH = join(DIST, EXE_NAME);
const LAUNCHER_NAME = "Argus-Launcher.exe";
const LAUNCHER_PATH = join(DIST, LAUNCHER_NAME);

async function step(name: string, fn: () => void | Promise<void>): Promise<void> {
  const start = Date.now();
  process.stdout.write(`\n=== ${name} ===\n`);
  await fn();
  process.stdout.write(`--- ${name} OK (${((Date.now() - start) / 1000).toFixed(1)}s) ---\n`);
}

function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): void {
  const res = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: opts.cwd ?? ROOT,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...opts.env },
  });
  if (res.status !== 0) {
    throw new Error(`Command failed (${res.status}): ${cmd.join(" ")}`);
  }
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`exe did not respond to /api/health within ${timeoutMs}ms`);
}

await step("Clean", () => {
  rmSync(DIST, { recursive: true, force: true });
  rmSync(join(ROOT, "ui", "dist"), { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
});

await step("Test", () => {
  run(["bun", "run", "generate:embeds"]);
  run(["bun", "test"]);
  run(["bunx", "tsc", "--noEmit"]);
  run(["bunx", "eslint", ".", "--ext", ".ts,.tsx"]);
});

await step("Build UI + embed assets", () => {
  run(["bun", "run", "build:ui"]);
  run(["bun", "run", "generate:embeds"]);
});

await step("Compile exe", () => {
  // --windows-hide-console: Argus.exe only ever needs a console when an admin runs
  // --install-service/--version by hand from an already-open terminal (stdio is inherited either
  // way, so that still works) — it must never allocate a NEW console on its own, whether launched
  // as a WinSW service (Session 0 has none anyway), double-clicked directly, or spawned by
  // launcher.ts's fallback path.
  run([
    "bun", "build", "--compile", "--minify", "--windows-hide-console", "--target=bun-windows-x64",
    "src/bootstrap/main.ts", "--outfile", EXE_PATH,
  ]);
});

await step("Compile launcher", () => {
  // Silent, console-less companion binary the installer's shortcuts point at — see
  // src/bootstrap/launcher.ts for why this can't just be a shortcut to Argus.exe itself.
  run(["bun", "build", "--compile", "--minify", "--windows-hide-console", "--target=bun-windows-x64", "src/bootstrap/launcher.ts", "--outfile", LAUNCHER_PATH]);
});

await step("Force GUI subsystem (belt-and-suspenders console fix)", () => {
  // --windows-hide-console does NOT actually set IMAGE_SUBSYSTEM_WINDOWS_GUI in the compiled PE
  // header (verified directly against the raw bytes) — whatever it does instead to suppress the
  // console is a runtime trick (almost certainly an early FreeConsole() call), and that class of
  // trick is exactly what breaks when Windows 11's "Windows Terminal" is set as the default
  // terminal application: Windows Terminal hosts the process's console via ConPTY the instant a
  // console-subsystem process is created, before the process gets a chance to detach, leaving a
  // stuck blank tab behind instead of never opening one at all. This is the confirmed root cause
  // of the black terminal customers were seeing even after the --windows-hide-console flag.
  // Patching the Subsystem field directly to WINDOWS_GUI (2) means Windows never allocates or
  // attaches a console for these exes in the first place — nothing for Windows Terminal to ever
  // hook into, regardless of default-terminal settings. See scripts/patchPeSubsystem.ts.
  run(["bun", "run", "scripts/patchPeSubsystem.ts", EXE_PATH, LAUNCHER_PATH]);
});

await step("Stamp icon + version resource", async () => {
  const iconPath = join(ROOT, "assets", "icon.ico");
  if (!existsSync(iconPath)) throw new Error(`Missing ${iconPath} — run \`bun run scripts/generate-icon.ts\` once.`);
  // Whoever is selling this stamps their own company name via COMPANY_NAME — defaults to "Argus"
  // itself rather than a hardcoded placeholder business that may not be who's actually shipping it.
  const companyName = process.env.COMPANY_NAME || "Argus";
  for (const [exePath, description] of [
    [EXE_PATH, "Argus network monitoring"],
    [LAUNCHER_PATH, "Argus dashboard launcher"],
  ] as const) {
    await rcedit(exePath, {
      icon: iconPath,
      "file-version": `${pkg.version}.0`,
      "product-version": `${pkg.version}.0`,
      "version-string": {
        ProductName: "Argus",
        FileDescription: description,
        CompanyName: companyName,
        LegalCopyright: `Copyright ${new Date().getFullYear()} ${companyName}`,
      },
    });
  }
});

await step("Smoke test", async () => {
  const size = readFileSync(EXE_PATH).length;
  const sizeMb = size / (1024 * 1024);
  process.stdout.write(`exe size: ${sizeMb.toFixed(1)} MB\n`);
  if (sizeMb > 120) throw new Error(`exe size ${sizeMb.toFixed(1)}MB exceeds the 120MB acceptance limit`);

  const workDir = mkdtempSync(join(tmpdir(), "argus-release-smoke-"));
  const exeCopy = join(workDir, EXE_NAME);
  writeFileSync(exeCopy, readFileSync(EXE_PATH));
  const port = 17099;
  const base = `http://localhost:${port}`;

  const proc = Bun.spawn([exeCopy], {
    cwd: workDir,
    env: { ...process.env, PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });

  try {
    const startedAt = Date.now();
    await waitForHealth(base, 10_000);
    process.stdout.write(`cold start: ${Date.now() - startedAt}ms\n`);
    if (Date.now() - startedAt > 3000) {
      process.stdout.write("WARNING: cold start exceeded the 3s acceptance target\n");
    }

    const health = await (await fetch(`${base}/api/health`)).json();
    process.stdout.write(`health: ${JSON.stringify(health)}\n`);
    if (!health.version) throw new Error("health response missing version");

    const setupRes = await fetch(`${base}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "smoke@argus.local",
        password: "SmokeTest123!Password",
        instanceName: "SmokeTest",
        acceptedTerms: true,
      }),
    });
    if (!setupRes.ok) throw new Error(`setup failed: ${setupRes.status} ${await setupRes.text()}`);
    const setCookie = setupRes.headers.getSetCookie();
    const sessionCookie = setCookie.find((c) => c.startsWith("np_session="))?.split(";")[0];
    const csrfCookiePair = setCookie.find((c) => c.startsWith("np_csrf="))?.split(";")[0];
    const csrfToken = csrfCookiePair?.split("=")[1];
    if (!sessionCookie || !csrfCookiePair || !csrfToken) throw new Error("setup did not return session/csrf cookies");
    // CSRF is double-submit: the server compares the np_csrf *cookie* against the X-CSRF-Token
    // *header*, so both cookies must be sent back together on every mutating request.
    const cookieHeader = `${sessionCookie}; ${csrfCookiePair}`;

    const deviceRes = await fetch(`${base}/api/devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader, "X-CSRF-Token": csrfToken },
      body: JSON.stringify({ name: "release-smoke-device", ip: "10.0.0.5" }),
    });
    if (!deviceRes.ok) throw new Error(`device create failed: ${deviceRes.status} ${await deviceRes.text()}`);
    const device = (await deviceRes.json()) as { id: string };
    process.stdout.write(`created device: ${device.id}\n`);

    const listRes = await fetch(`${base}/api/devices`, { headers: { Cookie: cookieHeader } });
    const list = (await listRes.json()) as { total: number };
    if (list.total !== 1) throw new Error(`expected 1 device after create, found ${list.total}`);

    if (!existsSync(join(workDir, "data", "argus.db"))) throw new Error("data/argus.db was not created next to the exe");

    process.stdout.write("smoke test passed: health -> setup -> device create -> device list -> data dir created\n");
  } finally {
    proc.kill();
    await proc.exited;
    rmSync(workDir, { recursive: true, force: true });
  }
});

let releaseFinalName = "";

await step("Checksum + rename", () => {
  const finalName = `Argus-v${pkg.version}-win-x64.exe`;
  const finalPath = join(DIST, finalName);
  const bytes = readFileSync(EXE_PATH);
  writeFileSync(finalPath, bytes);
  rmSync(EXE_PATH);

  const hash = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(DIST, `${finalName}.sha256`), `${hash}  ${finalName}\n`);
  releaseFinalName = finalName;

  process.stdout.write(`\nRelease artifact: dist/${finalName}\n`);
  process.stdout.write(`SHA256: ${hash}\n`);
});

let installerName: string | null = null;

/** Locates Inno Setup's compiler. Not bundled/required — machines without it (CI, a teammate's
 * laptop) still produce the portable exe; only the wizard installer is skipped, with a clear
 * warning, same soft-fail convention as the WinSW lookup in @bootstrap/service. */
function findIscc(): string | null {
  const candidates = [
    process.env.ISCC_PATH,
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Programs", "Inno Setup 6", "ISCC.exe") : undefined,
  ].filter((p): p is string => !!p);
  for (const c of candidates) if (existsSync(c)) return c;
  const where = spawnSync("where", ["iscc"], { shell: false });
  if (where.status === 0) {
    const first = where.stdout.toString("utf-8").split(/\r?\n/).find((l) => l.trim());
    if (first) return first.trim();
  }
  return null;
}

await step("Build installer (Inno Setup)", () => {
  const iscc = findIscc();
  if (!iscc) {
    process.stdout.write(
      "Inno Setup (ISCC.exe) not found — skipping the wizard installer, only the portable exe will ship.\n" +
        "Install it with `winget install JRSoftware.InnoSetup` (or set ISCC_PATH) to produce Argus-Setup-*.exe.\n"
    );
    return;
  }

  const winswSrc = join(ROOT, "tools", "Argus-service.exe");
  if (!existsSync(winswSrc)) {
    process.stdout.write(
      "tools/Argus-service.exe (WinSW) not present — the installer will still build, but --install-service will\n" +
        "print manual setup instructions on the customer's machine instead of registering the service automatically.\n" +
        "See src/bootstrap/service.ts for where to get WinSW.\n"
    );
  }

  run([
    iscc,
    `/DMyAppVersion=${pkg.version}`,
    `/DMyAppExeSource=${join(DIST, releaseFinalName)}`,
    `/DMyAppLauncherSource=${LAUNCHER_PATH}`,
    `/DMyAppPublisher=${process.env.COMPANY_NAME || "Argus"}`,
    join(ROOT, "installer", "argus.iss"),
  ]);

  const name = `Argus-Setup-v${pkg.version}-win-x64.exe`;
  const path = join(DIST, name);
  if (!existsSync(path)) throw new Error(`ISCC reported success but ${path} was not produced`);

  const bytes = readFileSync(path);
  const hash = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(join(DIST, `${name}.sha256`), `${hash}  ${name}\n`);
  installerName = name;
  process.stdout.write(`\nInstaller: dist/${name}\nSHA256: ${hash}\n`);
});

await step("Publish stable-name aliases", () => {
  // website/public/downloads/ is the download surface (same-origin static file, no GitHub
  // dependency — see website/src/config.ts). The download button always links at a fixed
  // filename so the site never needs a code change or redeploy just because a new version
  // shipped, so alongside the versioned artifacts (Argus-Setup-v1.2.0-win-x64.exe, kept for
  // anyone who wants a specific version pinned, and optionally still uploaded to GitHub Releases
  // for changelog/history purposes) we also publish unversioned aliases with a fixed name — same
  // bytes, second filename — directly into the website's public folder so the next deploy picks
  // them up automatically.
  const WEBSITE_DOWNLOADS = join(ROOT, "website", "public", "downloads");
  mkdirSync(WEBSITE_DOWNLOADS, { recursive: true });

  const aliasOf = (versionedName: string, aliasName: string) => {
    const bytes = readFileSync(join(DIST, versionedName));
    const hash = createHash("sha256").update(bytes).digest("hex");

    writeFileSync(join(DIST, aliasName), bytes);
    writeFileSync(join(DIST, `${aliasName}.sha256`), `${hash}  ${aliasName}\n`);

    writeFileSync(join(WEBSITE_DOWNLOADS, aliasName), bytes);
    writeFileSync(join(WEBSITE_DOWNLOADS, `${aliasName}.sha256`), `${hash}  ${aliasName}\n`);
  };

  aliasOf(releaseFinalName, "Argus-win-x64.exe");
  process.stdout.write(`Portable alias: dist/Argus-win-x64.exe + website/public/downloads/Argus-win-x64.exe\n`);

  if (installerName) {
    aliasOf(installerName, "Argus-Setup-win-x64.exe");
    process.stdout.write(`Installer alias: dist/Argus-Setup-win-x64.exe + website/public/downloads/Argus-Setup-win-x64.exe\n`);
  }

  process.stdout.write(
    "\nCommit the updated website/public/downloads/*.exe (or push straight to the branch Vercel deploys) so the\n" +
      "live Download button serves the new build. Optionally also `gh release create` with dist/*.exe for changelog\n" +
      "history — see README §7 — but the site no longer depends on that release existing.\n"
  );
});
