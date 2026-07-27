import { connect } from "node:net";

function probeOne(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: ip, port, timeout: timeoutMs });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export interface TcpCheckResult {
  ok: boolean;
  latencyMs?: number;
}

/** Full TCP connect check (used by the monitoring engine, not just discovery fingerprinting) — reports connect latency. */
export function tcpConnectCheck(ip: string, port: number, timeoutMs = 3000): Promise<TcpCheckResult> {
  return new Promise((resolve) => {
    const start = performance.now();
    const socket = connect({ host: ip, port, timeout: timeoutMs });
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok ? { ok: true, latencyMs: Math.round((performance.now() - start) * 10) / 10 } : { ok: false });
    };
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Probes a fixed set of well-known ports for classification hints (camera/printer/firewall/etc). */
export async function fingerprintPorts(ip: string, ports: number[] = DEFAULT_FINGERPRINT_PORTS, timeoutMs = 400): Promise<number[]> {
  const results = await Promise.all(ports.map((port) => probeOne(ip, port, timeoutMs)));
  return ports.filter((_, i) => results[i]);
}

export const DEFAULT_FINGERPRINT_PORTS = [22, 23, 80, 443, 161, 554, 3389, 9100, 8080];
