import type snmp from "net-snmp";
import { counterDeltaPerSecond } from "@domain/snmpMath";
import type { SnmpCredential } from "@domain/snmpCredential";
import { createSnmpSession } from "@adapters/net/snmpSession";

const OID_SYS_UPTIME = "1.3.6.1.2.1.1.3.0";
const OID_HR_PROCESSOR_LOAD_1 = "1.3.6.1.2.1.25.3.3.1.2.1";
const OID_HR_STORAGE_DESCR = "1.3.6.1.2.1.25.2.3.1.3";
const OID_HR_STORAGE_ALLOC_UNITS = "1.3.6.1.2.1.25.2.3.1.4";
const OID_HR_STORAGE_SIZE = "1.3.6.1.2.1.25.2.3.1.5";
const OID_HR_STORAGE_USED = "1.3.6.1.2.1.25.2.3.1.6";
const HR_STORAGE_PROBE_INDICES = [1, 2, 3, 4, 5, 6, 7, 8];

function ifOperStatusOid(ifIndex: number) {
  return `1.3.6.1.2.1.2.2.1.8.${ifIndex}`;
}
function ifInOctetsOid(ifIndex: number) {
  return `1.3.6.1.2.1.2.2.1.10.${ifIndex}`;
}
function ifOutOctetsOid(ifIndex: number) {
  return `1.3.6.1.2.1.2.2.1.16.${ifIndex}`;
}

// IF-MIB's ifTable (1.3.6.1.2.1.2.2.1) — column 2 is ifDescr, column 8 is ifOperStatus. Same MIB
// virtually every SNMP-capable device on earth implements (it's part of MIB-II, RFC 1213, one of
// the oldest and most universally-supported SNMP standards there is), unlike the vendor-specific
// guesswork the FortiGate/Sophos REST/XML adapters have to do.
const OID_IF_TABLE = "1.3.6.1.2.1.2.2.1";
const IF_DESCR_COLUMN = "2";
const IF_OPER_STATUS_COLUMN = "8";

export interface DiscoveredInterface {
  ifIndex: number;
  ifDescr: string;
  /** true if ifOperStatus reported 1 (up) at discovery time — a snapshot, not live state; the
   * picker in the UI uses it only to sort "likely worth watching" interfaces first. */
  up: boolean;
}

function snmpTable(session: ReturnType<typeof snmp.createSession>, oid: string): Promise<Record<string, Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    session.table(oid, 20, (err, table) => {
      if (err) reject(err);
      else resolve(table);
    });
  });
}

/** Walks ifTable and returns every interface the device reports, for the Bandwidth page's
 * "Discover interfaces" picker — this is the alternative to making someone snmpwalk the device by
 * hand and type ifIndex numbers into a text field. */
export async function discoverSnmpInterfaces(ip: string, credential: SnmpCredential, timeoutMs = 5000): Promise<DiscoveredInterface[]> {
  const session = createSnmpSession(ip, credential, timeoutMs);
  try {
    const table = await snmpTable(session, OID_IF_TABLE);
    const results: DiscoveredInterface[] = [];
    for (const [rowIndex, row] of Object.entries(table)) {
      const ifIndex = Number(rowIndex);
      if (!Number.isFinite(ifIndex)) continue;
      const ifDescr = toStr(row[IF_DESCR_COLUMN]) || `if${ifIndex}`;
      const operStatus = toNumber(row[IF_OPER_STATUS_COLUMN]);
      results.push({ ifIndex, ifDescr, up: operStatus === 1 });
    }
    results.sort((a, b) => a.ifIndex - b.ifIndex);
    return results;
  } finally {
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }
}

export interface SnmpPollInput {
  ip: string;
  credential: SnmpCredential;
  interfaces?: number[];
  timeoutMs?: number;
}

export interface SnmpPollResult {
  ok: boolean;
  values: Record<string, number>;
  error?: string;
}

