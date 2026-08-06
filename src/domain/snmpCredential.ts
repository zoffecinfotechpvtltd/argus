// Pure — no I/O. SNMP v1/v2c share one secret shape (a community string, just a different wire
// version); v3 is per-user authentication/privacy instead of a shared secret. All three are stored
// through the same `devices.snmp_creds_enc` / `discovery_schedules.snmp_creds_enc` encrypted
// column that has only ever held a plain v2c community string — so v1 and v3 credentials are
// JSON-encoded before encryption, and parseSnmpCredential falls back to treating anything that
// isn't that JSON shape as a legacy v2c community string. This keeps every credential saved before
// v1/v3 support existed decrypting exactly as before, with no data migration.
export type SnmpCredential =
  | { version: "1"; community: string }
  | { version: "2c"; community: string }
  | {
      version: "3";
      username: string;
      securityLevel: "noAuthNoPriv" | "authNoPriv" | "authPriv";
      authProtocol?: "md5" | "sha" | "sha256";
      authKey?: string;
      privProtocol?: "des" | "aes";
      privKey?: string;
    };

export function parseSnmpCredential(decrypted: string): SnmpCredential {
  try {
    const parsed = JSON.parse(decrypted);
    if (parsed && typeof parsed === "object" && (parsed.version === "1" || parsed.version === "2c" || parsed.version === "3")) {
      return parsed as SnmpCredential;
    }
  } catch {
    /* not JSON — legacy plain community string, fall through */
  }
  return { version: "2c", community: decrypted };
}

export function serializeSnmpCredential(cred: SnmpCredential): string {
  // v2c alone serializes to the bare community string, not JSON — that's the exact on-disk shape
  // every pre-v1/v3 install already wrote, so a device saved under v1/v3 support and then edited
  // back to v2c round-trips through that same legacy shape instead of a new one only this version
  // understands. v1 must NOT take this shortcut — a bare string always parses back as v2c (see
  // above), so an un-tagged v1 community would silently be probed as v2c on the next read.
  return cred.version === "2c" ? cred.community : JSON.stringify(cred);
}
