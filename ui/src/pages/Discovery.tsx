import { useEffect, useRef, useState, type FormEvent } from "react";
import { Radar, SatelliteDish } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { useWsMessages } from "../ws/WebSocketProvider";
import type { Device, DeviceGroup, DeviceType, DiscoveredDevice, DiscoveryJob } from "../api/types";
import { DEVICE_TYPE_LABELS } from "../api/types";
import { Badge, Button, Card, CardHeader, EmptyState, FieldGroup, Input, Select, useToast } from "../components/ui";

interface DiscoverySchedule {
  id: string;
  cidr: string;
  recurrence: "daily" | "weekly";
  targetGroupId: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
}

const DEVICE_TYPES = Object.keys(DEVICE_TYPE_LABELS) as DeviceType[];

/** Maps the fixed port list @adapters/net/tcpProbe.ts fingerprints to a human capability label —
 * so the results table reads "HTTP · SNMP · RDP" instead of a bare port list a viewer has to
 * mentally decode themselves. Anything not in this map (a probe could return a port outside its
 * own fixed list if that list changes later) still shows as "Port N" rather than disappearing. */
const PORT_CAPABILITY: Record<number, string> = {
  22: "SSH",
  23: "Telnet",
  80: "HTTP",
  443: "HTTPS",
  161: "SNMP",
  554: "RTSP",
  3389: "RDP",
  9100: "Printer",
  8080: "HTTP-alt",
};

function CapabilityBadges({ ports }: { ports: number[] }) {
  if (ports.length === 0) return <span className="text-xs text-text-secondary">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ports.map((p) => (
        <span
          key={p}
          title={`Port ${p}`}
          className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-text-secondary"
        >
          {PORT_CAPABILITY[p] ?? `Port ${p}`}
        </span>
      ))}
    </div>
  );
}

/** Parses a dotted-quad IP to its 32-bit integer form, or null if malformed — used only to place
 * a found device at its true position within the scanned range, never to validate input (the
 * backend already validated the CIDR before a job was created). */
function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join(".");
}

function parseCidr(cidr: string): { base: number; size: number } | null {
  const [ipPart, prefixPart] = cidr.split("/");
  const base = ipPart ? ipToInt(ipPart) : null;
  const prefix = Number(prefixPart);
  if (base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  return { base, size: 2 ** (32 - prefix) };
}

/** The scan's real-time focal point — a horizontal sweep across the actual address space being
 * probed, rather than a generic percentage bar. Each device pin sits at its true relative
 * position within the CIDR range (derived from its own IP vs. the range's base address), so the
 * visual is literally "where in the subnet this device lives," not a fabricated placement. Ties
 * back to the product's real subject: a scan sweeping outward through address space, devices
 * lighting up as they're found. */
function AddressSweepCard({ job, knownIps }: { job: DiscoveryJob; knownIps: Set<string> }) {
  const running = job.status === "running";
  const progressPct = job.total > 0 ? Math.min(100, (job.scanned / job.total) * 100) : 0;
  const newCount = job.results.filter((d) => !knownIps.has(d.ip)).length;
  const range = parseCidr(job.cidr);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-2xs font-medium uppercase tracking-tight text-text-secondary">
            {running && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />}
            {running ? "Scanning" : job.status === "done" ? "Scan complete" : "Scan failed"}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-2xl font-bold tabular-nums tracking-tighter text-text-primary">{job.scanned}</span>
            <span className="text-sm text-text-secondary">/ {job.total} addresses</span>
          </div>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="text-2xs text-text-secondary">Found</div>
            <div className="text-lg font-semibold tabular-nums text-text-primary">{job.results.length}</div>
          </div>
          <div className="text-right">
            <div className="text-2xs text-text-secondary">New</div>
            <div className="text-lg font-semibold tabular-nums text-accent">{newCount}</div>
          </div>
        </div>
      </div>

      <div className="relative h-14 w-full overflow-hidden rounded-lg border border-border bg-bg-subtle">
        <div className="absolute inset-y-0 left-0 bg-accent/[0.06] transition-all duration-300 ease-out-expo" style={{ width: `${progressPct}%` }} aria-hidden="true" />
        {running && (
          <div className="absolute inset-y-0 w-px bg-accent transition-all duration-300 ease-out-expo" style={{ left: `${progressPct}%` }} aria-hidden="true">
            <span className="absolute -left-[3px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 animate-ping rounded-full bg-accent opacity-70" />
            <span className="absolute -left-[3px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-accent" />
          </div>
        )}
        {range &&
          job.results.map((d) => {
            const ipInt = ipToInt(d.ip);
            if (ipInt == null) return null;
            const pct = Math.min(100, Math.max(0, ((ipInt - range.base) / range.size) * 100));
            const isNew = !knownIps.has(d.ip);
            return (
              <div
                key={d.ip}
                className="discovery-pin absolute"
                style={{ left: `${pct}%`, top: "50%" }}
                title={`${d.ip}${d.hostname ? " · " + d.hostname : ""}${isNew ? " (new)" : " (already added)"}`}
              >
                <span className={`block h-2 w-2 rounded-full ${isNew ? "bg-accent" : "bg-text-muted"}`} />
              </div>
            );
          })}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-2xs text-text-secondary">{range ? intToIp(range.base) : job.cidr}</span>
        <div className="flex items-center gap-4 text-2xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-accent" /> New
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-text-muted" /> Already added
          </span>
        </div>
        <span className="font-mono text-2xs text-text-secondary">{range ? intToIp(range.base + range.size - 1) : ""}</span>
      </div>
    </div>
  );
}

