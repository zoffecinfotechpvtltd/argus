import { describe, expect, it } from "bun:test";
import { classifyDevice } from "@domain/classify";

describe("classifyDevice", () => {
  it("classifies a Hikvision camera via RTSP port + vendor", () => {
    const r = classifyDevice({ openPorts: [80, 554], ouiVendor: "Hikvision Digital Technology" });
    expect(r.type).toBe("camera");
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("classifies a Dahua camera via SNMP sysDescr", () => {
    const r = classifyDevice({ openPorts: [80], ouiVendor: null, snmpSysDescr: "Dahua IPC-HDW camera firmware" });
    expect(r.type).toBe("camera");
  });

  it("classifies a Fortinet firewall via sysDescr", () => {
    const r = classifyDevice({ openPorts: [443, 22], ouiVendor: "Fortinet, Inc.", snmpSysDescr: "FortiGate-60F FortiOS 7.0" });
    expect(r.type).toBe("firewall");
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("classifies a Sophos firewall via vendor + ports even without sysDescr", () => {
    const r = classifyDevice({ openPorts: [443], ouiVendor: "Sophos Ltd" });
    expect(r.type).toBe("firewall");
  });

  it("classifies a Cisco Catalyst switch via sysDescr", () => {
    const r = classifyDevice({ openPorts: [22, 161], ouiVendor: "Cisco Systems, Inc", snmpSysDescr: "Cisco IOS Software, Catalyst L3 Switch" });
    expect(r.type).toBe("switch");
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("classifies a Mikrotik router via sysDescr", () => {
    const r = classifyDevice({ openPorts: [22, 80], ouiVendor: "Mikrotik", snmpSysDescr: "RouterOS RB2011" });
    expect(r.type).toBe("router");
  });

  it("classifies an HP LaserJet printer via port 9100", () => {
    const r = classifyDevice({ openPorts: [80, 9100], ouiVendor: "Hewlett Packard" });
    expect(r.type).toBe("printer");
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("classifies a Brother printer via sysDescr keyword", () => {
    const r = classifyDevice({ openPorts: [80], ouiVendor: "Brother Industries", snmpSysDescr: "Brother NC-8000h, Printer" });
    expect(r.type).toBe("printer");
  });

  it("classifies a Ubiquiti access point via vendor + sysDescr", () => {
    const r = classifyDevice({ openPorts: [80, 443], ouiVendor: "Ubiquiti Networks Inc.", snmpSysDescr: "UniFi AP-AC-Pro access point" });
    expect(r.type).toBe("access_point");
  });

  it("classifies a Synology NAS via sysDescr", () => {
    const r = classifyDevice({ openPorts: [80, 443, 5000], ouiVendor: "Synology Incorporated", snmpSysDescr: "Synology DiskStation DSM 7.0" });
    expect(r.type).toBe("nas");
  });

  it("classifies a Windows server via RDP port", () => {
    const r = classifyDevice({ openPorts: [3389, 445], ouiVendor: "Dell Inc." });
    expect(r.type).toBe("server");
  });

  it("classifies a MacBook via vendor OUI, not as a server", () => {
    const r = classifyDevice({ openPorts: [], ouiVendor: "Apple, Inc." });
    expect(r.type).toBe("workstation");
  });

  it("classifies a Windows PC via SMB port when vendor is unrecognized", () => {
    const r = classifyDevice({ openPorts: [445], ouiVendor: null });
    expect(r.type).toBe("workstation");
  });

  it("classifies an ESP-based IoT device via vendor with minimal footprint", () => {
    const r = classifyDevice({ openPorts: [80], ouiVendor: "Espressif Inc." });
    expect(r.type).toBe("iot");
  });

  it("classifies via a DHCP-advertised hostname when there's no other signal", () => {
    const r = classifyDevice({ openPorts: [80], ouiVendor: null, hostname: "Johns-iPhone" });
    expect(r.type).toBe("workstation");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("prefers a specific hostname over a generic RDP-port heuristic", () => {
    const r = classifyDevice({ openPorts: [3389], ouiVendor: null, hostname: "reception-desktop" });
    expect(r.type).toBe("workstation");
  });

  it("classifies a camera by hostname even without RTSP open", () => {
    const r = classifyDevice({ openPorts: [80], ouiVendor: null, hostname: "hikvision-cam-01" });
    expect(r.type).toBe("camera");
  });

  it("still prefers a protocol-verified RTSP camera over a conflicting hostname", () => {
    const r = classifyDevice({ openPorts: [554], ouiVendor: null, hostname: "office-printer" });
    expect(r.type).toBe("camera");
  });

  it("falls back to unknown with zero confidence when there are no signals at all", () => {
    const r = classifyDevice({ openPorts: [], ouiVendor: null, snmpSysDescr: null });
    expect(r.type).toBe("unknown");
    expect(r.confidence).toBe(0);
  });

  it("falls back to low-confidence unknown for a bare open web port with unrecognized vendor", () => {
    const r = classifyDevice({ openPorts: [80], ouiVendor: "Some Random Vendor LLC" });
    expect(r.type).toBe("unknown");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("never throws on garbage input", () => {
    expect(() => classifyDevice({ openPorts: [65535, -1, 0], ouiVendor: "", snmpSysDescr: "" })).not.toThrow();
  });
});
