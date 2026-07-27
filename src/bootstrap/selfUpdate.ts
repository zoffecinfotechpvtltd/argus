import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { spawn } from "node:child_process";

/**
 * `--tray` (see bootstrap/tray.ts) already establishes the pattern this follows: Windows can't
 * overwrite or delete the .exe file of its own currently-running process, so replacing it has to
 * happen from a second, short-lived process that outlives this one. Rather than bundling a native
 * helper binary (breaks the single-self-contained-exe goal), a small generated PowerShell script
 * does it: wait for this process's PID to exit, swap the downloaded file into place, relaunch it.
 *
 * The API route (api/routes/generalSettings.ts) does the network fetch + sha256 verification
 * *before* calling this — this module only ever touches a file that's already been checksum-
 * verified against the update feed's advertised hash.
 */

/** True if Argus was registered as a Windows service via --install-service (see
 * bootstrap/service.ts) — self-update's swap-then-relaunch would race WinSW's own process
 * supervision in that case, so the caller should refuse and point the admin at a manual
 * stop/replace/start instead. */
export function isServiceInstalled(exePath: string): boolean {
  return existsSync(join(dirname(exePath), "Argus-service.xml"));
}

export interface SelfUpdateOptions {
  /** The running process's own PID (process.pid) — the helper script waits for this to exit before touching any files. */
  pid: number;
  /** process.execPath — the currently-running exe's own file path, which gets replaced. Always absolute. */
  currentExePath: string;
  /** Absolute path to the already-downloaded, already-checksum-verified new exe. Must be
   * absolute: the helper script is a detached process whose own working directory shouldn't be
   * relied on to match wherever the caller's relative path was meant to resolve against. */
  newExePath: string;
}

/** Writes and spawns (detached) the swap-and-relaunch helper script. Returns false without doing
 * anything on non-Windows, where this isn't implemented (mirrors --tray's own platform guard). */
export function spawnSelfUpdateHelper(opts: SelfUpdateOptions): boolean {
  if (process.platform !== "win32") return false;

  const scriptPath = join(dirname(opts.currentExePath), "argus-self-update.ps1");
  writeFileSync(
    scriptPath,
    buildSelfUpdateScript({
      pid: opts.pid,
      oldExe: opts.currentExePath,
      newExe: opts.newExePath,
      workDir: dirname(opts.currentExePath),
    })
  );

  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath], {
    cwd: dirname(opts.currentExePath),
    detached: true,
    stdio: "ignore",
  }).unref();

  return true;
}

function buildSelfUpdateScript(opts: { pid: number; oldExe: string; newExe: string; workDir: string }): string {
  const backupName = `${basename(opts.oldExe)}.bak`;
  // The rename-to-backup step runs exactly once, outside any retry loop. An earlier version
  // retried the whole rename+move pair together and deleted the previous backup at the top of
  // each iteration — after 2+ failed Move-Item attempts (e.g. AV briefly scanning the fresh
  // download) that left BOTH the renamed-away original and its backup gone, deleting the app
  // entirely. Found by actually running this script end-to-end, not by inspection. Now only the
  // Move-Item — the step that can genuinely be transiently locked — gets retried, and the backup
  // is never touched until we know for certain whether the move succeeded.
  return `$pidToWait = ${opts.pid}
$oldExe = "${opts.oldExe}"
$newExe = "${opts.newExe}"
$workDir = "${opts.workDir}"
$backup = Join-Path $workDir "${backupName}"

try { Wait-Process -Id $pidToWait -Timeout 30 -ErrorAction SilentlyContinue } catch {}
Start-Sleep -Milliseconds 500

if (Test-Path $oldExe) {
  if (Test-Path $backup) { Remove-Item $backup -Force -ErrorAction SilentlyContinue }
  Rename-Item -Path $oldExe -NewName (Split-Path $backup -Leaf) -ErrorAction SilentlyContinue
}

$swapped = $false
for ($i = 0; $i -lt 10 -and -not $swapped; $i++) {
  try {
    Move-Item -Path $newExe -Destination $oldExe -Force -ErrorAction Stop
    $swapped = $true
  } catch {
    Start-Sleep -Milliseconds 500
  }
}

if ($swapped) {
  if (Test-Path $backup) { Remove-Item $backup -Force -ErrorAction SilentlyContinue }
} elseif ((Test-Path $backup) -and -not (Test-Path $oldExe)) {
  # Move-Item never succeeded — restore the original rather than leaving the app missing.
  Rename-Item -Path $backup -NewName (Split-Path $oldExe -Leaf) -ErrorAction SilentlyContinue
}

Start-Process -FilePath $oldExe -WorkingDirectory $workDir -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
if (Test-Path $backup) { Remove-Item $backup -Force -ErrorAction SilentlyContinue }
Remove-Item -Path $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`;
}
