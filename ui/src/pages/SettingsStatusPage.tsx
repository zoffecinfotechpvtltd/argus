import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Globe } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import type { Device, DeviceGroup } from "../api/types";
import { CopyField } from "../components/CopyField";
import { useTenantId } from "../hooks/useTenantId";
import { Badge, Button, Card, CardBody, CardHeader, FieldGroup, Input, Skeleton, useToast } from "../components/ui";
import { useDirty } from "../hooks/useDirty";

interface StatusPageConfig {
  enabled: boolean;
  title: string;
  deviceIds: string[];
  groupIds: string[];
}

const EMPTY_CONFIG: StatusPageConfig = { enabled: false, title: "", deviceIds: [], groupIds: [] };

/**
 * Public status page admin config (M6) — backend at GET/PUT /api/status-page-config
 * (src/api/routes/statusPage.ts). Picking a group here publishes every device in it; picking an
 * individual device publishes just that one, independent of its group (see
 * src/application/statusPage.ts's generatePublicStatusPage — deviceIds and groupIds are both
 * additive allowlists). The public page itself already exists at /status/:tenantId
 * (ui/src/pages/StatusPage.tsx) — this screen only edits what feeds it.
 */
export function SettingsStatusPage() {
  const [config, setConfig] = useState<StatusPageConfig | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const tenantId = useTenantId();
  const toast = useToast();
  const [dirty, markClean] = useDirty(config);

  useEffect(() => {
    Promise.all([
      api.get<StatusPageConfig>("/status-page-config").catch(() => EMPTY_CONFIG),
      api.get<{ items: Device[]; total: number }>("/devices?limit=2000").catch(() => ({ items: [], total: 0 })),
      api.get<DeviceGroup[]>("/groups").catch(() => []),
    ]).then(([c, devicePage, groupList]) => {
      setConfig(c);
      setDevices(devicePage.items);
      setGroups(groupList);
      setLoaded(true);
    });
  }, []);

  const groupIdSet = useMemo(() => new Set(config?.groupIds ?? []), [config?.groupIds]);
  const deviceIdSet = useMemo(() => new Set(config?.deviceIds ?? []), [config?.deviceIds]);
  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const exposedDeviceCount = useMemo(() => {
    if (!devices) return 0;
    const ids = new Set<string>();
    for (const d of devices) {
      if (deviceIdSet.has(d.id) || (d.groupId && groupIdSet.has(d.groupId))) ids.add(d.id);
    }
    return ids.size;
  }, [devices, deviceIdSet, groupIdSet]);

  function toggleGroup(id: string) {
    if (!config) return;
    const has = config.groupIds.includes(id);
    setConfig({ ...config, groupIds: has ? config.groupIds.filter((g) => g !== id) : [...config.groupIds, id] });
  }

  function toggleDevice(id: string) {
    if (!config) return;
    const has = config.deviceIds.includes(id);
    setConfig({ ...config, deviceIds: has ? config.deviceIds.filter((d) => d !== id) : [...config.deviceIds, id] });
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    try {
      await api.put("/status-page-config", config);
      markClean();
      toast.success("Status page settings saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save status page settings.");
    } finally {
      setSaving(false);
    }
  }

  const publicUrl = tenantId ? `${window.location.origin}/status/${tenantId}` : null;

  if (!loaded || !config || !devices) {
    return (
      <Layout title="Status Page" subtitle="A public page showing live uptime, for anyone">
        <div className="mx-auto max-w-2xl space-y-6">
          <Skeleton className="h-40 w-full" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Status Page" subtitle="A public page showing live uptime, for anyone">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="mx-auto max-w-2xl space-y-6"
      >
        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Globe size={16} className="text-accent" aria-hidden="true" />
                  Public status page
                </span>
              }
              description="Unauthenticated — anyone with the link can see it. Only device names and up/down/degraded state are ever shown; no IPs, config, or credentials."
            />
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                  className="cursor-pointer accent-accent"
                />
                Publish this status page
              </label>

              <FieldGroup label="Page title" hint="Shown at the top of the public page. Defaults to your workspace name if left blank.">
                {(ids) => (
                  <Input {...ids} className="w-full" placeholder="e.g. Acme Corp Status" value={config.title} onChange={(e) => setConfig({ ...config, title: e.target.value })} />
                )}
              </FieldGroup>

              <CopyField
                label="Public URL"
                value={publicUrl ?? "Loading…"}
                openable={!!publicUrl}
                hint={
                  config.enabled && exposedDeviceCount > 0
                    ? "Live now."
                    : !config.enabled
                      ? "Not live yet — turn on \"Publish this status page\" above."
                      : "Not live yet — select at least one device or group below."
                }
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title="What's visible"
              description="Selecting a group publishes every device in it. Selecting an individual device publishes just that one, regardless of its group."
              action={<Badge tone={exposedDeviceCount > 0 ? "accent" : "neutral"}>{exposedDeviceCount} device{exposedDeviceCount === 1 ? "" : "s"} exposed</Badge>}
            />

            {groups.length > 0 && (
              <div className="mb-4">
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">Groups</h4>
                <div className="space-y-1">
                  {groups.map((g) => (
                    <label key={g.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-primary hover:bg-bg-subtle">
                      <input type="checkbox" checked={groupIdSet.has(g.id)} onChange={() => toggleGroup(g.id)} className="cursor-pointer accent-accent" />
                      {g.name}
                      <span className="text-xs text-text-secondary">
                        {devices.filter((d) => d.groupId === g.id).length} device{devices.filter((d) => d.groupId === g.id).length === 1 ? "" : "s"}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary">Individual devices</h4>
              {devices.length === 0 ? (
                <p className="text-xs text-text-secondary">No devices yet.</p>
              ) : (
                <div className="max-h-[320px] space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                  {devices.map((d) => {
                    const coveredByGroup = !!d.groupId && groupIdSet.has(d.groupId);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${coveredByGroup ? "text-text-secondary" : "cursor-pointer text-text-primary hover:bg-bg-subtle"}`}
                      >
                        <input
                          type="checkbox"
                          checked={coveredByGroup || deviceIdSet.has(d.id)}
                          disabled={coveredByGroup}
                          onChange={() => toggleDevice(d.id)}
                          className="cursor-pointer accent-accent disabled:cursor-not-allowed"
                        />
                        <span className="min-w-0 flex-1 truncate">{d.name}</span>
                        {coveredByGroup ? (
                          <span className="shrink-0 text-2xs text-text-secondary">via {groupNameById.get(d.groupId!)}</span>
                        ) : (
                          d.groupId && <span className="shrink-0 text-2xs text-text-secondary">{groupNameById.get(d.groupId)}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {dirty && (
              <Button className="mt-4" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
          </CardBody>
        </Card>
      </motion.div>
    </Layout>
  );
}
