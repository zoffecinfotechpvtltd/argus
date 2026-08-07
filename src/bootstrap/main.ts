import { randomBytes } from "node:crypto";
import { loadConfig } from "@bootstrap/config";
import { buildContainer } from "@bootstrap/container";
import { buildServer } from "@api/server";
import { Scheduler } from "@application/scheduler";
import { RetentionScheduler } from "@application/retentionJob";
import { DigestScheduler } from "@application/digestScheduler";
import { HeartbeatScheduler } from "@application/heartbeatScheduler";
import { ReclassificationScheduler } from "@application/reclassification";
import { DiscoveryScheduleRunner } from "@application/discoveryScheduleRunner";
import { BackupScheduler } from "@application/backupScheduler";
import { AlertEngine } from "@application/alertEngine";
import { EscalationWorker } from "@application/escalation";
import { parseArgs, printHelp } from "@bootstrap/cli";
import { acquireLock, findRunningInstance, releaseLock } from "@bootstrap/singleInstance";
import { openBrowser } from "@bootstrap/browser";
import { printFirewallHelp } from "@bootstrap/firewall";
import { installService, uninstallService } from "@bootstrap/service";
import { startTray } from "@bootstrap/tray";
import { internalControlRoutes } from "@bootstrap/internalControl";
import { VERSION } from "@bootstrap/version";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp(VERSION);
  process.exit(0);
}
if (args.version) {
  // eslint-disable-next-line no-console
  console.log(`Argus ${VERSION}`);
  process.exit(0);
}

const config = loadConfig(process.env.CONFIG_PATH ?? "./config.json");

if (args.fixFirewall) {
  printFirewallHelp(config.port);
  process.exit(0);
}
if (args.installService) {
  installService(process.execPath, config.dataDir);
  process.exit(0);
}
if (args.uninstallService) {
  uninstallService(process.execPath);
  process.exit(0);
}

const runningInstance = findRunningInstance(config.dataDir);
if (runningInstance) {
  // eslint-disable-next-line no-console
  console.log(`Argus is already running at http://localhost:${runningInstance.port} — opening browser.`);
  openBrowser(`http://localhost:${runningInstance.port}`);
  process.exit(0);
}

const app = await buildContainer(config);

const hono = buildServer(app);

// Argus always binds config.port (default 58070) and only that port — no silent drift to the next
// free one. A fixed, predictable address is what makes the desktop shortcut, firewall rule, and
// "http://localhost:58070" muscle memory keep working across restarts. If something else already
// holds it, that's surfaced as a clear, actionable error instead of quietly spawning a second
// instance on a different port (which is how this used to accumulate zombie processes).
const port = config.port;
let server: ReturnType<typeof Bun.serve> | undefined;
try {
  // idleTimeout raised from Bun's 10s default: M2's SSE stream (GET /api/events/stream) sends a
  // keepalive every 20s when idle, which Bun's default would kill before the first one ever
  // fires. 255 is Bun's own hard maximum (uint8 seconds) — not "disabled," just long enough that
  // the keepalive cadence never gets close to it.
  server = Bun.serve({ port, fetch: hono.fetch, idleTimeout: 255 });
} catch (err) {
  if ((err as { code?: string }).code === "EADDRINUSE") {
    app.logger.error("port_in_use", { port });
    // eslint-disable-next-line no-console
    console.error(
      `Port ${port} is already in use by another process (not another Argus instance — that case is handled above by findRunningInstance).\n` +
        `Stop whatever's using it, or set a different port via the PORT environment variable or "port" in config.json.`
    );
    process.exit(1);
  }
  throw err;
}

acquireLock(config.dataDir, port);

const scheduler = new Scheduler(app);
const retention = new RetentionScheduler(app);
const alertEngine = new AlertEngine(app);
const escalation = new EscalationWorker(app);
const digest = new DigestScheduler(app);
const heartbeat = new HeartbeatScheduler(app);
const reclassification = new ReclassificationScheduler(app);
const discoverySchedules = new DiscoveryScheduleRunner(app);
const backupScheduler = new BackupScheduler(app);

// M1: saas mode delegates device polling entirely to standalone pollerMain.ts processes (run
// `bun run src/bootstrap/pollerMain.ts` — see docker-compose.yml) instead of this in-process
// Scheduler, so N poller processes can shard a device fleet via Redis leases. Exe mode is
// unaffected — it's a single process by design, so it keeps polling itself, unchanged.
// Known gap (not silently glossed over): AlertEngine below still listens for monitoring events on
// this process's in-memory EventBus, which a separate pollerMain.ts process's events never reach —
// alerts won't fire from sharded-poller state changes yet. M2 replaces the in-process EventBus with
// a Redis-pub/sub-backed one for SSE fan-out; wiring the scheduler's and alert engine's events
// through that same bus closes this gap as a side effect, not a separate fix.
if (config.mode !== "saas") {
  await scheduler.start();
  app.engineHeartbeat = { lastTickAt: () => scheduler.getLastTickAt() };
} else {
  app.logger.info("scheduler_delegated_to_poller_processes");
}
retention.start();
alertEngine.start();
escalation.start();
digest.start();
heartbeat.start();
reclassification.start();
discoverySchedules.start();
backupScheduler.start();
app.shutdownRequester = { requestShutdown: (reason) => shutdown(reason) };

if (args.tray) {
  const trayToken = randomBytes(24).toString("hex");
  hono.route("/", internalControlRoutes({ scheduler, token: trayToken, onQuit: () => shutdown("tray-quit") }));
  startTray({ dataDir: config.dataDir, port, token: trayToken });
}

const url = `http://localhost:${port}`;
const banner = `
Argus ${VERSION} (${config.mode} mode)
Listening on ${url}
${args.tray ? "Running in system tray — right-click the Argus icon near the clock for Open/Pause/Quit." : "Ctrl+C to stop"}
Discovery or ping not working across the network? Run 'Argus.exe --fix-firewall' for the exact commands.
`;
// eslint-disable-next-line no-console
console.log(banner);
app.logger.info("server_started", { port, mode: config.mode, tray: args.tray });

// ARGUS_NO_OPEN_BROWSER is for local dev loops that restart the server often (bun --watch);
// it never affects the packaged exe since nothing sets this env var there.
if (!args.tray && !process.env.ARGUS_NO_OPEN_BROWSER) openBrowser(url);

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.logger.info("shutting_down", { signal });
  releaseLock(config.dataDir);
  retention.stop();
  escalation.stop();
  alertEngine.stop();
  digest.stop();
  discoverySchedules.stop();
  backupScheduler.stop();
  reclassification.stop();
  server?.stop();
  scheduler
    .stop()
    .catch((err) => app.logger.error("scheduler_stop_failed", { error: (err as Error).message }))
    .finally(() => process.exit(0));
}
