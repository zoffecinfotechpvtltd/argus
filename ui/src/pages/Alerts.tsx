import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BellOff, AlertOctagon, AlertTriangle, Info, LayoutList, MessageSquare, Table2 } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import { useWsMessages } from "../ws/WebSocketProvider";
import type { Alert, AlertSeverity, AlertStatus } from "../api/alertTypes";
import { SEVERITY_HEX } from "../lib/statusTokens";
import type { DeviceGroup } from "../api/types";
import { Badge, Button, EmptyState, Select, SkeletonRows, Textarea, useToast } from "../components/ui";
import { FilterPresetsBar } from "../components/FilterPresetsBar";
import { useFilterPresets } from "../hooks/useFilterPresets";
import { AlertsTable } from "../components/AlertsTable";

interface AlertsFilterPreset {
  statusFilter: AlertStatus | "";
  severityFilter: AlertSeverity | "";
  deviceFilter: string;
  period: string;
}

interface AlertNote {
  id: string;
  alertId: string;
  userId: string | null;
  body: string;
  createdAt: string;
}

const PERIOD_OPTIONS = [
  { value: "", label: "All time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

interface DeviceLookup {
  name: string;
  groupId: string | null;
}

const SEVERITY_SECTIONS: Array<{ key: AlertSeverity; label: string; icon: typeof AlertOctagon }> = [
  { key: "critical", label: "Critical", icon: AlertOctagon },
  { key: "warning", label: "Warning", icon: AlertTriangle },
  { key: "info", label: "Info", icon: Info },
];

export function Alerts() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<AlertStatus | "">("open");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [groupBySeverity, setGroupBySeverity] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | "">("");
  const [deviceFilter, setDeviceFilter] = useState("");
  const [period, setPeriod] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [devices, setDevices] = useState<Record<string, DeviceLookup>>({});
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [openNotesFor, setOpenNotesFor] = useState<string | null>(null);
  const [notes, setNotes] = useState<AlertNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const toast = useToast();
  const filterPresets = useFilterPresets<AlertsFilterPreset>("argus.alerts.filterPresets");

  function applyFilterPreset(f: AlertsFilterPreset) {
    setStatusFilter(f.statusFilter);
    setSeverityFilter(f.severityFilter);
    setDeviceFilter(f.deviceFilter);
    setPeriod(f.period);
  }

  async function load() {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (severityFilter) params.set("severity", severityFilter);
    if (deviceFilter) params.set("deviceId", deviceFilter);
    if (period) {
      params.set("from", new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString());
      params.set("to", new Date().toISOString());
    }
    const page = await api.get<{ items: Alert[]; total: number }>(`/alerts?${params.toString()}`);
    setAlerts(page.items);
  }

  useEffect(() => {
    load().catch(() => {});
  }, [statusFilter, severityFilter, deviceFilter, period]);

  useEffect(() => {
    api
      .get<{ items: Array<{ id: string; name: string; groupId: string | null }> }>("/devices?limit=2000")
      .then((page) => setDevices(Object.fromEntries(page.items.map((d) => [d.id, { name: d.name, groupId: d.groupId }]))))
      .catch(() => {});
    api
      .get<DeviceGroup[]>("/groups")
      .then((list) => setGroups(Object.fromEntries(list.map((g) => [g.id, g.name]))))
      .catch(() => {});
  }, []);

  async function toggleNotes(alertId: string) {
    if (openNotesFor === alertId) {
      setOpenNotesFor(null);
      return;
    }
    setOpenNotesFor(alertId);
    setNewNote("");
    try {
      setNotes(await api.get<AlertNote[]>(`/alerts/${alertId}/notes`));
    } catch {
      setNotes([]);
    }
  }

  async function addNote(alertId: string) {
    if (!newNote.trim()) return;
    setSavingNote(true);
    try {
      const note = await api.post<AlertNote>(`/alerts/${alertId}/notes`, { body: newNote.trim() });
      setNotes((prev) => [...prev, note]);
      setNewNote("");
    } catch {
      toast.error("Failed to save note.");
    } finally {
      setSavingNote(false);
    }
  }

  useWsMessages((msg) => {
    const evt = msg as { type?: string };
    if (evt.type === "alert.changed" || evt.type === "device.status_changed" || evt.type === "__reconnected") load().catch(() => {});
  });

  async function handleAck(a: Alert) {
    setBusyId(a.id);
    try {
      await api.post(`/alerts/${a.id}/ack`);
      toast.success(`Acknowledged: ${a.title}`);
      await load();
    } catch {
      // Previously uncaught — a failed ack (permissions, someone else already resolved it, a
      // network blip) left the button just silently doing nothing, with no way to tell whether it
      // worked. Same error-toast treatment addNote already gets a few lines below.
      toast.error("Failed to acknowledge — try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleResolve(a: Alert) {
    setBusyId(a.id);
    try {
      await api.post(`/alerts/${a.id}/resolve`);
      toast.success(`Resolved: ${a.title}`);
      await load();
    } catch {
      toast.error("Failed to resolve — try again.");
    } finally {
      setBusyId(null);
    }
  }

  const grouped = useMemo(() => {
    const buckets: Record<AlertSeverity, Alert[]> = { critical: [], warning: [], info: [] };
    for (const a of alerts ?? []) buckets[a.severity].push(a);
    return buckets;
  }, [alerts]);

  const flatSorted = useMemo(() => [...(alerts ?? [])].sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()), [alerts]);

  const loading = alerts === null;

  function renderAlertCard(a: Alert) {
    const device = devices[a.deviceId];
    const groupName = device?.groupId ? groups[device.groupId] : null;
    return (
      <div key={a.id} className="relative overflow-hidden rounded-lg border border-border bg-bg-surface pl-4 transition-colors duration-150 hover:border-border-strong">
        {/* Severity reads from a slim left rail + the badge, not a full-card tint — a critical row
            should be scannable at a glance without the whole list turning into a wall of red. */}
        <span className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: SEVERITY_HEX[a.severity] }} aria-hidden="true" />
        <div className="p-4 pl-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info"}>{a.severity}</Badge>
                <span className="text-xs uppercase text-text-secondary">{a.status}</span>
                {device && <span className="text-xs font-medium text-text-primary">{device.name}</span>}
                {groupName && <Badge tone="neutral">{groupName}</Badge>}
                {a.escalationStep > 0 && <Badge tone="warning">Escalated · tier {a.escalationStep + 1}</Badge>}
              </div>
              <h3 className="mt-1 font-medium text-text-primary">{a.title}</h3>
              {a.detail && <p className="text-sm text-text-secondary">{a.detail}</p>}
              <p className="mt-1 text-xs text-text-secondary">
                Opened {new Date(a.openedAt).toLocaleString()} · Last seen {new Date(a.lastSeenAt).toLocaleTimeString()}
                {a.ackedAt && ` · Acked ${new Date(a.ackedAt).toLocaleString()}`}
                {a.resolvedAt && ` · Resolved ${new Date(a.resolvedAt).toLocaleString()}`}
              </p>
            </div>
            {a.status !== "resolved" && (
              <div className="flex shrink-0 gap-2">
                {a.status === "open" && (
                  <Button variant="secondary" size="sm" disabled={busyId === a.id} onClick={() => handleAck(a)}>
                    Acknowledge
                  </Button>
                )}
                <Button size="sm" disabled={busyId === a.id} onClick={() => handleResolve(a)}>
                  Resolve
                </Button>
              </div>
            )}
          </div>
          <button
            onClick={() => toggleNotes(a.id)}
            className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs text-text-secondary transition-colors duration-150 hover:text-text-primary"
          >
            <MessageSquare size={12} aria-hidden="true" />
            {openNotesFor === a.id ? "Hide notes" : "Notes"}
          </button>
          {openNotesFor === a.id && (
            <div className="mt-2 space-y-2 rounded-md border border-border bg-bg-surface/60 p-3">
              {notes.length === 0 ? (
                <p className="text-xs text-text-secondary">No notes yet.</p>
              ) : (
                <div className="space-y-2">
                  {notes.map((n) => (
                    <div key={n.id} className="text-xs">
                      <p className="text-text-primary">{n.body}</p>
                      <p className="text-text-secondary">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  rows={2}
                  className="w-full text-xs"
                  placeholder="Add an investigation note…"
                />
                <Button size="sm" disabled={savingNote || !newNote.trim()} onClick={() => addNote(a.id)}>
                  {savingNote ? "Saving…" : "Add"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Layout title="Alerts" subtitle="Open, acknowledged, and resolved alerts across the fleet">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className={`mx-auto space-y-4 ${viewMode === "table" ? "max-w-7xl" : "max-w-5xl"}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as AlertStatus | "")}>
            <option value="">All statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </Select>
          <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as AlertSeverity | "")}>
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
          <Select value={deviceFilter} onChange={(e) => setDeviceFilter(e.target.value)}>
            <option value="">All devices</option>
            {Object.entries(devices)
              .sort((a, b) => a[1].name.localeCompare(b[1].name))
              .map(([id, d]) => (
                <option key={id} value={id}>
                  {d.name}
                </option>
              ))}
          </Select>
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        <FilterPresetsBar
          presets={filterPresets.presets}
          onApply={applyFilterPreset}
          onSave={(name) => filterPresets.save(name, { statusFilter, severityFilter, deviceFilter, period })}
          onRemove={filterPresets.remove}
        />

        {!loading && alerts.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {viewMode === "cards" ? (
              <div className="flex items-center gap-1 text-xs">
                <span className="text-text-secondary">Group by</span>
                <button
                  onClick={() => setGroupBySeverity(true)}
                  className={`cursor-pointer rounded-md px-2 py-1 font-medium transition-colors duration-150 ${groupBySeverity ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}
                >
                  Severity
                </button>
                <button
                  onClick={() => setGroupBySeverity(false)}
                  className={`cursor-pointer rounded-md px-2 py-1 font-medium transition-colors duration-150 ${!groupBySeverity ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}
                >
                  Most recent
                </button>
              </div>
            ) : (
              <span className="text-xs text-text-secondary">Click a column header to sort · {flatSorted.length} alerts</span>
            )}
            <div className="ml-auto flex items-center gap-1 rounded-md border border-border p-0.5">
              <button
                onClick={() => setViewMode("cards")}
                aria-label="Card view"
                aria-pressed={viewMode === "cards"}
                className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ${viewMode === "cards" ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}
              >
                <LayoutList size={13} aria-hidden="true" /> Cards
              </button>
              <button
                onClick={() => setViewMode("table")}
                aria-label="Table view"
                aria-pressed={viewMode === "table"}
                className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors duration-150 ${viewMode === "table" ? "bg-accent-subtle text-accent" : "text-text-secondary hover:text-text-primary"}`}
              >
                <Table2 size={13} aria-hidden="true" /> Table
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <SkeletonRows count={4} />
        ) : alerts.length === 0 ? (
          <EmptyState icon={BellOff} title="No alerts match your filters" description="Nothing needs your attention right now." />
        ) : viewMode === "table" ? (
          <AlertsTable
            rows={flatSorted.map((a) => ({
              alert: a,
              deviceName: devices[a.deviceId]?.name ?? null,
              groupName: devices[a.deviceId]?.groupId ? (groups[devices[a.deviceId]!.groupId!] ?? null) : null,
            }))}
            busyId={busyId}
            onAck={handleAck}
            onResolve={handleResolve}
          />
        ) : groupBySeverity ? (
          <div className="space-y-6">
            {SEVERITY_SECTIONS.map(({ key, label, icon: Icon }) => {
              const bucket = grouped[key];
              if (bucket.length === 0) return null;
              return (
                <div key={key}>
                  <div className="mb-2 flex items-center gap-2">
                    <Icon size={15} className={key === "critical" ? "text-critical" : key === "warning" ? "text-warning" : "text-info"} aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-text-primary">{label}</h2>
                    <span className="text-xs tabular-nums text-text-secondary">{bucket.length}</span>
                  </div>
                  <div className="space-y-2">{bucket.map(renderAlertCard)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-2">{flatSorted.map(renderAlertCard)}</div>
        )}
      </motion.div>
    </Layout>
  );
}
