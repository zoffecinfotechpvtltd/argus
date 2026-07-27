// Single source of truth for the two semantic color axes this app actually has — device health
// state (5 values) and alert severity (3 values) — deliberately kept separate from each other and
// from `accent` (the brand/CTA color), per steps/00-README-BUILD-ORDER.md's ground rule that
// status colors are semantic and never repurposed as brand decoration. Anything needing a raw hex
// (Recharts fills, inline styles) or a Tailwind class string reads from here now; api/alertTypes.ts
// and components/StatusDot.tsx re-export these under their original names so existing imports
// keep working unchanged.

export type DeviceState = "up" | "degraded" | "down" | "flapping" | "maintenance";

export const DEVICE_STATE_HEX: Record<DeviceState, string> = {
  up: "#16A34A",
  degraded: "#D97706",
  down: "#DC2626",
  flapping: "#EA580C",
  maintenance: "#7C3AED",
};

export const DEVICE_STATE_FALLBACK_HEX = "#A1A1AA"; // Unknown

export type AlertSeverity = "info" | "warning" | "critical";

export const SEVERITY_HEX: Record<AlertSeverity, string> = {
  critical: "#DC2626",
  warning: "#D97706",
  info: "#2563EB",
};

export const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  critical: "text-critical bg-critical-subtle border-critical/20",
  warning: "text-warning bg-warning-subtle border-warning/20",
  info: "text-info bg-info-subtle border-info/20",
};

/** Fixed-order categorical palette for charts with no inherent status meaning (device type mix,
 * devices-per-group) — deliberately distinct hues from DEVICE_STATE_HEX/SEVERITY_HEX above, so a
 * chart series never accidentally reads as "this group is down" or "this type is critical".
 * Order matters: it's chosen (dark-surface-validated) to maximize adjacent-color distinguishability
 * for colorblind viewers, so always index into this array in order — never reassign per re-sort. */
export const CATEGORICAL_PALETTE = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#22a022", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
];
