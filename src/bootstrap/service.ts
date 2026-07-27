import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Windows service registration for Argus.
 *
 * A plain console exe cannot register itself as a Windows service directly — the Service Control
 * Manager requires a process that speaks its control protocol (respond to start/stop/pause
 * requests through the Win32 service API), which a bare `bun build --compile` binary doesn't
 * implement. The standard, well-established fix (used by Jenkins, Elasticsearch, Prometheus
 * node_exporter, and many other "ship one exe" tools on Windows) is a generic service wrapper:
 * WinSW (https://github.com/winsw/winsw, MIT licensed, single self-contained exe, no install).
 *
 * `--install-service` emits a ready-to-use WinSW XML config next to Argus.exe. If a WinSW
 * binary has been placed alongside it (renamed to Argus-service.exe, WinSW's own convention of
 * matching "<name>.exe" + "<name>.xml"), this also drives it to actually install + start the
 * service. If not present, it prints the one-time manual step instead of silently failing —
 * downloading a third-party binary is not something to do automatically without the user's say-so.
 */

const SERVICE_ID = "Argus";
const SERVICE_NAME = "Argus Monitoring";

function winswPaths(exePath: string) {
  const dir = dirname(exePath);
  return {
    dir,
    xmlPath: join(dir, "Argus-service.xml"),
    winswExePath: join(dir, "Argus-service.exe"),
  };
}

function buildWinswXml(exePath: string, dataDir: string): string {
  const escaped = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<service>
  <id>${SERVICE_ID}</id>
  <name>${escaped(SERVICE_NAME)}</name>
  <description>Continuous network device monitoring, alerting, and reporting.</description>
  <executable>${escaped(exePath)}</executable>
  <workingdirectory>${escaped(dirname(exePath))}</workingdirectory>
  <env name="DATA_DIR" value="${escaped(dataDir)}"/>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode>
</service>
`;
}

export function installService(exePath: string, dataDir: string): void {
  const { xmlPath, winswExePath } = winswPaths(exePath);
  writeFileSync(xmlPath, buildWinswXml(exePath, dataDir));
  // eslint-disable-next-line no-console
  console.log(`Wrote service config: ${xmlPath}`);

  if (!existsSync(winswExePath)) {
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "WinSW is not present yet — one-time manual step required (this is a well-known, MIT-licensed",
        "service wrapper; Argus does not bundle it so this exe stays a single self-contained file):",
        "",
        "  1. Download WinSW.exe from https://github.com/winsw/winsw/releases (WinSW-x64.exe)",
        `  2. Rename it to "Argus-service.exe" and place it in:`,
        `       ${dirname(exePath)}`,
        "  3. Run `Argus.exe --install-service` again — it will install and start the service automatically.",
        "",
        `Alternatively, run it yourself once WinSW is in place:  Argus-service.exe install && Argus-service.exe start`,
      ].join("\n")
    );
    return;
  }

  const install = spawnSync(winswExePath, ["install"], { stdio: "inherit" });
  if (install.status !== 0) {
    // eslint-disable-next-line no-console
    console.error("Service install failed — see WinSW output above. You likely need to re-run as Administrator.");
    process.exitCode = 1;
    return;
  }
  const start = spawnSync(winswExePath, ["start"], { stdio: "inherit" });
  if (start.status !== 0) {
    // eslint-disable-next-line no-console
    console.error("Service installed but failed to start — see WinSW output above.");
    process.exitCode = 1;
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`"${SERVICE_NAME}" service installed and started. It will now survive reboots.`);
}

export function uninstallService(exePath: string): void {
  const { winswExePath } = winswPaths(exePath);
  if (!existsSync(winswExePath)) {
    // eslint-disable-next-line no-console
    console.log(
      [
        `Argus-service.exe (WinSW) not found next to the exe — if a service was installed manually via`,
        `sc.exe instead, remove it with:`,
        "",
        `  sc stop ${SERVICE_ID}`,
        `  sc delete ${SERVICE_ID}`,
      ].join("\n")
    );
    return;
  }
  spawnSync(winswExePath, ["stop"], { stdio: "inherit" });
  const uninstall = spawnSync(winswExePath, ["uninstall"], { stdio: "inherit" });
  if (uninstall.status !== 0) {
    // eslint-disable-next-line no-console
    console.error("Service uninstall failed — see WinSW output above. You likely need to re-run as Administrator.");
    process.exitCode = 1;
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`"${SERVICE_NAME}" service uninstalled.`);
}
