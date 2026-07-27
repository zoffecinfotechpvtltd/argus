import { describe, expect, it } from "bun:test";
import { buildZip, readZip } from "@adapters/backup/zip";

describe("buildZip / readZip round trip", () => {
  it("round-trips a single small text entry", () => {
    const zip = buildZip([{ name: "hello.txt", data: Buffer.from("hello world") }]);
    const entries = readZip(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("hello.txt");
    expect(entries[0]?.data.toString("utf-8")).toBe("hello world");
  });

  it("round-trips multiple entries with different sizes, including binary data", () => {
    const binary = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
    const zip = buildZip([
      { name: "config.json", data: Buffer.from(JSON.stringify({ a: 1, b: "two" })) },
      { name: "data/argus.db", data: binary },
      { name: "empty.txt", data: Buffer.alloc(0) },
    ]);
    const entries = readZip(zip);
    expect(entries).toHaveLength(3);

    const config = entries.find((e) => e.name === "config.json");
    expect(JSON.parse(config!.data.toString("utf-8"))).toEqual({ a: 1, b: "two" });

    const db = entries.find((e) => e.name === "data/argus.db");
    expect(db!.data.equals(binary)).toBe(true);

    const empty = entries.find((e) => e.name === "empty.txt");
    expect(empty!.data.length).toBe(0);
  });

  it("rejects a non-ZIP buffer", () => {
    expect(() => readZip(Buffer.from("not a zip file"))).toThrow();
  });
});
