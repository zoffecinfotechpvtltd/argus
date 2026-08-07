import type { AppContainer } from "@ports/context";
import { classifyDevice } from "@domain/classify";
import { parseSnmpCredential } from "@domain/snmpCredential";

const RECLASSIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000;
// Matches Discovery.tsx's own "high confidence" badge threshold (green, >=80%) — an automated
// re-classification with no human reviewing the result has to hold itself to at least that bar,
// not the lower "worth a human glance" bar the discovery-scan UI is allowed to show.
const CONFIDENCE_THRESHOLD = 0.8;

export interface ReclassifyResult {
  checked: number;
  updated: number;
}

/**
 * Devices only ever get classified once, at creation/discovery time — nothing revisits that guess
 * afterward, so a device whose classifier signal was weak on day one (or that got SNMP creds added
 * later, well after its first classification) stays "unknown" forever even though a strong signal
 * now exists. This fills that in, but conservatively: only ever touches devices still sitting at
 * type "unknown" — never fights a type that's already been set, by the classifier or by an admin's
 * manual correction, same "never silently changed" principle DEFAULT_CRITICAL_TYPES already follows
 * for criticalAsset. Signal source is SNMP sysDescr only (the strongest single signal
 * classifyDevice uses, per classify.ts's own scoring) — no live port/hostname re-probe, so a device
 * without SNMP configured is simply skipped rather than guessed at from stale/absent data.
 */
export async function reclassifyDevices(app: AppContainer): Promise<ReclassifyResult> {
  const devices = await app.repos.device.listAllEnabled();
  let checked = 0;
  let updated = 0;

  for (const device of devices) {
    if (device.type !== "unknown" || !device.snmpCredsEnc) continue;
    checked++;

    let sysDescr: string | null;
    try {
      const credential = parseSnmpCredential(app.secretCipher.decrypt(device.snmpCredsEnc));
      sysDescr = (await app.snmpIdentityProber.probe(device.ip, credential)).sysDescr;
    } catch {
      continue;
    }
    if (!sysDescr) continue;

    const { type, confidence } = classifyDevice({ openPorts: [], ouiVendor: device.vendor, snmpSysDescr: sysDescr, hostname: device.name });
    if (type === "unknown" || confidence < CONFIDENCE_THRESHOLD) continue;

    const nowIso = app.clock.nowIso();
    await app.repos.device.update(device.tenantId, device.id, { type });
    await app.repos.audit.record({
      tenantId: device.tenantId,
      userId: null,
      action: "device.reclassify",
      entityType: "device",
      entityId: device.id,
      detail: { from: "unknown", to: type, confidence: Math.round(confidence * 100) / 100, source: "snmp_sysdescr" },
      createdAt: nowIso,
    });
    updated++;
  }

  return { checked, updated };
}

export class ReclassificationScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstRunTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private app: AppContainer) {}

  private run(): void {
    reclassifyDevices(this.app)
      .then((result) => {
        if (result.updated > 0) this.app.logger.info("reclassification_cycle", { checked: result.checked, updated: result.updated });
      })
      .catch((err) => this.app.logger.error("reclassification_cycle_failed", { error: (err as Error).message }));
  }

  start(): void {
    this.firstRunTimer = setTimeout(() => this.run(), FIRST_RUN_DELAY_MS);
    this.timer = setInterval(() => this.run(), RECLASSIFY_INTERVAL_MS);
  }

  stop(): void {
    if (this.firstRunTimer) clearTimeout(this.firstRunTimer);
    if (this.timer) clearInterval(this.timer);
  }
}
