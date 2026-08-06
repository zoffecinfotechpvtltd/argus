// Pure — no I/O. Credential for a vendor management-plane REST API (FortiGate today; Sophos to
// follow in its own adapter). Unlike SnmpCredential this has no legacy plain-string shape to stay
// compatible with — the apiCredsEnc column is new — so it's always plain JSON, no fallback parsing.
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
