// Pure — no I/O. Credential for a vendor management-plane REST API. Unlike SnmpCredential this has
// no legacy plain-string shape to stay compatible with — the apiCredsEnc column is new — so it's
// always plain JSON, no fallback parsing. Which vendor a credential belongs to is tracked
// separately on Device.apiVendor, not inside the credential JSON itself — each vendor gets its own
// CheckKind (fortigate_api / sophos_api) and the scheduler picks the checker by kind, so the
// credential shape only ever needs to satisfy its own vendor's checker.
export interface VendorApiCredential {
  apiToken: string;
  /** Defaults to 443 (FortiGate's default HTTPS admin/API port) when omitted. */
  port?: number;
  /** Defaults to true. Set false only for a lab/self-signed appliance cert — same trust decision
   * httpChecker.ts's allowSelfSigned already makes for HTTP checks. */
  verifyTls?: boolean;
}

export function parseVendorApiCredential(decrypted: string): VendorApiCredential {
  return JSON.parse(decrypted) as VendorApiCredential;
}

export function serializeVendorApiCredential(cred: VendorApiCredential): string {
  return JSON.stringify(cred);
}

/** Sophos Firewall (SFOS/XG) on-prem's classic XML API authenticates per-request with a
 * username/password pair (an "API user" — a dedicated local admin account is the recommended
 * setup, not your personal login), not a bearer token like FortiGate's. `password` is commonly the
 * account's real password, but Sophos also lets an admin profile carry a separate API key used the
 * same way — either works here since the API treats both as the <Password> field. */
export interface SophosApiCredential {
  username: string;
  password: string;
  /** Defaults to 4444 — Sophos's default HTTPS admin/API port (deliberately not 443, unlike
   * FortiGate — Sophos reserves 443 for the user/SSL VPN portal on most models). */
  port?: number;
  verifyTls?: boolean;
}

export function parseSophosApiCredential(decrypted: string): SophosApiCredential {
  return JSON.parse(decrypted) as SophosApiCredential;
}

export function serializeSophosApiCredential(cred: SophosApiCredential): string {
  return JSON.stringify(cred);
}
