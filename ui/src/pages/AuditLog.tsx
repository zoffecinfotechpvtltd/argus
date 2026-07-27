import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ScrollText } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import { Button, EmptyState, Select, SkeletonRows } from "../components/ui";

const PAGE_SIZE = 200;
const PERIOD_OPTIONS = [
  { value: "", label: "All time" },
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

interface AuditEntry {
  id: number;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

interface Actor {
  id: string;
  email: string;
}

// "device.create" -> "added a device". Covers every action code emitted across src/application
// and src/api/routes (grepped for `action: "..."`) — anything not listed here still gets a
// readable fallback (see actionLabel()) instead of the raw dotted code.
const ACTION_LABELS: Record<string, string> = {
  "alert.open": "opened an alert",
  "alert.ack": "acknowledged an alert",
  "alert.resolve": "resolved an alert",
  "alert.storm_guard": "alert-storm protection kicked in",
  "auth.login": "signed in",
  "backup.download": "downloaded a backup",
  "device.create": "added a device",
  "device.update": "updated a device",
  "device.delete": "deleted a device",
  "device.import": "imported devices from a scan",
  "group.create": "created a group",
  "group.update": "updated a group",
  "group.delete": "deleted a group",
  "license.apply": "applied a license",
  "maintenance.create": "scheduled maintenance",
  "maintenance.delete": "cancelled maintenance",
  "session.revoke": "signed out a session",
  "settings.update": "updated settings",
  "setup.complete": "completed initial setup",
  "update.apply": "applied a software update",
  "user.invite": "invited a user",
  "user.password_change": "changed a password",
  "user.role_change": "changed a user's role",
};

const ENTITY_LABELS: Record<string, string> = {
  device: "device",
  device_group: "group",
  alert: "alert",
  user: "user",
  session: "session",
  settings: "settings",
  license: "license",
  maintenance: "maintenance window",
  tenant: "account",
};

function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // Fallback for anything not in the table above: "foo.bar_baz" -> "bar baz foo" reads better
  // than the raw code, without needing every action hand-written.
  const [entity, verb] = action.split(".");
  return verb ? `${verb.replace(/_/g, " ")} (${entity})` : action;
}

function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType.replace(/_/g, " ");
}

/** Turns each action's specific `detail` shape into one short sentence fragment. Anything not
 * explicitly handled still gets a readable "key value, key value" line instead of raw JSON. */
function summarizeDetail(entry: AuditEntry, deviceNameById: Record<string, string>): string | null {
  const d = entry.detail;
  if (!d) return null;

  switch (entry.action) {
    case "device.create":
      return [d.name, d.ip].filter(Boolean).join(" · ") || null;
    case "device.update": {
      const fields = Array.isArray(d.patch) ? (d.patch as string[]) : [];
      return fields.length ? `Changed: ${fields.join(", ")}` : null;
    }
    case "group.create":
    case "group.update":
      return typeof d.name === "string" ? d.name : null;
    case "alert.open": {
      const deviceName = typeof d.deviceId === "string" ? deviceNameById[d.deviceId] : undefined;
      const parts = [deviceName ?? d.deviceId, d.conditionKey, d.severity ? `(${d.severity})` : null].filter(Boolean);
      return parts.join(" · ") || null;
    }
    case "alert.resolve":
      return d.auto ? "Auto-resolved (device recovered)" : "Manually resolved";
    case "user.invite":
      return [d.email, d.role].filter(Boolean).join(" · ") || null;
    case "user.role_change":
      return typeof d.role === "string" ? `New role: ${d.role}` : null;
    case "settings.update": {
      const keys = Array.isArray(d.changedKeys) ? (d.changedKeys as string[]) : [];
      return keys.length ? `Changed: ${keys.join(", ")}` : null;
    }
    case "license.apply":
      return [d.customer, d.plan].filter(Boolean).join(" · ") || null;
    default: {
      const entries = Object.entries(d).filter(([, v]) => v != null && v !== "");
      if (entries.length === 0) return null;
      return entries.map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join(" · ");
    }
  }
}

