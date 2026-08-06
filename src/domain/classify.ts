// Pure device classifier — no I/O. (openPorts, ouiVendor, snmpSysDescr, hostname) -> device type + confidence.
import type { DeviceType } from "@domain/entities";

export interface ClassifyInput {
  openPorts: number[];
  ouiVendor?: string | null;
  snmpSysDescr?: string | null;
  /** Reverse-DNS / DHCP-advertised hostname, e.g. "Johns-iPhone", "DESKTOP-A1B2C3", "hikvision-cam-01". */
  hostname?: string | null;
}

export interface ClassifyResult {
  type: DeviceType;
  confidence: number; // 0..1
}

const PORT = {
  SSH: 22,
  TELNET: 23,
  HTTP: 80,
  HTTPS: 443,
  SNMP: 161,
  RTSP: 554,
  SMB: 445,
  RDP: 3389,
  JETDIRECT: 9100,
  HTTP_ALT: 8080,
  VNC: 5900,
};

/** Vendor name fragments (from OUI lookup) mapped to a weak category hint used when port/SNMP signals are ambiguous. */
const VENDOR_HINTS: Array<{ pattern: RegExp; type: DeviceType }> = [
  { pattern: /hikvision|dahua|axis communications|reolink|foscam/i, type: "camera" },
  { pattern: /fortinet|sophos|palo alto|watchguard|sonicwall|pfsense|check point/i, type: "firewall" },
  { pattern: /cisco|juniper|arista|mikrotik|netgear|d-link|tp-link|huawei/i, type: "switch" },
  { pattern: /ubiquiti|aruba|ruckus|meraki/i, type: "access_point" },
  { pattern: /hewlett packard|hp inc|brother|epson|lexmark|xerox|canon/i, type: "printer" },
  { pattern: /synology|qnap|western digital|buffalo/i, type: "nas" },
  { pattern: /espressif|shelly|tuya|sonoff|raspberry pi/i, type: "iot" },
  { pattern: /supermicro|vmware/i, type: "server" },
  // Vendors whose OUI almost always shows up as an end-user laptop/desktop, not
  // server-room hardware — previously "apple"/"dell" here fed the server hint above and
  // mislabeled ordinary PCs/MacBooks as servers.
  { pattern: /apple|dell|lenovo|asustek|intel corporate|microsoft|micro-star/i, type: "workstation" },
];

function vendorHint(vendor?: string | null): DeviceType | null {
  if (!vendor) return null;
  for (const { pattern, type } of VENDOR_HINTS) {
    if (pattern.test(vendor)) return type;
  }
  return null;
}

/** Naming-convention fragments in a self-advertised hostname — the same trick classic "IP scanner"
 * tools use: a hostname like "Johns-iPhone" or "hikvision-cam-01" is a deliberate signal, usually
 * more specific than OUI vendor alone (a vendor can make many device categories; a hostname rarely
 * lies about what it names). Checked in order — first match wins. */
const HOSTNAME_HINTS: Array<{ pattern: RegExp; type: DeviceType }> = [
  { pattern: /\b(cam|camera|nvr|dvr|ipcam)\b|hikvision|dahua/i, type: "camera" },
  { pattern: /printer|laserjet|officejet|deskjet|inkjet/i, type: "printer" },
  { pattern: /\bnas\b|synology|diskstation|qnap/i, type: "nas" },
  { pattern: /^(gw|gateway|router|modem)[-_]?/i, type: "router" },
  { pattern: /^sw(itch)?[-_]/i, type: "switch" },
  { pattern: /access-?point|^ap[-_]|unifi/i, type: "access_point" },
  { pattern: /firewall|forti(gate|wifi|adc)|sophos|sfos|pfsense|sonicwall/i, type: "firewall" },
  {
    pattern: /iphone|ipad|macbook|imac|android|galaxy-|pixel-|desktop|laptop|-pc$|workstation/i,
    type: "workstation",
  },
  { pattern: /esp32|esp8266|shelly|sonoff|tasmota|smartplug|^echo-|firetv|chromecast|roku/i, type: "iot" },
  { pattern: /^srv[-_]|^server[-_]|esxi|proxmox/i, type: "server" },
];

