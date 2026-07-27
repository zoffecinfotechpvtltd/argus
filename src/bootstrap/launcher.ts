import { spawn, spawnSync } from "node:child_process";
import { loadConfig } from "@bootstrap/config";
import { findRunningInstance } from "@bootstrap/singleInstance";
import { openBrowser } from "@bootstrap/browser";

/**
 * Entry point for Argus-Launcher.exe — a separate, tiny binary (compiled with
 * `--windows-hide-console`, see package.json "compile:launcher") that the installer's Start
 * Menu/Desktop "Argus Dashboard" shortcuts point at instead of Argus.exe directly.
 *
 * Why a second exe: the installer runs Argus as a background Windows service (see
 * @bootstrap/service), so there's no long-lived console-subsystem Argus.exe process for a
 * shortcut to "reopen" the way the portable exe's own self-relaunch (main.ts's
 * findRunningInstance check) does. A shortcut to Argus.exe itself would flash a console window
 * every click (console-subsystem exes always allocate one) even though all it needs to do is
 * open a browser tab. This binary does that one job silently: find the already-running service
 * and open the browser to its actual configured port (not a hardcoded one — an operator can change
 * it in Settings → General), nudge the service awake if it's stopped, and only
 * fall back to spawning Argus.exe directly if there's no service at all (e.g. a copy without the
 * installer's service registration).
 */

const config = loadConfig(process.env.CONFIG_PATH ?? "./config.json");

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function showError(message: string): void {
  if (process.platform !== "win32") {
    console.error(message);
    return;
  }
  // Same convention as @bootstrap/tray: shell out to PowerShell + WinForms for a native-looking
  // dialog rather than bundling a GUI toolkit. Only reachable if both the service and the
  // Argus.exe fallback failed to come up — a rare path, worth a real (if borrowed) dialog rather
  // than silently doing nothing.
  const escaped = message.replace(/"/g, '`"');
  const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("${escaped}", "Argus", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)`;
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", script], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

const existing = findRunningInstance(config.dataDir);
if (existing) {
  openBrowser(`http://localhost:${existing.port}`);
  process.exit(0);
}

// No running instance found via the lock file — the service is probably stopped. Nudge it awake
// before giving up; this makes the shortcut self-healing after a reboot race or a manual stop,
// not just a link that dies the moment the service isn't already up.
if (process.platform === "win32") {
  spawnSync("sc", ["start", "Argus"], { windowsHide: true, stdio: "ignore" });
}

const url = `http://localhost:${config.port}`;
if (await waitForHealth(url, 6000)) {
  openBrowser(url);
  process.exit(0);
}

// Service isn't installed at all (e.g. Argus.exe + this launcher copied somewhere by hand) —
// fall back to starting Argus.exe directly, same as double-clicking it.
const argusExePath = process.execPath.replace(/Argus-Launcher\.exe$/i, "Argus.exe");
spawn(argusExePath, [], { detached: true, stdio: "ignore", windowsHide: true, cwd: process.cwd() }).unref();

if (await waitForHealth(url, 8000)) {
  openBrowser(url);
  process.exit(0);
}

showError(
  'Argus could not be started. Open the Services app (services.msc) and check the "Argus Monitoring" service, or run Argus.exe directly from the install folder.'
);
process.exit(1);
