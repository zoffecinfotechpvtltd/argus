// ICMP via spawned system ping — works without admin/raw-socket privileges on both Windows and POSIX.
// Args are always passed as an array (never shell-concatenated) to avoid command injection.

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isValidIPv4(ip: string): boolean {
  const m = IPV4_RE.exec(ip);
  if (!m) return false;
  return m.slice(1, 5).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
}

export interface PingResult {
  ok: boolean;
  latencyMs?: number;
  lossPct: number;
}

function buildArgs(ip: string, count: number, timeoutMs: number): string[] {
  if (process.platform === "win32") {
    return ["ping", "-n", String(count), "-w", String(timeoutMs), ip];
  }
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  return ["ping", "-c", String(count), "-W", String(timeoutSec), ip];
}

function parseLatencies(output: string): number[] {
  const latencies: number[] = [];
  // Windows: "time=23ms" or "time<1ms"; POSIX: "time=23.4 ms"
  const re = /time[=<]([\d.]+)\s*ms/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    latencies.push(Number(m[1]));
  }
  return latencies;
}

/** Runs `count` pings against `ip` and reports average latency + loss %. Throws if `ip` is not a valid IPv4 literal. */
export async function pingHost(ip: string, count = 3, timeoutMs = 1000): Promise<PingResult> {
  if (!isValidIPv4(ip)) throw new Error(`Refusing to ping non-IPv4 literal: ${ip}`);

  const args = buildArgs(ip, count, timeoutMs);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;

  const latencies = parseLatencies(stdout);
  const lossPct = count > 0 ? Math.round(((count - latencies.length) / count) * 100) : 100;

  if (latencies.length === 0) {
    return { ok: false, lossPct: 100 };
  }
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  return { ok: true, latencyMs: Math.round(avg * 10) / 10, lossPct };
}