export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [period, setPeriod] = useState("");
  const [actors, setActors] = useState<Record<string, string>>({});
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [loadingMore, setLoadingMore] = useState(false);

  function buildParams(offset: number) {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (action) params.set("action", action);
    if (actorId) params.set("userId", actorId);
    if (period) {
      params.set("from", new Date(Date.now() - Number(period) * 24 * 60 * 60 * 1000).toISOString());
      params.set("to", new Date().toISOString());
    }
    return params;
  }

  async function load() {
    const page = await api.get<{ items: AuditEntry[]; total: number }>(`/audit?${buildParams(0).toString()}`);
    setEntries(page.items);
    setTotal(page.total);
  }

  async function loadMore() {
    if (!entries) return;
    setLoadingMore(true);
    try {
      const page = await api.get<{ items: AuditEntry[]; total: number }>(`/audit?${buildParams(entries.length).toString()}`);
      setEntries([...entries, ...page.items]);
      setTotal(page.total);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load().catch(() => {});
  }, [action, actorId, period]);

  useEffect(() => {
    api
      .get<Actor[]>("/users")
      .then((list) => setActors(Object.fromEntries(list.map((u) => [u.id, u.email]))))
      .catch(() => {});
    api
      .get<{ items: Array<{ id: string; name: string }> }>("/devices?limit=2000")
      .then((page) => setDeviceNames(Object.fromEntries(page.items.map((d) => [d.id, d.name]))))
      .catch(() => {});
  }, []);

  const actionOptions = Object.keys(ACTION_LABELS).sort();

  return (
    <Layout title="Audit Log" subtitle="Who did what, across every device, group, and setting">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-4xl space-y-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto">
            <option value="">All actions</option>
            {actionOptions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
          <Select value={actorId} onChange={(e) => setActorId(e.target.value)} className="w-auto">
            <option value="">All users</option>
            {Object.entries(actors)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, email]) => (
                <option key={id} value={id}>
                  {email}
                </option>
              ))}
          </Select>
          <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-auto">
            {PERIOD_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        {entries === null ? (
          <SkeletonRows count={6} />
        ) : entries.length === 0 ? (
          <EmptyState icon={ScrollText} title="No activity matches" description={action || actorId || period ? "Try a different filter." : undefined} />
        ) : (
          <div>
            {/* A timeline, not a table — per steps/05-page-specs.md §8: "like Vercel's deployment
                feed." The connecting rule is the only per-entry decoration; everything else is
                plain text so it stays scannable at high entry-count. */}
            <div className="relative">
              {entries.length > 1 && <div className="absolute bottom-3 left-[5px] top-2 w-px bg-border" aria-hidden="true" />}
              <div className="space-y-5">
                {entries.map((e) => {
                  const detail = summarizeDetail(e, deviceNames);
                  const who = e.userId ? (actors[e.userId] ?? "a user") : "System";
                  return (
                    <div key={e.id} className="relative flex gap-3">
                      <span className="relative z-10 mt-1.5 h-[11px] w-[11px] shrink-0 rounded-full border-2 border-bg-canvas bg-border-strong" aria-hidden="true" />
                      <div className="min-w-0 flex-1 pb-0.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                          <p className="text-sm text-text-primary">
                            <span className="font-medium">{who}</span> {actionLabel(e.action)}
                            <span className="text-text-secondary"> — {entityLabel(e.entityType)}</span>
                          </p>
                          <span className="shrink-0 font-mono text-2xs text-text-muted">{new Date(e.createdAt).toLocaleString()}</span>
                        </div>
                        {detail && <p className="mt-0.5 text-xs text-text-secondary">{detail}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {entries.length < total && (
              <div className="mt-5 border-t border-border pt-4 text-center">
                <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? "Loading…" : `Load more (${total - entries.length} remaining)`}
                </Button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </Layout>
  );
}