// Counter cache for bandwidth delta math — keyed by "ip:oid", lost on process restart (first
// poll after restart reports no bandwidth reading, same as most monitoring tools).
const counterCache = new Map<string, { value: number; atMs: number }>();

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "bigint") return Number(v);
  if (Buffer.isBuffer(v)) {
    const n = Number(v.toString("utf-8"));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStr(v: unknown): string {
  if (Buffer.isBuffer(v)) return v.toString("utf-8");
  return String(v ?? "");
}

function snmpGet(session: ReturnType<typeof snmp.createSession>, oids: string[]): Promise<Array<{ value: unknown }>> {
  return new Promise((resolve, reject) => {
    session.get(oids, (err: unknown, varbinds: Array<{ value: unknown }>) => {
      if (err) reject(err);
      else resolve(varbinds);
    });
  });
}

/** Polls sysUpTime, per-interface oper-status/bandwidth, best-effort CPU load, and best-effort memory usage. */
export async function pollSnmpMetrics(input: SnmpPollInput): Promise<SnmpPollResult> {
  const values: Record<string, number> = {};
  let session: ReturnType<typeof snmp.createSession>;
  try {
    session = createSnmpSession(input.ip, input.credential, input.timeoutMs ?? 3000);
  } catch (err) {
    return { ok: false, values: {}, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const nowMs = Date.now();

    const coreOids = [OID_SYS_UPTIME, OID_HR_PROCESSOR_LOAD_1];
    const coreVarbinds = await snmpGet(session, coreOids);
    const uptimeTicks = toNumber(coreVarbinds[0]?.value);
    if (uptimeTicks !== null) values.uptimeSeconds = uptimeTicks / 100;
    const cpuPct = toNumber(coreVarbinds[1]?.value);
    if (cpuPct !== null) values.cpuPct = cpuPct;

    const interfaces = input.interfaces ?? [];
    if (interfaces.length > 0) {
      const ifOids = interfaces.flatMap((idx) => [ifOperStatusOid(idx), ifInOctetsOid(idx), ifOutOctetsOid(idx)]);
      const ifVarbinds = await snmpGet(session, ifOids);
      interfaces.forEach((idx, i) => {
        const operStatus = toNumber(ifVarbinds[i * 3]?.value);
        const inOctets = toNumber(ifVarbinds[i * 3 + 1]?.value);
        const outOctets = toNumber(ifVarbinds[i * 3 + 2]?.value);

        if (operStatus !== null) values[`if${idx}.up`] = operStatus === 1 ? 1 : 0;

        if (inOctets !== null) {
          const key = `${input.ip}:if${idx}:in`;
          const prev = counterCache.get(key);
          counterCache.set(key, { value: inOctets, atMs: nowMs });
          if (prev) {
            const rate = counterDeltaPerSecond(prev, { value: inOctets, atMs: nowMs });
            if (rate !== null) values[`if${idx}.inBps`] = Math.round(rate * 8);
          }
        }
        if (outOctets !== null) {
          const key = `${input.ip}:if${idx}:out`;
          const prev = counterCache.get(key);
          counterCache.set(key, { value: outOctets, atMs: nowMs });
          if (prev) {
            const rate = counterDeltaPerSecond(prev, { value: outOctets, atMs: nowMs });
            if (rate !== null) values[`if${idx}.outBps`] = Math.round(rate * 8);
          }
        }
      });
    }

    // Best-effort memory: probe a handful of hrStorage indices for a descr matching physical RAM.
    try {
      const descrOids = HR_STORAGE_PROBE_INDICES.map((i) => `${OID_HR_STORAGE_DESCR}.${i}`);
      const descrVarbinds = await snmpGet(session, descrOids);
      const ramIndex = HR_STORAGE_PROBE_INDICES.find((_, i) => /physical memory|^ram$/i.test(toStr(descrVarbinds[i]?.value)));
      if (ramIndex !== undefined) {
        const [sizeVb, usedVb, unitsVb] = await snmpGet(session, [
          `${OID_HR_STORAGE_SIZE}.${ramIndex}`,
          `${OID_HR_STORAGE_USED}.${ramIndex}`,
          `${OID_HR_STORAGE_ALLOC_UNITS}.${ramIndex}`,
        ]);
        const size = toNumber(sizeVb?.value);
        const used = toNumber(usedVb?.value);
        if (size && used !== null && size > 0) {
          values.memUsedPct = Math.round((used / size) * 1000) / 10;
          void unitsVb; // allocation units cancel out of the ratio; kept for clarity/future absolute-bytes reporting
        }
      }
    } catch {
      // Memory is best-effort — many devices don't expose HOST-RESOURCES-MIB at all.
    }

    return { ok: true, values };
  } catch (err) {
    return { ok: false, values: {}, error: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }
}
