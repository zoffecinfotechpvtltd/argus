import snmp from "net-snmp";

const OID_SYS_DESCR = "1.3.6.1.2.1.1.1.0";
const OID_SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0";
const OID_SYS_NAME = "1.3.6.1.2.1.1.5.0";

export interface SnmpProbeResult {
  sysDescr: string | null;
  sysName: string | null;
  sysObjectId: string | null;
}

/** Best-effort SNMP v2c probe for classification/inventory hints. Never throws — returns nulls on any failure. */
export function probeSnmp(ip: string, community: string, timeoutMs = 1500): Promise<SnmpProbeResult> {
  return new Promise((resolve) => {
    const empty: SnmpProbeResult = { sysDescr: null, sysName: null, sysObjectId: null };
    let session: ReturnType<typeof snmp.createSession>;
    try {
      session = snmp.createSession(ip, community, { timeout: timeoutMs, retries: 0, version: snmp.Version2c });
    } catch {
      resolve(empty);
      return;
    }

    const finish = (result: SnmpProbeResult) => {
      try {
        session.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    session.get([OID_SYS_DESCR, OID_SYS_OBJECT_ID, OID_SYS_NAME], (err: unknown, varbinds: Array<{ value: unknown }>) => {
      if (err || !varbinds) {
        finish(empty);
        return;
      }
      const toStr = (v: unknown): string | null => {
        if (v === undefined || v === null) return null;
        return Buffer.isBuffer(v) ? v.toString("utf-8") : String(v);
      };
      finish({
        sysDescr: toStr(varbinds[0]?.value),
        sysObjectId: toStr(varbinds[1]?.value),
        sysName: toStr(varbinds[2]?.value),
      });
    });
  });
}
