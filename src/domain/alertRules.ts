// Pure — no I/O. Maps a monitoring-engine DomainEvent to the alert shape the alert engine should
// open/update. Dedup key design: one open alert per (device, conditionKey).
import type { AlertSeverity } from "@domain/entities";
import type { DomainEvent } from "@domain/events";

export function conditionKeyForEvent(event: DomainEvent): string {
  switch (event.type) {
    case "DeviceWentDown":
      return "down";
    case "DeviceDegraded":
      return "degraded";
    case "DeviceFlapping":
      return "flapping";
    case "ThresholdBreached":
      return `threshold:${event.metric}`;
    case "DeviceRecovered":
      return "recovery";
  }
}

export function severityForEvent(event: DomainEvent): AlertSeverity {
  switch (event.type) {
    case "DeviceWentDown":
      return "critical";
    case "DeviceDegraded":
    case "DeviceFlapping":
    case "ThresholdBreached":
      return "warning";
    case "DeviceRecovered":
      return "info";
  }
}

export function titleForEvent(event: DomainEvent, deviceName: string): string {
  switch (event.type) {
    case "DeviceWentDown":
      return `${deviceName} is DOWN`;
    case "DeviceDegraded":
      return `${deviceName} is DEGRADED`;
    case "DeviceFlapping":
      return `${deviceName} is FLAPPING`;
    case "ThresholdBreached":
      return `${deviceName}: ${event.metric} exceeded ${event.limit} (${event.value})`;
    case "DeviceRecovered":
      return `${deviceName} has recovered`;
  }
}
