import type { Device, DeviceGroup } from "../api/types";

const CSV_HEADER = ["Name", "IP", "Type", "Group", "Location", "Tags", "Interval (s)", "Enabled"];

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Tags are semicolon-joined within one CSV cell (not comma-joined) so a tag list never collides
 * with the CSV column separator and never needs quoting on its own account. */
export function devicesToCsv(devices: Device[], groups: DeviceGroup[]): string {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const lines = devices.map((d) =>
    [
      d.name,
      d.ip,
      d.type,
      d.groupId ? (groupName.get(d.groupId) ?? "") : "",
      d.location ?? "",
      d.tags.join(";"),
      String(d.intervalSec),
      d.enabled ? "true" : "false",
    ]
      .map(csvEscape)
      .join(",")
  );
  return [CSV_HEADER.join(","), ...lines].join("\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Minimal RFC-4180-ish CSV line splitter — handles quoted fields containing commas/quotes/
 * newlines, which is all a device import needs (name/tags are the only fields that could
 * plausibly contain a comma). Not a general CSV library; this product doesn't need one elsewhere. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface ImportDeviceRow {
  name: string;
  ip: string;
  type?: string;
  groupId?: string | null;
  location?: string | null;
  tags?: string[];
  intervalSec?: number;
}

/** Column matching is header-name based (case-insensitive), not positional, so a spreadsheet
 * exported with columns in any order still imports correctly as long as "Name" and "IP" exist. */
export function parseDeviceCsv(text: string, groups: DeviceGroup[]): ImportDeviceRow[] {
  const rows = parseCsvRows(text.trim());
  if (rows.length === 0) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const nameIdx = header.indexOf("name");
  const ipIdx = header.indexOf("ip");
  if (nameIdx === -1 || ipIdx === -1) throw new Error("CSV must have Name and IP columns");
  const typeIdx = header.indexOf("type");
  const groupIdx = header.indexOf("group");
  const locationIdx = header.indexOf("location");
  const tagsIdx = header.indexOf("tags");
  const intervalIdx = header.findIndex((h) => h.startsWith("interval"));
  const groupByName = new Map(groups.map((g) => [g.name.toLowerCase(), g.id]));

  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim().length > 0))
    .map((r) => ({
      name: r[nameIdx]?.trim() ?? "",
      ip: r[ipIdx]?.trim() ?? "",
      type: typeIdx >= 0 ? r[typeIdx]?.trim() || undefined : undefined,
      groupId: groupIdx >= 0 && r[groupIdx]?.trim() ? (groupByName.get(r[groupIdx]!.trim().toLowerCase()) ?? null) : null,
      location: locationIdx >= 0 ? r[locationIdx]?.trim() || null : null,
      tags: tagsIdx >= 0 && r[tagsIdx] ? r[tagsIdx]!.split(";").map((t) => t.trim()).filter(Boolean) : [],
      intervalSec: intervalIdx >= 0 && r[intervalIdx] ? Number(r[intervalIdx]) || undefined : undefined,
    }))
    .filter((r) => r.name && r.ip);
}
