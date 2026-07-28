#!/usr/bin/env bun
/**
 * Forces a compiled Windows exe's PE Subsystem field to IMAGE_SUBSYSTEM_WINDOWS_GUI (2).
 *
 * `bun build --compile --windows-hide-console` does NOT actually flip this field (verified by
 * directly parsing the PE header of a freshly compiled exe — it stays IMAGE_SUBSYSTEM_WINDOWS_CUI,
 * 3) — whatever it does instead to suppress the console is a runtime trick (e.g. calling
 * FreeConsole() early), and that kind of trick is exactly what breaks when Windows 11's "Windows
 * Terminal" is set as the default terminal application: Windows Terminal hosts the process's
 * console via ConPTY the instant a console-subsystem process is created, before the process gets a
 * chance to detach, and the tab is then left showing a blank, stuck pane instead of closing. This
 * is the actual root cause of Argus.exe/Argus-Launcher.exe showing a black terminal window on
 * install for some customers even after --windows-hide-console.
 *
 * The only fully reliable fix is what this script does: set IMAGE_SUBSYSTEM_WINDOWS_GUI directly
 * in the PE header, so Windows never allocates or attaches any console for the process in the
 * first place — nothing for Windows Terminal to ever hook into. This does NOT break running the
 * exe's CLI flags (--install-service, --version) from an already-open terminal: a GUI-subsystem
 * exe still inherits and writes to a parent console's stdio handles when one already exists; the
 * subsystem only controls whether Windows auto-allocates a NEW console when none exists.
 *
 * PE layout reference: e_lfanew at offset 0x3C points to the "PE\0\0" signature; the Optional
 * Header starts 24 bytes after that (4-byte signature + 20-byte File Header); Subsystem is a
 * 2-byte field at offset 68 into the Optional Header for both PE32 and PE32+ (bun-windows-x64
 * always produces PE32+, magic 0x20b, but the Subsystem field sits at the same relative offset
 * in both layouts since everything before it that differs — ImageBase — is a fixed-size swap).
 */
import { readFileSync, writeFileSync } from "node:fs";

const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;

function patchToGuiSubsystem(exePath: string): void {
  const buf = readFileSync(exePath);
  const e_lfanew = buf.readUInt32LE(0x3c);
  if (buf[e_lfanew] !== 0x50 || buf[e_lfanew + 1] !== 0x45 || buf[e_lfanew + 2] !== 0 || buf[e_lfanew + 3] !== 0) {
    throw new Error(`${exePath}: not a valid PE file (missing PE signature at e_lfanew)`);
  }
  const optHeaderStart = e_lfanew + 4 + 20;
  const magic = buf.readUInt16LE(optHeaderStart);
  if (magic !== 0x10b && magic !== 0x20b) {
    throw new Error(`${exePath}: unrecognized Optional Header magic 0x${magic.toString(16)}`);
  }
  const subsystemOffset = optHeaderStart + 68;
  const before = buf.readUInt16LE(subsystemOffset);
  buf.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, subsystemOffset);
  writeFileSync(exePath, buf);
  console.log(`Patched ${exePath}: subsystem ${before} -> ${IMAGE_SUBSYSTEM_WINDOWS_GUI} (WINDOWS_GUI)`);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("Usage: bun run scripts/patchPeSubsystem.ts <exe-path> [<exe-path> ...]");
  process.exit(1);
}
for (const t of targets) patchToGuiSubsystem(t);
