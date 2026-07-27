/**
 * Prints (never runs) the exact `netsh` commands to open the firewall for Argus. Windows
 * Firewall's first-use prompt for inbound ICMP/UDP is often missed or dismissed by non-technical
 * users, silently breaking device discovery/monitoring — this gives them (or their admin) a
 * copy-pasteable fix instead of guessing.
 */
export function printFirewallHelp(port: number): void {
  const lines = [
    "Argus firewall helper — run these commands in an Administrator PowerShell or Command Prompt:",
    "",
    `netsh advfirewall firewall add rule name="Argus HTTP" dir=in action=allow protocol=TCP localport=${port}`,
    `netsh advfirewall firewall add rule name="Argus ICMP Echo" protocol=icmpv4:8,any dir=in action=allow`,
    "",
    "These allow inbound traffic needed for:",
    `  - the web UI / API on port ${port} (only needed if other machines on your LAN will open it — not required for localhost-only use)`,
    "  - ICMP ping replies, so Argus's own outbound pings for device monitoring aren't blocked by a strict inbound-echo-reply policy some hardened images apply",
    "",
    "To remove these rules later:",
    '  netsh advfirewall firewall delete rule name="Argus HTTP"',
    '  netsh advfirewall firewall delete rule name="Argus ICMP Echo"',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}
