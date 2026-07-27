import type { NotifyPayload } from "@ports/services";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  warning: "#f59e0b",
  info: "#22c55e",
};

export function emailHtml(payload: NotifyPayload, baseUrl: string): string {
  const { alert, device, affectedDevices } = payload;
  const color = SEVERITY_COLOR[alert.severity] ?? "#64748b";
  const deepLink = `${baseUrl}/devices/${device.id}`;
  const ackButton = payload.ackUrl
    ? `<a href="${payload.ackUrl}" style="display:inline-block;background:#0284c7;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px;">Acknowledge</a>`
    : "";

  // A storm/aggregate notification names every device it covers, in its own list — the single
  // "Device" row below is only ever one representative device, which would otherwise make a
  // 20-device outage look like it's about one box.
  const isStorm = affectedDevices && affectedDevices.length > 0;
  const deviceListHtml = isStorm
    ? `<div style="margin:0 0 16px;">
          <div style="color:#94a3b8;font-size:12px;text-transform:uppercase;margin-bottom:4px;">Affected devices (${affectedDevices.length})</div>
          <ul style="margin:0;padding-left:18px;color:#334155;font-size:14px;">
            ${affectedDevices.map((d) => `<li>${escapeHtml(d.name)} <span style="color:#94a3b8;">(${escapeHtml(d.ip)})</span></li>`).join("")}
          </ul>
        </div>`
    : `<p style="color:#475569;margin:0 0 16px;">${escapeHtml(alert.detail ?? "")}</p>`;

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px;">
    <div style="display:inline-block;background:${color};color:#fff;font-size:12px;font-weight:700;padding:4px 10px;border-radius:9999px;text-transform:uppercase;">${alert.severity}</div>
    <h2 style="margin:12px 0 4px;">${escapeHtml(alert.title)}</h2>
    ${deviceListHtml}
    <table style="width:100%;font-size:14px;color:#334155;border-collapse:collapse;">
      ${isStorm ? "" : `<tr><td style="padding:4px 0;color:#94a3b8;">Device</td><td>${escapeHtml(device.name)}</td></tr>
      <tr><td style="padding:4px 0;color:#94a3b8;">IP</td><td>${escapeHtml(device.ip)}</td></tr>
      <tr><td style="padding:4px 0;color:#94a3b8;">Type</td><td>${escapeHtml(device.type)}</td></tr>`}
      <tr><td style="padding:4px 0;color:#94a3b8;">Opened</td><td>${escapeHtml(alert.openedAt)}</td></tr>
    </table>
    <div>
      <a href="${deepLink}" style="color:#0284c7;font-size:14px;">View device →</a>
    </div>
    ${ackButton}
  </div>`;
}

export function plainText(payload: NotifyPayload): string {
  const { alert, device, affectedDevices } = payload;
  const lines = [`[${alert.severity.toUpperCase()}] ${alert.title}`];
  if (affectedDevices && affectedDevices.length > 0) {
    lines.push(`Affected devices (${affectedDevices.length}):`);
    for (const d of affectedDevices) lines.push(`  - ${d.name} (${d.ip})`);
  } else {
    lines.push(`Device: ${device.name} (${device.ip}, ${device.type})`);
    if (alert.detail) lines.push(alert.detail);
  }
  lines.push(`Opened: ${alert.openedAt}`);
  if (payload.ackUrl) lines.push(`Acknowledge: ${payload.ackUrl}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
