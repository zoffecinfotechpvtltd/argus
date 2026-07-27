import { listHosts, parseCidr } from "@domain/cidr";
import { classifyDevice } from "@domain/classify";
import type { DiscoveredDevice } from "@domain/entities";
import { pingHost } from "@adapters/net/ping";
import { readArpTable } from "@adapters/net/arp";
import { fingerprintPorts } from "@adapters/net/tcpProbe";
import { probeSnmp } from "@adapters/net/snmpProbe";
import { lookupVendor } from "@adapters/net/ouiLookup";
import { reverseDnsLookup } from "@adapters/net/reverseDns";
import { runWithConcurrency } from "@adapters/net/pool";
import type { DiscoveryScanOptions, NetworkScanner } from "@ports/services";

/** Scans a CIDR range: ICMP sweep -> ARP/MAC -> OUI vendor -> optional TCP fingerprint -> optional SNMP -> classify. */
export async function runSubnetScan(opts: DiscoveryScanOptions): Promise<DiscoveredDevice[]> {
  parseCidr(opts.cidr); // validates + enforces the /22 cap; throws InvalidCidrError otherwise
  const hosts = listHosts(opts.cidr);
  const concurrency = opts.concurrency ?? 50;

  const found: DiscoveredDevice[] = [];
  let scanned = 0;

  await runWithConcurrency(hosts, concurrency, async (ip) => {
    // 2 echoes per host, not 1: a scan sends up to `concurrency` (default 50) simultaneous ICMP
    // probes, and a single dropped/delayed packet (ARP resolution eating into the timeout, a
    // sleeping device waking slowly, brief switch congestion) used to permanently exclude that
    // host for the whole pass — the reported "have to scan 2-3 times to find everything" bug.
    // ok=true if EITHER echo gets a reply (pingHost.ok is false only when zero replies came back),
    // so this trades a slightly longer worst-case per-dead-host time for far fewer false negatives.
    const ping = await pingHost(ip, 2, 900).catch(() => ({ ok: false, lossPct: 100 }) as const);
    scanned++;

    if (!ping.ok) {
      opts.onProgress?.({ scanned, total: hosts.length, found });
      return;
    }

    const [openPorts, hostname] = await Promise.all([
      fingerprintPorts(ip).catch(() => [] as number[]),
      reverseDnsLookup(ip),
    ]);

    let snmpResult = { sysDescr: null as string | null, sysName: null as string | null, sysObjectId: null as string | null };
    if (opts.snmpCommunity && openPorts.includes(161)) {
      snmpResult = await probeSnmp(ip, opts.snmpCommunity).catch(() => snmpResult);
    }

    const device: DiscoveredDevice = {
      ip,
      mac: null, // filled in after ARP table read below
      vendor: null,
      hostname,
      rttMs: ping.ok ? (ping.latencyMs ?? null) : null,
      openPorts,
      snmpSysDescr: snmpResult.sysDescr,
      snmpSysName: snmpResult.sysName,
      guessedType: "unknown",
      confidence: 0,
    };
    found.push(device);
    opts.onProgress?.({ scanned, total: hosts.length, found });
  });

  // ARP table is read once after the sweep so replies have had time to populate it.
  const arpTable = await readArpTable();
  for (const device of found) {
    const mac = arpTable.get(device.ip) ?? null;
    device.mac = mac;
    device.vendor = lookupVendor(mac);
    const { type, confidence } = classifyDevice({
      openPorts: device.openPorts,
      ouiVendor: device.vendor,
      snmpSysDescr: device.snmpSysDescr,
      hostname: device.hostname,
    });
    device.guessedType = type;
    device.confidence = confidence;
  }
  opts.onProgress?.({ scanned, total: hosts.length, found });

  return found;
}

export class SubnetScanner implements NetworkScanner {
  scan(opts: DiscoveryScanOptions): Promise<DiscoveredDevice[]> {
    return runSubnetScan(opts);
  }
}
