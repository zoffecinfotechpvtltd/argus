import pkg from "../../package.json";

// Reading package.json directly (rather than process.env.npm_package_version) matters here: that
// env var is only ever set by `bun run`/`npm run` — the compiled exe is launched directly by
// double-clicking or by the Windows service manager, neither of which sets it, so relying on it
// would make every compiled build silently report "0.1.0" regardless of the real version.
export const VERSION: string = pkg.version;