function hostnameHint(hostname?: string | null): DeviceType | null {
  if (!hostname) return null;
  for (const { pattern, type } of HOSTNAME_HINTS) {
    if (pattern.test(hostname)) return type;
  }
  return null;
}

export function classifyDevice(input: ClassifyInput): ClassifyResult {
  const ports = new Set(input.openPorts);
  const desc = (input.snmpSysDescr ?? "").toLowerCase();
  const vendor = input.ouiVendor ?? null;
  const hint = vendorHint(vendor);
  const hostHint = hostnameHint(input.hostname);

  // Strong signals first — specific ports / SNMP text beat vendor guesses.
  if (ports.has(PORT.RTSP)) {
    return { type: "camera", confidence: hint === "camera" ? 0.95 : 0.85 };
  }
  if (/hikvision|dahua|camera|ipcam/.test(desc)) {
    return { type: "camera", confidence: 0.9 };
  }

  if (ports.has(PORT.JETDIRECT) || /jetdirect|laserjet|printer/.test(desc)) {
    return { type: "printer", confidence: hint === "printer" ? 0.95 : 0.85 };
  }

  // Broadened from the original fortigate/fortios/"sophos xg"-only match, which missed real-world
  // sysDescr strings from Fortinet's non-FortiGate line (FortiWiFi/FortiADC branch appliances) and
  // from Sophos units that self-report as bare "SFOS ..." with neither "sophos" nor "firewall" in
  // the string. "sophos" and "sfos" alone are safe signals here — Sophos's other SNMP-exposing
  // products (endpoint agents) don't run an SNMP daemon to be probed in the first place.
  if (/firewall|forti(gate|wifi|adc)|sophos|sfos|pfsense|utm/.test(desc)) {
    return { type: "firewall", confidence: 0.9 };
  }
  if (hint === "firewall" && (ports.has(PORT.HTTPS) || ports.has(PORT.SSH))) {
    return { type: "firewall", confidence: 0.7 };
  }

  if (/ios software|ios-xe|switch,|catalyst/.test(desc)) {
    return { type: "switch", confidence: 0.9 };
  }
  if (/router|routeros/.test(desc)) {
    return { type: "router", confidence: 0.9 };
  }

  if (/access point|unifi ap|wireless ap/.test(desc)) {
    return { type: "access_point", confidence: 0.9 };
  }
  if (hint === "access_point" && ports.has(PORT.HTTP)) {
    return { type: "access_point", confidence: 0.65 };
  }

  if (/synology|qnap|diskstation|nas os/.test(desc)) {
    return { type: "nas", confidence: 0.9 };
  }
  if (hint === "nas") {
    return { type: "nas", confidence: 0.7 };
  }

  // A deliberately-named hostname ("hikvision-cam-01", "Johns-iPhone") beats the weaker
  // RDP-port and vendor-only heuristics below, but still yields to the protocol-verified
  // signals above (RTSP, JetDirect, SNMP sysDescr text).
  if (hostHint) {
    return { type: hostHint, confidence: 0.8 };
  }

  if (ports.has(PORT.RDP)) {
    return { type: "server", confidence: 0.75 };
  }
  if (/windows server|linux|ubuntu server|esxi|vmware/.test(desc)) {
    return { type: "server", confidence: 0.85 };
  }

  if (ports.has(PORT.SNMP) && (ports.has(PORT.SSH) || ports.has(PORT.TELNET)) && hint === "switch") {
    return { type: "switch", confidence: 0.6 };
  }

  if (hint === "iot") {
    return { type: "iot", confidence: 0.6 };
  }

  if (hint) {
    return { type: hint, confidence: 0.5 };
  }

  // No vendor hint, but Windows file-sharing (SMB) or screen-sharing (VNC) is open with none of
  // the server/network-gear signals above — the common signature of an ordinary desktop/laptop.
  if (ports.has(PORT.SMB) || ports.has(PORT.VNC)) {
    return { type: "workstation", confidence: 0.4 };
  }

  if (ports.has(PORT.HTTP) || ports.has(PORT.HTTPS) || ports.has(PORT.HTTP_ALT)) {
    return { type: "unknown", confidence: 0.2 };
  }

  return { type: "unknown", confidence: 0 };
}
