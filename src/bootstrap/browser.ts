import { spawn } from "node:child_process";

/** Opens the user's default browser to `url`. Best-effort — a failure here should never crash startup. */
export function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      // `start` is a cmd.exe builtin, not an executable — must go through cmd /c. The empty "" is
      // the (required) window-title argument `start` expects before the target when it's quoted.
      spawn("cmd", ["/c", "start", '""', url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // no GUI / headless environment — the console banner already prints the URL
  }
}
