import { describe, expect, it, afterEach } from "bun:test";
import { randomUUID } from "node:crypto";
import { SlackNotifier } from "@adapters/notify/slackNotifier";
import { TeamsNotifier } from "@adapters/notify/teamsNotifier";
import { PagerDutyNotifier } from "@adapters/notify/pagerdutyNotifier";
import { DEFAULT_TENANT_ID, type Alert, type Device } from "@domain/entities";
import type { NotifyPayload } from "@ports/services";

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; body: unknown }> = [];

function stubFetch(status = 200) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response("{}", { status });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls = [];
});

function makeDevice(overrides: Partial<Device> = {}): Device {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    name: "core-switch",
    ip: "10.0.0.5",
    mac: null,
    vendor: null,
    type: "switch",
    location: null,
    groupId: null,
    responsibleUserId: null,
    intervalSec: 60,
    enabled: true,
    snmpCredsEnc: null,
    tags: [],
    uplinkDeviceId: null,
    criticalAsset: false,
    model: null,
    firmwareVersion: null,
    serialNumber: null,
    haRole: null,
    apiVendor: null,
    apiCredsEnc: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tenantId: DEFAULT_TENANT_ID,
    deviceId: "dev-1",
    conditionKey: "down",
    severity: "critical",
    status: "open",
    title: "core-switch is down",
    detail: "3 consecutive failed pings",
    openedAt: now,
    lastSeenAt: now,
    ackedBy: null,
    ackedAt: null,
    resolvedAt: null,
    escalationStep: 0,
    ...overrides,
  };
}

function makePayload(overrides: Partial<NotifyPayload> = {}): NotifyPayload {
  const device = makeDevice();
  return { alert: makeAlert({ deviceId: device.id }), device, tenantId: DEFAULT_TENANT_ID, ...overrides };
}

describe("SlackNotifier", () => {
  it("posts a severity-colored attachment with the alert summary", async () => {
    stubFetch();
    const result = await new SlackNotifier().send("https://hooks.slack.com/services/x", makePayload());
    expect(result.ok).toBe(true);
    const body = calls[0]!.body as { text: string; attachments: Array<{ color: string }> };
    expect(body.text).toContain("CRITICAL");
    expect(body.attachments[0]!.color).toBe("#dc2626");
  });

  it("is blocked by the webhook SSRF guard for a private target", async () => {
    stubFetch();
    const result = await new SlackNotifier().send("http://10.0.0.1/webhook", makePayload());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ssrf/i);
    expect(calls.length).toBe(0);
  });
});

describe("TeamsNotifier", () => {
  it("posts a MessageCard with an Acknowledge action when ackUrl is present", async () => {
    stubFetch();
    const result = await new TeamsNotifier().send("https://contoso.webhook.office.com/x", makePayload({ ackUrl: "https://argus.local/ack/123" }));
    expect(result.ok).toBe(true);
    const body = calls[0]!.body as { ["@type"]: string; potentialAction: Array<{ targets: Array<{ uri: string }> }> };
    expect(body["@type"]).toBe("MessageCard");
    expect(body.potentialAction[0]!.targets[0]!.uri).toBe("https://argus.local/ack/123");
  });

  it("lists every affected device for a storm notification", async () => {
    stubFetch();
    await new TeamsNotifier().send(
      "https://contoso.webhook.office.com/x",
      makePayload({ affectedDevices: [{ name: "a", ip: "10.0.0.1" }, { name: "b", ip: "10.0.0.2" }] })
    );
    const body = calls[0]!.body as { sections: Array<{ facts: Array<{ name: string; value: string }> }> };
    const affectedFact = body.sections[0]!.facts.find((f) => f.name === "Affected devices");
    expect(affectedFact?.value).toBe("a (10.0.0.1), b (10.0.0.2)");
  });
});

describe("PagerDutyNotifier", () => {
  it("triggers with mapped severity and a stable dedup_key on a new alert", async () => {
    stubFetch();
    const alert = makeAlert({ id: "alert-1", severity: "warning" });
    const result = await new PagerDutyNotifier().send("routing-key-abc", makePayload({ alert }));
    expect(result.ok).toBe(true);
    const body = calls[0]!.body as { routing_key: string; event_action: string; dedup_key: string; payload: { severity: string } };
    expect(body.routing_key).toBe("routing-key-abc");
    expect(body.event_action).toBe("trigger");
    expect(body.dedup_key).toBe("alert-1");
    expect(body.payload.severity).toBe("warning");
  });

  it("resolves (not triggers) once the alert carries resolvedAt", async () => {
    stubFetch();
    const alert = makeAlert({ id: "alert-2", resolvedAt: new Date().toISOString() });
    const result = await new PagerDutyNotifier().send("routing-key-abc", makePayload({ alert }));
    expect(result.ok).toBe(true);
    const body = calls[0]!.body as { event_action: string; dedup_key: string; payload?: unknown };
    expect(body.event_action).toBe("resolve");
    expect(body.dedup_key).toBe("alert-2");
    expect(body.payload).toBeUndefined();
  });

  it("sendTest triggers then resolves the same dedup_key, leaving nothing open", async () => {
    stubFetch();
    const result = await new PagerDutyNotifier().sendTest(DEFAULT_TENANT_ID, "routing-key-abc");
    expect(result.ok).toBe(true);
    expect(calls.length).toBe(2);
    const [trigger, resolve] = calls.map((c) => c.body as { event_action: string; dedup_key: string });
    expect(trigger!.event_action).toBe("trigger");
    expect(resolve!.event_action).toBe("resolve");
    expect(resolve!.dedup_key).toBe(trigger!.dedup_key);
  });

  it("surfaces PagerDuty's error response on failure", async () => {
    stubFetch(400);
    const result = await new PagerDutyNotifier().send("bad-key", makePayload());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/status 400/);
  });
});
