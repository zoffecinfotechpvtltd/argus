// Pure event types emitted by the state machine. The alert engine (Phase 04) consumes these;
// the monitoring engine itself never sends notifications.

export interface DeviceWentDownEvent {
  type: "DeviceWentDown";
  deviceId: string;
  tenantId: string;
  at: string;
}

export interface DeviceRecoveredEvent {
  type: "DeviceRecovered";
  deviceId: string;
  tenantId: string;
  at: string;
}

export interface DeviceDegradedEvent {
  type: "DeviceDegraded";
  deviceId: string;
  tenantId: string;
  at: string;
}

export interface DeviceFlappingEvent {
  type: "DeviceFlapping";
  deviceId: string;
  tenantId: string;
  at: string;
}

export interface ThresholdBreachedEvent {
  type: "ThresholdBreached";
  deviceId: string;
  tenantId: string;
  at: string;
  metric: string;
  value: number;
  limit: number;
}

export type DomainEvent =
  | DeviceWentDownEvent
  | DeviceRecoveredEvent
  | DeviceDegradedEvent
  | DeviceFlappingEvent
  | ThresholdBreachedEvent;
