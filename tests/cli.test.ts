import { describe, expect, test } from "bun:test";
import { parseArgs } from "@bootstrap/cli";

describe("parseArgs", () => {
  test("defaults to all flags off", () => {
    expect(parseArgs([])).toEqual({
      help: false,
      version: false,
      tray: false,
      fixFirewall: false,
      installService: false,
      uninstallService: false,
    });
  });

  test("recognizes each flag independently", () => {
    expect(parseArgs(["--tray"]).tray).toBe(true);
    expect(parseArgs(["--fix-firewall"]).fixFirewall).toBe(true);
    expect(parseArgs(["--install-service"]).installService).toBe(true);
    expect(parseArgs(["--uninstall-service"]).uninstallService).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  test("combines multiple flags", () => {
    const args = parseArgs(["--tray", "--fix-firewall"]);
    expect(args.tray).toBe(true);
    expect(args.fixFirewall).toBe(true);
    expect(args.installService).toBe(false);
  });
});
