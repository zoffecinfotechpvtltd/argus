import { describe, expect, it } from "bun:test";
import { parseSnmpCredential, serializeSnmpCredential } from "@domain/snmpCredential";

describe("SNMP credential parse/serialize", () => {
  it("treats a legacy plain community string (pre-v3 installs) as v2c", () => {
    expect(parseSnmpCredential("public")).toEqual({ version: "2c", community: "public" });
  });

  it("round-trips a v2c credential through serialize -> parse as the bare community string", () => {
    const cred = { version: "2c" as const, community: "my-community" };
    const serialized = serializeSnmpCredential(cred);
    expect(serialized).toBe("my-community"); // exact legacy shape, not JSON
    expect(parseSnmpCredential(serialized)).toEqual(cred);
  });

  it("round-trips a v1 credential through serialize -> parse (JSON-tagged, not the bare v2c shortcut)", () => {
    const cred = { version: "1" as const, community: "old-gear" };
    const serialized = serializeSnmpCredential(cred);
    expect(serialized).not.toBe("old-gear"); // must NOT take the v2c bare-string shortcut
    expect(parseSnmpCredential(serialized)).toEqual(cred);
  });

  it("round-trips a v3 credential through serialize -> parse", () => {
    const cred = {
      version: "3" as const,
      username: "netmon",
      securityLevel: "authPriv" as const,
      authProtocol: "sha" as const,
      authKey: "auth-secret",
      privProtocol: "aes" as const,
      privKey: "priv-secret",
    };
    const serialized = serializeSnmpCredential(cred);
    expect(parseSnmpCredential(serialized)).toEqual(cred);
  });

  it("does not mistake a community string that happens to look unusual for JSON", () => {
    // A community string containing braces/colons must still parse as itself, not crash or get
    // mistaken for a v3 payload just because JSON.parse doesn't throw on some inputs.
    expect(parseSnmpCredential("not-json-{public}")).toEqual({ version: "2c", community: "not-json-{public}" });
  });
});