export function Discovery() {
  const [cidr, setCidr] = useState("192.168.1.0/24");
  const [community, setCommunity] = useState("");
  const [job, setJob] = useState<DiscoveryJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, DeviceType>>({});
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [targetGroupId, setTargetGroupId] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [knownIps, setKnownIps] = useState<Set<string>>(new Set());
  const [schedules, setSchedules] = useState<DiscoverySchedule[]>([]);
  const [schedCidr, setSchedCidr] = useState("192.168.1.0/24");
  const [schedCommunity, setSchedCommunity] = useState("");
  const [schedRecurrence, setSchedRecurrence] = useState<"daily" | "weekly">("daily");
  const [schedGroupId, setSchedGroupId] = useState("");
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  const jobIdRef = useRef<string | null>(null);
  const toast = useToast();
  const [mounted, setMounted] = useState(false);

  // Reveal-on-mount for the scan form — the one above-the-fold entrance this page animates.
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 20);
    return () => clearTimeout(t);
  }, []);

  async function loadSchedules() {
    api.get<DiscoverySchedule[]>("/discovery/schedules").then(setSchedules).catch(() => {});
  }

  useEffect(() => {
    api.get<DeviceGroup[]>("/groups").then(setGroups).catch(() => {});
    refreshKnownIps();
    loadSchedules();
  }, []);

  async function createSchedule() {
    setCreatingSchedule(true);
    try {
      await api.post("/discovery/schedules", {
        cidr: schedCidr,
        snmpCommunity: schedCommunity || undefined,
        recurrence: schedRecurrence,
        targetGroupId: schedGroupId || null,
      });
      toast.success("Scheduled scan created.");
      setSchedCommunity("");
      await loadSchedules();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create scheduled scan.");
    } finally {
      setCreatingSchedule(false);
    }
  }

  async function deleteSchedule(id: string) {
    await api.delete(`/discovery/schedules/${id}`);
    toast.success("Scheduled scan removed.");
    await loadSchedules();
  }

  async function refreshKnownIps() {
    const page = await api.get<{ items: Device[] }>("/devices?limit=2000").catch(() => null);
    if (page) setKnownIps(new Set(page.items.map((d) => d.ip)));
  }

  useWsMessages((msg) => {
    const evt = msg as { type?: string; jobId?: string };
    if (!evt.type || !evt.jobId || evt.jobId !== jobIdRef.current) return;
    if (evt.type === "discovery.progress" || evt.type === "discovery.done" || evt.type === "discovery.error") {
      refreshJob(evt.jobId);
    }
  });

  async function refreshJob(jobId: string): Promise<DiscoveryJob | null> {
    try {
      const j = await api.get<DiscoveryJob>(`/discovery/${jobId}`);
      setJob(j);
      if (j.status === "done") {
        setSelected(new Set(j.results.filter((d) => !knownIps.has(d.ip)).map((d) => d.ip)));
      }
      return j;
    } catch {
      /* transient poll failure — WS or next tick will retry */
      return null;
    }
  }

  async function handleScan(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStarting(true);
    setSelected(new Set());
    setOverrides({});
    try {
      const res = await api.post<{ jobId: string }>("/discovery/scan", {
        cidr,
        snmpCommunity: community || undefined,
      });
      jobIdRef.current = res.jobId;
      await refreshJob(res.jobId);
      // Fallback poll in case the WS event is missed (tab backgrounded, etc.)
      const interval = setInterval(async () => {
        const j = await refreshJob(res.jobId);
        if (j && j.status !== "running") clearInterval(interval);
      }, 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start scan");
    } finally {
      setStarting(false);
    }
  }

  function toggleSelected(ip: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  }

  async function handleImport() {
    if (!job) return;
    setImporting(true);
    setError(null);
    try {
      const selections = job.results
        .filter((d) => selected.has(d.ip))
        .map((d) => ({
          ip: d.ip,
          mac: d.mac,
          vendor: d.vendor,
          name: d.hostname ?? undefined,
          type: overrides[d.ip] ?? d.guessedType,
          openPorts: d.openPorts,
          groupId: targetGroupId || undefined,
        }));
      const res = await api.post<{ imported: unknown[]; skippedDuplicateIps: string[] }>("/discovery/import", {
        jobId: job.id,
        snmpCommunity: community || undefined,
        selections,
      });
      toast.success(`Added ${res.imported.length} device${res.imported.length === 1 ? "" : "s"}${res.skippedDuplicateIps.length > 0 ? `, skipped ${res.skippedDuplicateIps.length} duplicate(s)` : ""}.`);
      setSelected(new Set());
      await refreshKnownIps();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Import failed";
      setError(message);
      toast.error(message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Layout title="Discovery" subtitle="Sweep a subnet for live devices, then bring the new ones into inventory">
      <div className="mx-auto max-w-5xl space-y-6">
        <Card className={`p-6 transition-all duration-300 ease-out-expo ${mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
          <CardHeader title={<span className="flex items-center gap-2"><Radar size={18} className="text-accent" aria-hidden="true" />Discover devices</span>} />
          <form onSubmit={handleScan} className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px] flex-1">
              <FieldGroup label="Subnet (CIDR)">
                {(ids) => <Input {...ids} className="w-full" value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="192.168.1.0/24" />}
              </FieldGroup>
            </div>
            <div className="min-w-[220px] flex-1">
              <FieldGroup label="SNMP community (optional)">
                {(ids) => <Input {...ids} className="w-full" value={community} onChange={(e) => setCommunity(e.target.value)} placeholder="public" />}
              </FieldGroup>
            </div>
            <Button type="submit" disabled={starting || job?.status === "running"}>
              {job?.status === "running" ? "Scanning…" : "Start scan"}
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-critical">
              {error}
            </p>
          )}
          <p className="mt-2 text-xs text-text-secondary">Max subnet size is /22 (1024 addresses) to protect this host.</p>
        </Card>

        <Card className="p-6">
          <CardHeader title="Scheduled scans" description="Recurring scans that automatically onboard newly found devices — no manual import step." />
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <FieldGroup label="Subnet (CIDR)">
                {(ids) => <Input {...ids} className="w-full" value={schedCidr} onChange={(e) => setSchedCidr(e.target.value)} />}
              </FieldGroup>
            </div>
            <div className="min-w-[160px] flex-1">
              <FieldGroup label="SNMP community (optional)">
                {(ids) => <Input {...ids} className="w-full" value={schedCommunity} onChange={(e) => setSchedCommunity(e.target.value)} />}
              </FieldGroup>
            </div>
            <FieldGroup label="Recurrence">
              {(ids) => (
                <Select {...ids} value={schedRecurrence} onChange={(e) => setSchedRecurrence(e.target.value as "daily" | "weekly")}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Select>
              )}
            </FieldGroup>
            <FieldGroup label="Import into group">
              {(ids) => (
                <Select {...ids} value={schedGroupId} onChange={(e) => setSchedGroupId(e.target.value)}>
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </FieldGroup>
            <Button onClick={createSchedule} disabled={creatingSchedule}>
              {creatingSchedule ? "Creating…" : "Add schedule"}
            </Button>
          </div>
          {schedules.length > 0 && (
            <div className="mt-4 space-y-2">
              {schedules.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-subtle/40 px-3 py-2 text-sm">
                  <div>
                    <span className="font-mono text-text-primary">{s.cidr}</span>
                    <span className="ml-2 text-xs capitalize text-text-secondary">{s.recurrence}</span>
                    <span className="ml-2 text-xs text-text-secondary">
                      Next run {new Date(s.nextRunAt).toLocaleString()}
                      {s.lastRunAt && ` · Last run ${new Date(s.lastRunAt).toLocaleString()}`}
                    </span>
                  </div>
                  <button onClick={() => deleteSchedule(s.id)} className="cursor-pointer text-xs text-critical hover:text-critical/80">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {job && (
          <Card className="p-6">
            <AddressSweepCard job={job} knownIps={knownIps} />
            {job.error && <p className="mt-3 text-sm text-critical">{job.error}</p>}

            {job.results.length === 0 && job.status === "running" && (
              <p className="mt-5 text-center text-xs text-text-secondary/70">Sweeping the range — devices will appear above as they respond.</p>
            )}

            {job.results.length === 0 && job.status === "done" && (
              <EmptyState icon={SatelliteDish} title="No devices responded" description="Nothing in this range answered. Double-check the subnet, or that devices allow ICMP/TCP probes from this host." />
            )}

            {job.results.length > 0 && (
              <div className="mt-5">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <Select value={targetGroupId} onChange={(e) => setTargetGroupId(e.target.value)}>
                    <option value="">No group</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" disabled={selected.size === 0 || importing} onClick={handleImport}>
                    {importing ? "Adding…" : `Add ${selected.size} device${selected.size === 1 ? "" : "s"}`}
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-text-secondary">
                      <tr>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">IP</th>
                        <th className="px-3 py-2">Hostname</th>
                        <th className="px-3 py-2">MAC</th>
                        <th className="px-3 py-2">Vendor</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">RTT</th>
                        <th className="px-3 py-2">Capabilities</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.results.map((d: DiscoveredDevice) => (
                        <tr key={d.ip} className="border-b border-border/60 transition-colors duration-150 last:border-b-0 hover:bg-bg-subtle/50">
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={selected.has(d.ip)} onChange={() => toggleSelected(d.ip)} className="cursor-pointer accent-accent" />
                          </td>
                          <td className="px-3 py-2">{knownIps.has(d.ip) ? <Badge tone="neutral">Already added</Badge> : <Badge tone="success">New</Badge>}</td>
                          <td className="px-3 py-2 font-mono">{d.ip}</td>
                          <td className="px-3 py-2 text-text-primary">{d.hostname ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs text-text-secondary">{d.mac ?? "—"}</td>
                          <td className="px-3 py-2 text-text-primary">{d.vendor ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <Select
                                value={overrides[d.ip] ?? d.guessedType}
                                onChange={(e) => setOverrides((prev) => ({ ...prev, [d.ip]: e.target.value as DeviceType }))}
                                className="py-1 text-xs"
                              >
                                {DEVICE_TYPES.map((t) => (
                                  <option key={t} value={t}>
                                    {DEVICE_TYPE_LABELS[t]}
                                  </option>
                                ))}
                              </Select>
                              <span
                                className={`shrink-0 text-xs font-medium ${
                                  d.confidence >= 0.8 ? "text-success" : d.confidence >= 0.5 ? "text-warning" : "text-text-muted"
                                }`}
                                title={
                                  d.confidence >= 0.8
                                    ? "High confidence — port/protocol fingerprint or SNMP identity matched"
                                    : d.confidence >= 0.5
                                      ? "Medium confidence — inferred from vendor or hostname alone, worth a glance before importing"
                                      : "Low confidence — little to go on, double-check the type before importing"
                                }
                              >
                                {Math.round(d.confidence * 100)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{d.rttMs != null ? `${d.rttMs} ms` : "—"}</td>
                          <td className="px-3 py-2">
                            <CapabilityBadges ports={d.openPorts} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </Layout>
  );
}
