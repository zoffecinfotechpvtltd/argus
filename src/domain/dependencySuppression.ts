import type { DeviceState } from "@domain/entities";

/**
 * True if notification for a device's new alert should be withheld because its configured uplink
 * (`Device.uplinkDeviceId`) is itself currently down — the uplink outage is very likely the actual
 * root cause, so paging on every device behind it is noise on top of the one real incident. This
 * only ever suppresses *notification*; the alert row itself still opens and is visible on the
 * Alerts page — nothing is hidden from an operator looking directly at it, only who gets paged.
 */
export function shouldSuppressForUplink(uplinkState: DeviceState | null): boolean {
  return uplinkState === "down";
}
