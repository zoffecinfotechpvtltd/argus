import { join } from "node:path";
import { spawn } from "node:child_process";
import iconAsset from "../../assets/icon.ico" with { type: "file" };

/**
 * `--tray` minimizes Argus to the Windows system tray instead of leaving a console window open.
 *
 * There is no pure-JS, dependency-free way to draw a native tray icon from inside a Bun process —
 * every cross-platform tray npm package either ships prebuilt native .node bindings (breaks the
 * single-self-contained-exe goal and the ABI has to match Bun's own Node-API version) or shells out
 * to a bundled per-OS helper binary anyway. Windows already ships everything needed to draw one
 * for free: PowerShell + .NET's System.Windows.Forms.NotifyIcon. So `--tray` writes a small
 * generated PowerShell script to the data dir and spawns it detached+hidden; it talks back to the
 * running server over a handful of loopback-only, token-guarded `/internal/*` routes (see
 * internalControl.ts) to open the dashboard, toggle pause, and request a clean shutdown.
 *
 * This is a deliberate scope simplification: it's a real, working tray (icon + Open/Pause/Quit
 * menu), just implemented via a spawned PowerShell helper instead of a bundled native module —
 * documented here rather than silently shipped as a stub.
 */
export function startTray(opts: { dataDir: string; port: number; token: string }): void {
  if (process.platform !== "win32") {
    // eslint-disable-next-line no-console
    console.log("--tray is only implemented for Windows (System.Windows.Forms). Ignoring on this platform.");
    return;
  }

  const iconPath = join(opts.dataDir, "tray-icon.ico");
  const scriptPath = join(opts.dataDir, "tray.ps1");

  // Extract the icon that was embedded into the exe (Bun.file transparently reads the embedded
  // blob when compiled, or the real file on disk in `bun run`) out to a real path on disk, since
  // the external PowerShell process can't read Bun's in-process embedded-asset handle directly.
  void Bun.write(iconPath, Bun.file(iconAsset)).then(() => {
    Bun.write(scriptPath, buildTrayScript({ baseUrl: `http://localhost:${opts.port}`, token: opts.token, iconPath })).then(
      () => {
        spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath], {
          detached: true,
          stdio: "ignore",
        }).unref();
      }
    );
  });
}

function buildTrayScript(opts: { baseUrl: string; token: string; iconPath: string }): string {
  return `Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$baseUrl = "${opts.baseUrl}"
$headers = @{ "x-argus-token" = "${opts.token}" }

$icon = New-Object System.Drawing.Icon("${opts.iconPath}")
$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $icon
$notifyIcon.Text = "Argus"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open Dashboard")
$pauseItem = $menu.Items.Add("Pause Monitoring")
$menu.Items.Add("-") | Out-Null
$quitItem = $menu.Items.Add("Quit Argus")
$notifyIcon.ContextMenuStrip = $menu

$openItem.Add_Click({ Start-Process $baseUrl })
$notifyIcon.Add_DoubleClick({ Start-Process $baseUrl })

$pauseItem.Add_Click({
  try {
    $status = Invoke-RestMethod -Uri "$baseUrl/internal/status" -Headers $headers -Method Get -TimeoutSec 3
    if ($status.paused) {
      Invoke-RestMethod -Uri "$baseUrl/internal/resume" -Headers $headers -Method Post -TimeoutSec 3 | Out-Null
    } else {
      Invoke-RestMethod -Uri "$baseUrl/internal/pause" -Headers $headers -Method Post -TimeoutSec 3 | Out-Null
    }
  } catch {}
})

$menu.add_Opening({
  try {
    $status = Invoke-RestMethod -Uri "$baseUrl/internal/status" -Headers $headers -Method Get -TimeoutSec 3
    if ($status.paused) { $pauseItem.Text = "Resume Monitoring" } else { $pauseItem.Text = "Pause Monitoring" }
  } catch {
    $pauseItem.Text = "Pause Monitoring"
  }
})

$quitItem.Add_Click({
  try { Invoke-RestMethod -Uri "$baseUrl/internal/quit" -Headers $headers -Method Post -TimeoutSec 3 | Out-Null } catch {}
  $notifyIcon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

[System.Windows.Forms.Application]::Run()
`;
}
