import snmp from "net-snmp";
import type { SnmpCredential } from "@domain/snmpCredential";

const AUTH_PROTOCOLS: Record<"md5" | "sha" | "sha256", number> = {
  md5: snmp.AuthProtocols.md5,
  sha: snmp.AuthProtocols.sha,
  sha256: snmp.AuthProtocols.sha256,
};

const PRIV_PROTOCOLS: Record<"des" | "aes", number> = {
  des: snmp.PrivProtocols.des,
  aes: snmp.PrivProtocols.aes,
};

const SECURITY_LEVELS: Record<"noAuthNoPriv" | "authNoPriv" | "authPriv", number> = {
  noAuthNoPriv: snmp.SecurityLevel.noAuthNoPriv,
  authNoPriv: snmp.SecurityLevel.authNoPriv,
  authPriv: snmp.SecurityLevel.authPriv,
};

/** Builds a net-snmp session for either v2c or v3 from one normalized credential shape, so callers
 * (snmpProbe.ts, snmpMetrics.ts) don't each need their own v2c-vs-v3 branch. */
export function createSnmpSession(ip: string, credential: SnmpCredential, timeoutMs: number): ReturnType<typeof snmp.createSession> {
  if (credential.version === "3") {
    const user = {
      name: credential.username,
      level: SECURITY_LEVELS[credential.securityLevel],
      authProtocol: credential.authProtocol ? AUTH_PROTOCOLS[credential.authProtocol] : undefined,
      authKey: credential.authKey,
      privProtocol: credential.privProtocol ? PRIV_PROTOCOLS[credential.privProtocol] : undefined,
      privKey: credential.privKey,
    };
    return snmp.createV3Session(ip, user, { timeout: timeoutMs, retries: 0 });
  }
  const version = credential.version === "1" ? snmp.Version1 : snmp.Version2c;
  return snmp.createSession(ip, credential.community, { timeout: timeoutMs, retries: 0, version });
}
