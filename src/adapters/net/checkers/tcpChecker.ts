import type { Check, Device } from "@domain/entities";
import type { CheckResult, Checker } from "@ports/services";
import { tcpConnectCheck } from "@adapters/net/tcpProbe";
import { isBlockedAddress } from "@domain/ssrfGuard";

export class TcpChecker implements Checker {
  async run(device: Device, check: Check): Promise<CheckResult> {
    // Same SSRF guard as httpChecker.ts (link-local/cloud-metadata + loopback unless
    // allowLocalhost) — a raw TCP connect-and-read still confirms port state and, depending on the
    // protocol behind it, can leak banner/response data, so it needs the same protection an
    // authenticated-but-untrusted tenant user shouldn't be able to bypass just by picking "tcp"
    // instead of "http" as the check kind.
    if (isBlockedAddress(device.ip, { allowLoopback: check.config.allowLocalhost as boolean | undefined })) {
      return { ok: false, error: "Blocked by SSRF guard: link-local/metadata address, or loopback without allowLocalhost" };
    }

    const port = check.config.port;
    if (!port) return { ok: false, error: "TCP check missing a port" };

    const timeoutMs = check.config.timeoutMs ?? 3000;
    const result = await tcpConnectCheck(device.ip, port, timeoutMs);
    if (!result.ok) return { ok: false, error: `Could not connect to ${device.ip}:${port}` };
    return { ok: true, latencyMs: result.latencyMs };
  }
}
