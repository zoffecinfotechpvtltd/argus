// Reads the OS ARP/neighbor table to map responder IPs to MAC addresses. No shell string concatenation.

export async function readArpTable(): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  try {
    if (process.platform === "win32") {
      const proc = Bun.spawn(["arp", "-a"], { stdout: "pipe", stderr: "pipe" });
      const out = await new Response(proc.stdout).text();
      await proc.exited;
      // Lines look like: "  192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic"
      const re = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+([0-9a-fA-F]{2}(?:-[0-9a-fA-F]{2}){5})/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(out)) !== null) {
        map.set(m[1]!, m[2]!.toUpperCase());
      }
    } else {
      // Prefer `ip neigh` (modern Linux); fall back to `arp -a` (macOS / older Linux).
      try {
        const proc = Bun.spawn(["ip", "neigh"], { stdout: "pipe", stderr: "pipe" });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        const re = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}).*?lladdr\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(out)) !== null) {
          map.set(m[1]!, m[2]!.toUpperCase());
        }
      } catch {
        const proc = Bun.spawn(["arp", "-a"], { stdout: "pipe", stderr: "pipe" });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        const re = /\((\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\)\s+at\s+([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(out)) !== null) {
          map.set(m[1]!, m[2]!.toUpperCase());
        }
      }
    }
  } catch {
    // ARP table unavailable — discovery still works, just without MAC/vendor enrichment.
  }

  return map;
}
