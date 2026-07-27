import type { Check, Device } from "@domain/entities";
import type { CheckResult, Checker } from "@ports/services";
import { isBlockedAddress } from "@domain/ssrfGuard";

export class HttpChecker implements Checker {
  async run(device: Device, check: Check): Promise<CheckResult> {
    const cfg = check.config;
    const port = cfg.port ?? (cfg.tls ? 443 : 80);
    const path = cfg.path ?? "/";
    const timeoutMs = cfg.timeoutMs ?? 5000;
    const expectedStatus = cfg.expectedStatus ?? [200];
    const url = `${cfg.tls ? "https" : "http"}://${device.ip}:${port}${path}`;

    if (isBlockedAddress(device.ip, { allowLoopback: cfg.allowLocalhost })) {
      return { ok: false, error: "Blocked by SSRF guard: link-local/metadata address, or loopback without allowLocalhost" };
    }

    const start = performance.now();
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
        // Bun-specific fetch option for per-request cert relaxation (cameras/firewalls often self-sign)
        tls: cfg.allowSelfSigned ? { rejectUnauthorized: false } : undefined,
        redirect: "manual",
      });
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;

      if (!expectedStatus.includes(res.status)) {
        return { ok: false, latencyMs, error: `Unexpected status ${res.status}` };
      }

      if (cfg.expectBody) {
        const text = await res.text();
        if (!text.includes(cfg.expectBody)) {
          return { ok: false, latencyMs, error: `Response body did not contain expected keyword` };
        }
      }

      return { ok: true, latencyMs, values: { httpStatus: res.status } };
    } catch (err) {
      const latencyMs = Math.round((performance.now() - start) * 10) / 10;
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, latencyMs, error: message };
    }
  }
}
