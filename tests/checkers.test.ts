import { describe, expect, it, afterAll, beforeAll } from "bun:test";
import { HttpChecker } from "@adapters/net/checkers/httpChecker";
import { TcpChecker } from "@adapters/net/checkers/tcpChecker";
import { DEFAULT_TENANT_ID, type Check, type Device } from "@domain/entities";

let server: ReturnType<typeof Bun.serve>;
let port: number;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/ok") return new Response("healthy", { status: 200 });
      if (url.pathname === "/broken") return new Response("nope", { status: 500 });
      if (url.pathname === "/keyword") return new Response("status: all systems nominal", { status: 200 });
      return new Response("not found", { status: 404 });
    },
  });
  port = server.port!;
});

afterAll(() => {
  server.stop(true);
});

function makeDevice(overrides: Partial<Device> = {}): Device {
  const now = new Date().toISOString();
  return {
    id: "dev-1",
    tenantId: DEFAULT_TENANT_ID,
    name: "test",
    ip: "127.0.0.1",
    mac: null,
    vendor: null,
    type: "server",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCheck(kind: Check["kind"], config: Check["config"] = {}): Check {
  return {
    id: "chk-1",
    tenantId: DEFAULT_TENANT_ID,
    deviceId: "dev-1",
    kind,
    config,
    thresholds: {},
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}

describe("HttpChecker", () => {
  it("passes when the response status is in the expected list", async () => {
    const checker = new HttpChecker();
    const result = await checker.run(makeDevice(), makeCheck("http", { port, path: "/ok", expectedStatus: [200], allowLocalhost: true }));
    expect(result.ok).toBe(true);
    expect(result.values?.httpStatus).toBe(200);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails when the response status is not in the expected list", async () => {
    const checker = new HttpChecker();
    const result = await checker.run(makeDevice(), makeCheck("http", { port, path: "/broken", expectedStatus: [200], allowLocalhost: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("fails when the expected body keyword is missing", async () => {
    const checker = new HttpChecker();
    const result = await checker.run(makeDevice(), makeCheck("http", { port, path: "/ok", expectedStatus: [200], expectBody: "nominal", allowLocalhost: true }));
    expect(result.ok).toBe(false);
  });

  it("passes when the expected body keyword is present", async () => {
    const checker = new HttpChecker();
    const result = await checker.run(
      makeDevice(),
      makeCheck("http", { port, path: "/keyword", expectedStatus: [200], expectBody: "nominal", allowLocalhost: true })
    );
    expect(result.ok).toBe(true);
  });

  it("fails gracefully (no throw) when the port is unreachable", async () => {
    const checker = new HttpChecker();
    const result = await checker.run(makeDevice(), makeCheck("http", { port: 1, timeoutMs: 500, allowLocalhost: true }));
    expect(result.ok).toBe(false);
  });

  it("blocks a loopback target unless allowLocalhost is set", async () => {
    const checker = new HttpChecker();
    const blocked = await checker.run(makeDevice(), makeCheck("http", { port, path: "/ok" }));
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("SSRF guard");

    const allowed = await checker.run(makeDevice(), makeCheck("http", { port, path: "/ok", allowLocalhost: true }));
    expect(allowed.ok).toBe(true);
  });

  it("blocks a link-local/metadata target even with allowLocalhost set", async () => {
    const checker = new HttpChecker();
    const result = await checker.run(makeDevice({ ip: "169.254.169.254" }), makeCheck("http", { port: 80, allowLocalhost: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF guard");
  });
});

describe("TcpChecker", () => {
  it("connects successfully to an open port and reports latency", async () => {
    const checker = new TcpChecker();
    const result = await checker.run(makeDevice(), makeCheck("tcp", { port, allowLocalhost: true }));
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails when the port is closed", async () => {
    const checker = new TcpChecker();
    const result = await checker.run(makeDevice(), makeCheck("tcp", { port: 1, timeoutMs: 500, allowLocalhost: true }));
    expect(result.ok).toBe(false);
  });

  it("fails with a clear error when no port is configured", async () => {
    const checker = new TcpChecker();
    const result = await checker.run(makeDevice(), makeCheck("tcp", { allowLocalhost: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("port");
  });

  it("blocks a loopback target unless allowLocalhost is set", async () => {
    const checker = new TcpChecker();
    const blocked = await checker.run(makeDevice(), makeCheck("tcp", { port }));
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("SSRF guard");
  });

  it("blocks a link-local/metadata target even with allowLocalhost set", async () => {
    const checker = new TcpChecker();
    const result = await checker.run(makeDevice({ ip: "169.254.169.254" }), makeCheck("tcp", { port: 80, allowLocalhost: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("SSRF guard");
  });
});
