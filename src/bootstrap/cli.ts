export interface CliArgs {
  help: boolean;
  version: boolean;
  tray: boolean;
  fixFirewall: boolean;
  installService: boolean;
  uninstallService: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const set = new Set(argv);
  return {
    help: set.has("--help") || set.has("-h"),
    version: set.has("--version") || set.has("-v"),
    tray: set.has("--tray"),
    fixFirewall: set.has("--fix-firewall"),
    installService: set.has("--install-service"),
    uninstallService: set.has("--uninstall-service"),
  };
}

export function printHelp(version: string): void {
  console.log(`Argus ${version} — network monitoring, single-exe edition

Usage: Argus.exe [options]

Options:
  --tray                Minimize to the Windows system tray instead of a console window
  --install-service     Register Argus as a Windows service (survives reboots)
  --uninstall-service   Remove the Windows service registered by --install-service
  --fix-firewall        Print (not run) the netsh commands to open the firewall for this port
  --version, -v         Print the version and exit
  --help, -h            Show this help and exit

Config is read from ./config.json (created on first run) or environment variables
(PORT, DATA_DIR, MODE, LOG_LEVEL, INSTANCE_NAME, DB_DRIVER, POSTGRES_URL).

On launch, Argus creates ./data next to the exe, starts the web server, and opens your
default browser to it automatically. Running a second copy just reopens the browser to the
already-running instance instead of starting a new server.
`);
}
