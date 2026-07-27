export type DeviceType = "camera" | "firewall" | "switch" | "router" | "server" | "workstation" | "printer" | "access_point" | "nas" | "iot" | "unknown";

export interface Device {
  id: string;
  tenantId: string;
  name: string;
  ip: string;
  mac: string | null;
  vendor: string | null;
  type: DeviceType;
  location: string | null;
  groupId: string | null;
  responsibleUserId: string | null;
  intervalSec: number;
  enabled: boolean;
  snmpCredsEnc: string | null;
  tags: string[];
  uplinkDeviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EscalationStep {
  /** Fixed target. Mutually exclusive with `onCall` in practice — a step is either "notify this
   * specific person" (userId set) or "notify whoever's on call" (onCall: true); a toggle in the UI
   * rather than two separate flows. Mirrors @domain/entities.ts's EscalationStep. */
  userId?: string;
  onCall?: boolean;
  afterMinutes: number;
}

export interface DeviceGroup {
  id: string;
  tenantId: string;
  name: string;
  escalationChain: EscalationStep[];
  createdAt: string;
  updatedAt: string;
}

/** One on-call rotation per device group (M4) — see src/api/routes/oncall.ts. A group's
 * escalation chain references it via `EscalationStep.onCall: true` steps rather than a fixed
 * userId. */
export interface OnCallSchedule {
  id: string;
  tenantId: string;
  groupId: string;
  /** Rotation order — userIds[0] holds the first shift starting at rotationStartAt, then cycles. */
  userIds: string[];
  shiftLengthHours: number;
  rotationStartAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredDevice {
  ip: string;
  mac: string | null;
  vendor: string | null;
  hostname: string | null;
  rttMs: number | null;
  openPorts: number[];
  snmpSysDescr: string | null;
  snmpSysName: string | null;
  guessedType: DeviceType;
  confidence: number;
}

export interface DiscoveryJob {
  id: string;
  tenantId: string;
  cidr: string;
  status: "running" | "done" | "error";
  scanned: number;
  total: number;
  results: DiscoveredDevice[];
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  camera: "Camera",
  firewall: "Firewall",
  switch: "Switch",
  router: "Router",
  server: "Server",
  workstation: "Workstation / PC",
  printer: "Printer",
  access_point: "Access Point",
  nas: "NAS",
  iot: "IoT",
  unknown: "Unknown",
};
