import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, Download, Layers, ListFilter, Plus, Router, Search, Trash2, Upload, X, Zap } from "lucide-react";
import { Layout } from "../components/Layout";
import { StatusDot } from "../components/StatusDot";
import { api, ApiError } from "../api/client";
import type { Device, DeviceGroup, DeviceType, EscalationStep } from "../api/types";
import { DEVICE_TYPE_LABELS } from "../api/types";
import { Badge, Button, Card, CardHeader, EmptyState, FieldGroup, Input, Modal, Select, SkeletonRows, useConfirm, useToast } from "../components/ui";
import { parseDeviceCsv, devicesToCsv, downloadCsv } from "../lib/deviceCsv";
import { FilterPresetsBar } from "../components/FilterPresetsBar";
import { useFilterPresets } from "../hooks/useFilterPresets";
import { OnCallRotationEditor } from "../components/OnCallRotationEditor";

/** Extends the base Device with the live status fields `withStatus=true` adds to the /devices
 * response (same shape Dashboard.tsx's DeviceRow consumes) — purely additive, so every existing
 * consumer of a plain Device still works unchanged; only the table's new status column reads it. */
type DeviceRow = Device & { state?: string | null };

interface InventoryFilterPreset {
  search: string;
  typeFilter: string;
  groupFilter: string;
  tagFilter: string;
}

interface DirectoryUser {
  id: string;
  email: string;
  disabled: boolean;
}

const ESCALATION_DEFAULT_MINUTES = 10;

const DEVICE_TYPES = Object.keys(DEVICE_TYPE_LABELS) as DeviceType[];

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Client-side mirror of the server's RFC1918 check (@domain/ssrfGuard.ts), used only to decide
 * whether to show the "public IP" hint below — the server remains the source of truth for what's
 * actually allowed. A public firewall/WAN IP is a fully supported monitoring target here; the hint
 * just calls out that ICMP is commonly blocked on the public internet so the device won't falsely
 * read as down without a TCP/HTTP check enabled too. */
function isPublicIpv4(ip: string): boolean {
  const m = IPV4_RE.exec(ip);
  if (!m) return false;
  const octets = m.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;
  if (a === 10) return false;
  if (a === 172 && b! >= 16 && b! <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 127) return false;
  return true;
}

interface DeviceForm {
  id?: string;
  name: string;
  ip: string;
  type: DeviceType;
  groupId: string;
  intervalSec: number;
  hasHttp: boolean;
  hasHttps: boolean;
  snmpVersion: "1" | "2c" | "3";
  snmpCommunity: string;
  snmpV3Username: string;
  snmpV3SecurityLevel: "noAuthNoPriv" | "authNoPriv" | "authPriv";
  snmpV3AuthProtocol: "md5" | "sha" | "sha256";
  snmpV3AuthKey: string;
  snmpV3PrivProtocol: "des" | "aes";
  snmpV3PrivKey: string;
  vendorApiVendor: "" | "fortigate";
  vendorApiToken: string;
  vendorApiPort: string;
  vendorApiVerifyTls: boolean;
  location: string;
  tagsText: string;
  uplinkDeviceId: string;
  criticalAsset: boolean;
}

/** Mirrors DEFAULT_CRITICAL_TYPES in src/application/devices/deviceUseCases.ts — pre-checks the
 * box on create so the common case (adding a camera/firewall) needs no extra click, while still
 * leaving it fully overridable per device. */
const DEFAULT_CRITICAL_TYPES = new Set<DeviceType>(["camera", "firewall"]);

const emptyForm: DeviceForm = {
  name: "",
  ip: "",
  type: "unknown",
  groupId: "",
  intervalSec: 60,
  hasHttp: false,
  hasHttps: false,
  snmpVersion: "2c",
  snmpCommunity: "",
  snmpV3Username: "",
  snmpV3SecurityLevel: "authPriv",
  snmpV3AuthProtocol: "sha",
  snmpV3AuthKey: "",
  snmpV3PrivProtocol: "aes",
  snmpV3PrivKey: "",
  vendorApiVendor: "",
  vendorApiToken: "",
  vendorApiPort: "",
  vendorApiVerifyTls: true,
  location: "",
  tagsText: "",
  uplinkDeviceId: "",
  criticalAsset: false,
};

function parseTagsText(text: string): string[] {
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function Inventory() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<DeviceForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [users, setUsers] = useState<DirectoryUser[] | null>(null);
  const [usersError, setUsersError] = useState(false);
  const [escalationGroup, setEscalationGroup] = useState<DeviceGroup | null>(null);
  const [escalationChain, setEscalationChain] = useState<EscalationStep[]>([]);
  const [oncallGroup, setOncallGroup] = useState<DeviceGroup | null>(null);
  const [savingEscalation, setSavingEscalation] = useState(false);
  const [tagFilter, setTagFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const filterPresets = useFilterPresets<InventoryFilterPreset>("argus.inventory.filterPresets");

  function applyFilterPreset(f: InventoryFilterPreset) {
    setSearch(f.search);
    setTypeFilter(f.typeFilter);
    setGroupFilter(f.groupFilter);
    setTagFilter(f.tagFilter);
  }

  async function loadDevices() {
    const params = new URLSearchParams({ withStatus: "true" });
    if (search) params.set("search", search);
    if (typeFilter) params.set("type", typeFilter);
    if (groupFilter) params.set("groupId", groupFilter);
    const page = await api.get<{ items: DeviceRow[]; total: number }>(`/devices?${params.toString()}`);
    setDevices(page.items);
  }

  async function loadGroups() {
    setGroups(await api.get<DeviceGroup[]>("/groups"));
  }

  async function loadUsers() {
    try {
      setUsers(await api.get<DirectoryUser[]>("/users"));
    } catch {
      // Listing users is admin-only; an operator can still view/reorder an existing escalation
      // chain, just can't pick new contacts from a directory they don't have access to.
      setUsersError(true);
    }
  }

  useEffect(() => {
    loadDevices().catch(() => {});
  }, [search, typeFilter, groupFilter]);

  useEffect(() => {
    loadGroups().catch(() => {});
    loadUsers().catch(() => {});
  }, []);

  function openCreate() {
    setForm(emptyForm);
    setError(null);
    setDrawerOpen(true);
  }

  function openEdit(d: Device) {
    setForm({
      ...emptyForm, // SNMP secrets are never sent back from the API — v2c/v3 fields start blank/default, "Leave blank to keep unchanged"
      id: d.id,
      name: d.name,
      ip: d.ip,
      type: d.type,
      groupId: d.groupId ?? "",
      intervalSec: d.intervalSec,
      location: d.location ?? "",
      tagsText: d.tags.join(", "),
      uplinkDeviceId: d.uplinkDeviceId ?? "",
      criticalAsset: d.criticalAsset,
    });
    setError(null);
    setDrawerOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        ip: form.ip,
        type: form.type,
        groupId: form.groupId || null,
        intervalSec: form.intervalSec,
        hasHttp: form.hasHttp,
        hasHttps: form.hasHttps,
        ...(form.snmpVersion === "3"
          ? form.snmpV3Username
            ? {
                snmpV3: {
                  username: form.snmpV3Username,
                  securityLevel: form.snmpV3SecurityLevel,
                  authProtocol: form.snmpV3SecurityLevel === "noAuthNoPriv" ? undefined : form.snmpV3AuthProtocol,
                  authKey: form.snmpV3SecurityLevel === "noAuthNoPriv" ? undefined : form.snmpV3AuthKey || undefined,
                  privProtocol: form.snmpV3SecurityLevel === "authPriv" ? form.snmpV3PrivProtocol : undefined,
                  privKey: form.snmpV3SecurityLevel === "authPriv" ? form.snmpV3PrivKey || undefined : undefined,
                },
              }
            : {}
          : { snmpCommunity: form.snmpCommunity || undefined, snmpVersion: form.snmpVersion }),
        ...(form.vendorApiVendor === "fortigate" && form.vendorApiToken
          ? {
              vendorApi: {
                vendor: form.vendorApiVendor,
                apiToken: form.vendorApiToken,
                port: form.vendorApiPort ? Number(form.vendorApiPort) : undefined,
                verifyTls: form.vendorApiVerifyTls,
              },
            }
          : {}),
        location: form.location || null,
        tags: parseTagsText(form.tagsText),
        uplinkDeviceId: form.uplinkDeviceId || null,
        criticalAsset: form.criticalAsset,
      };
      if (form.id) {
        await api.patch(`/devices/${form.id}`, payload);
        toast.success(`${form.name} updated.`);
      } else {
        await api.post("/devices", payload);
        toast.success(`${form.name} added.`);
      }
      setDrawerOpen(false);
      await loadDevices();
    } catch (err) {
      if (err instanceof ApiError && err.code === "DUPLICATE_IP") setError("A device with this IP already exists.");
      else if (err instanceof ApiError && (err.code === "LICENSE_LIMIT_EXCEEDED" || err.code === "TENANT_LIMIT_EXCEEDED")) setError(err.message);
      else setError("Failed to save device.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(d: Device) {
    const ok = await confirm({
      title: "Delete device?",
      message: (
        <>
          Delete <span className="font-medium text-text-primary">{d.name}</span> ({d.ip})? This cannot be undone — its history and checks go with it.
        </>
      ),
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/devices/${d.id}`);
    toast.success(`${d.name} deleted.`);
    await loadDevices();
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulkSetEnabled(enabled: boolean) {
    setBulkBusy(true);
    try {
      await Promise.all([...selected].map((id) => api.patch(`/devices/${id}`, { enabled })));
      toast.success(`${enabled ? "Enabled" : "Disabled"} ${selected.size} device${selected.size === 1 ? "" : "s"}.`);
      setSelected(new Set());
      await loadDevices();
    } catch {
      toast.error("Some devices failed to update.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAssignGroup() {
    if (!bulkGroupId) return;
    setBulkBusy(true);
    try {
      await Promise.all([...selected].map((id) => api.patch(`/devices/${id}`, { groupId: bulkGroupId || null })));
      toast.success(`Moved ${selected.size} device${selected.size === 1 ? "" : "s"} to a group.`);
      setSelected(new Set());
      setBulkGroupId("");
      await loadDevices();
    } catch {
      toast.error("Some devices failed to update.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    const ok = await confirm({
      title: "Delete devices?",
      message: `Delete ${selected.size} selected device${selected.size === 1 ? "" : "s"}? This cannot be undone.`,
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setBulkBusy(true);
    try {
      await Promise.all([...selected].map((id) => api.delete(`/devices/${id}`)));
      toast.success(`Deleted ${selected.size} device${selected.size === 1 ? "" : "s"}.`);
      setSelected(new Set());
      await loadDevices();
    } catch {
      toast.error("Some devices failed to delete.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleExportCsv() {
    if (!devices) return;
    downloadCsv("argus-inventory.csv", devicesToCsv(devices, groups));
  }

  async function handleImportCsv(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const rows = parseDeviceCsv(text, groups);
      let created = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await api.post("/devices", row);
          created++;
        } catch {
          failed++;
        }
      }
      toast.success(`Imported ${created} device${created === 1 ? "" : "s"}${failed > 0 ? `, ${failed} failed (likely duplicate IPs)` : ""}.`);
      await loadDevices();
    } catch {
      toast.error("Could not read that CSV file.");
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  }

  async function handleAddGroup() {
    if (!newGroupName.trim()) return;
    await api.post("/groups", { name: newGroupName.trim() });
    setNewGroupName("");
    await loadGroups();
  }

  async function handleDeleteGroup(g: DeviceGroup) {
    const ok = await confirm({
      title: "Delete group?",
      message: (
        <>
          Delete <span className="font-medium text-text-primary">{g.name}</span>? Its escalation chain goes with it, and devices in this group become
          ungrouped.
        </>
      ),
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/groups/${g.id}`);
    toast.success(`${g.name} deleted.`);
    await loadGroups();
  }

  function openEscalationEditor(g: DeviceGroup) {
    setEscalationGroup(g);
    setEscalationChain(g.escalationChain.map((step) => ({ ...step })));
  }

  function addEscalationTier() {
    const fallbackUserId = users?.find((u) => !u.disabled)?.id ?? "";
    setEscalationChain((chain) => [...chain, { userId: fallbackUserId, afterMinutes: ESCALATION_DEFAULT_MINUTES * (chain.length + 1) }]);
  }

  function updateEscalationTier(index: number, patch: Partial<EscalationStep>) {
    setEscalationChain((chain) => chain.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function setEscalationTierTarget(index: number, mode: "user" | "onCall") {
    if (mode === "onCall") {
      updateEscalationTier(index, { onCall: true, userId: undefined });
    } else {
      const fallbackUserId = users?.find((u) => !u.disabled)?.id ?? "";
      updateEscalationTier(index, { onCall: false, userId: fallbackUserId });
    }
  }

  function removeEscalationTier(index: number) {
    setEscalationChain((chain) => chain.filter((_, i) => i !== index));
  }

  async function saveEscalationChain() {
    if (!escalationGroup) return;
    setSavingEscalation(true);
    try {
      await api.patch(`/groups/${escalationGroup.id}`, { escalationChain });
      toast.success(`Escalation chain saved for ${escalationGroup.name}.`);
      setEscalationGroup(null);
      await loadGroups();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save escalation chain.");
    } finally {
      setSavingEscalation(false);
    }
  }

  const loading = devices === null;

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices ?? []) for (const t of d.tags) set.add(t);
    return [...set].sort();
  }, [devices]);

  const groupDeviceCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of devices ?? []) {
      const key = d.groupId ?? "__ungrouped";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [devices]);

  const tagFilteredDevices = useMemo(() => {
    if (!devices) return null;
    if (!tagFilter) return devices;
    return devices.filter((d) => d.tags.includes(tagFilter));
  }, [devices, tagFilter]);

  const groupedDevices = useMemo(() => {
    if (!tagFilteredDevices) return [];
    const byGroup = new Map<string, Device[]>();
    for (const d of tagFilteredDevices) {
      const key = d.groupId ?? "__ungrouped";
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(d);
    }
    const ordered: Array<{ id: string; name: string; devices: Device[] }> = [];
    for (const g of groups) {
      const bucket = byGroup.get(g.id);
      if (bucket?.length) ordered.push({ id: g.id, name: g.name, devices: bucket });
    }
    const ungrouped = byGroup.get("__ungrouped");
    if (ungrouped?.length) ordered.push({ id: "__ungrouped", name: "Ungrouped", devices: ungrouped });
    return ordered;
  }, [tagFilteredDevices, groups]);

  const ipHint = isPublicIpv4(form.ip)
    ? "Public IP — reachable over the internet. Many firewalls block ICMP ping; enable HTTP/HTTPS below so this device isn't falsely reported down."
    : undefined;

  const activeFilterChips = [
    typeFilter && { key: "type", label: DEVICE_TYPE_LABELS[typeFilter as DeviceType], clear: () => setTypeFilter("") },
    groupFilter && { key: "group", label: groups.find((g) => g.id === groupFilter)?.name ?? groupFilter, clear: () => setGroupFilter("") },
    tagFilter && { key: "tag", label: tagFilter, clear: () => setTagFilter("") },
  ].filter((c): c is { key: string; label: string; clear: () => void } => !!c);

  return (
    <Layout
      title="Inventory"
      subtitle="All monitored devices, groups & escalation chains"
      action={
        <>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportCsv(file);
            }}
          />
          <Button variant="secondary" size="sm" onClick={() => csvInputRef.current?.click()} disabled={importing}>
            <Upload size={14} aria-hidden="true" /> {importing ? "Importing…" : "Import CSV"}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExportCsv} disabled={!devices || devices.length === 0}>
            <Download size={14} aria-hidden="true" /> Export CSV
          </Button>
          <Button onClick={openCreate}>
            <Plus size={15} aria-hidden="true" />
            Add device
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Search-first toolbar with a single "Filters" toggle rather than three permanently-visible
            selects — Tailscale's admin console Machines page (tailscale.com/docs/.../filter) uses
            this same search+filters split, with active filters surfaced as removable chips below
            the search bar instead of staying buried in open dropdowns. */}
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <Input
                placeholder="Search name or IP…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 pl-9"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFiltersOpen((o) => !o)}
              className={activeFilterChips.length > 0 ? "border-accent/40 text-accent" : ""}
            >
              <ListFilter size={14} aria-hidden="true" />
              Filters
              {activeFilterChips.length > 0 && (
                <span className="ml-0.5 rounded-full bg-accent/15 px-1.5 py-0 text-2xs font-semibold text-accent">{activeFilterChips.length}</span>
              )}
            </Button>
          </div>

          {filtersOpen && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-border bg-bg-subtle/40 p-3">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-auto">
                <option value="">All types</option>
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DEVICE_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <Select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className="w-auto">
                <option value="">All groups</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
              {allTags.length > 0 && (
                <Select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="w-auto">
                  <option value="">All tags</option>
                  {allTags.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}

          {activeFilterChips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  onClick={chip.clear}
                  className="flex cursor-pointer items-center gap-1 rounded-full border border-accent/30 bg-accent/10 py-0.5 pl-2.5 pr-1.5 text-2xs font-medium text-accent transition-colors duration-150 hover:bg-accent/15"
                >
                  {chip.label}
                  <X size={11} aria-hidden="true" />
                </button>
              ))}
              <button
                onClick={() => {
                  setTypeFilter("");
                  setGroupFilter("");
                  setTagFilter("");
                }}
                className="cursor-pointer text-2xs text-text-secondary hover:text-text-primary"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        <FilterPresetsBar
          presets={filterPresets.presets}
          onApply={applyFilterPreset}
          onSave={(name) => filterPresets.save(name, { search, typeFilter, groupFilter, tagFilter })}
          onRemove={filterPresets.remove}
        />

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
            <span className="text-xs font-medium text-text-primary">
              {selected.size} selected
            </span>
            <Select value={bulkGroupId} onChange={(e) => setBulkGroupId(e.target.value)} className="py-1 text-xs">
              <option value="">Move to group…</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" onClick={bulkAssignGroup} disabled={!bulkGroupId || bulkBusy}>
              Move
            </Button>
            <Button size="sm" variant="secondary" onClick={() => bulkSetEnabled(true)} disabled={bulkBusy}>
              Enable
            </Button>
            <Button size="sm" variant="secondary" onClick={() => bulkSetEnabled(false)} disabled={bulkBusy}>
              Disable
            </Button>
            <Button size="sm" variant="destructive" onClick={bulkDelete} disabled={bulkBusy}>
              <Trash2 size={13} aria-hidden="true" /> Delete
            </Button>
            <button onClick={() => setSelected(new Set())} className="cursor-pointer text-xs text-text-secondary hover:text-text-primary">
              Clear selection
            </button>
          </div>
        )}

        {loading ? (
          <SkeletonRows count={6} />
        ) : devices.length === 0 ? (
          <EmptyState
            icon={Router}
            title="No devices match your filters"
            description="Add one manually, or run a Discovery scan to find devices on your network automatically."
            action={
              <Button variant="secondary" size="sm" onClick={openCreate}>
                <Plus size={14} aria-hidden="true" /> Add device
              </Button>
            }
          />
        ) : (
          <div className="space-y-5">
            {groupedDevices.map((bucket) => (
              <div key={bucket.id}>
                {groupedDevices.length > 1 && (
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary">{bucket.name}</h3>
                    <span className="text-xs text-text-secondary">
                      {bucket.devices.length} device{bucket.devices.length === 1 ? "" : "s"}
                    </span>
                  </div>
                )}
                <DeviceTable devices={bucket.devices} onEdit={openEdit} onDelete={handleDelete} selected={selected} onToggleSelect={toggleSelected} />
              </div>
            ))}
          </div>
        )}

        <Card className="p-5">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <Layers size={16} className="text-accent" aria-hidden="true" />
                Groups &amp; escalation hierarchy
              </span>
            }
            description={
              <>
                Each group can have a tiered alert chain — Tier 1 is notified first, Tier 2 after a delay if still unacknowledged, and so on. Contacts must
                first be invited as users (with a name and email) under{" "}
                <Link to="/admin/users" className="text-accent hover:underline">
                  Admin → Users
                </Link>
                .
              </>
            }
          />
          {groups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-secondary">
              No groups yet — add one below to start organizing devices and setting up escalation.
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-subtle/40 px-3.5 py-2.5 transition-colors duration-150 hover:border-foreground-muted/30"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Badge tone="neutral">{g.name}</Badge>
                    <span className="text-xs text-text-secondary">
                      {groupDeviceCounts.get(g.id) ?? 0} device{(groupDeviceCounts.get(g.id) ?? 0) === 1 ? "" : "s"}
                    </span>
                    <span className="text-text-secondary/40">·</span>
                    <span className={`text-xs ${g.escalationChain.length === 0 ? "text-text-secondary" : "text-text-primary"}`}>
                      {g.escalationChain.length === 0 ? "No escalation tiers configured" : `${g.escalationChain.length} tier${g.escalationChain.length === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => openEscalationEditor(g)}
                      className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/10"
                    >
                      Edit escalation
                    </button>
                    <button
                      onClick={() => setOncallGroup(g)}
                      className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/10"
                    >
                      <CalendarClock size={12} aria-hidden="true" />
                      On-call rotation
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(g)}
                      aria-label={`Delete group ${g.name}`}
                      className="cursor-pointer rounded-md p-1.5 text-text-secondary transition-colors duration-150 hover:bg-critical-subtle hover:text-critical"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Input placeholder="New group name" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="w-48" />
            <Button variant="secondary" size="sm" onClick={handleAddGroup} disabled={!newGroupName.trim()}>
              <Plus size={13} aria-hidden="true" /> Add group
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={!!escalationGroup}
        onClose={() => setEscalationGroup(null)}
        title={escalationGroup ? `Escalation hierarchy — ${escalationGroup.name}` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEscalationGroup(null)}>
              Cancel
            </Button>
            <Button onClick={saveEscalationChain} disabled={savingEscalation}>
              {savingEscalation ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <p className="mb-3">
          An unacknowledged alert on a device in this group notifies its assigned owner immediately, then walks down these tiers in order — each tier
          fires once its delay has elapsed, unless someone has already acknowledged the alert.
        </p>
        {usersError && (
          <p className="mb-3 rounded-md border border-warning/30 bg-warning-subtle px-3 py-2 text-xs text-warning">
            Could not load the user directory (admin-only) — you can still remove or reorder existing tiers, but adding a new contact requires an admin.
          </p>
        )}
        {users && users.length === 0 && (
          <p className="mb-3 rounded-md border border-border bg-bg-subtle/60 px-3 py-2 text-xs">
            No other users yet —{" "}
            <Link to="/admin/users" className="text-accent hover:underline">
              invite Tier 1/2/3 contacts by name and email
            </Link>{" "}
            before assigning them here.
          </p>
        )}
        <div className="relative space-y-4">
          {escalationChain.length > 1 && (
            <div className="absolute bottom-6 left-[15px] top-6 w-px bg-gradient-to-b from-accent/50 via-border to-transparent" aria-hidden="true" />
          )}
          {escalationChain.map((step, i) => (
            <div key={i} className="relative flex gap-3">
              <span className="relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-bg-subtle font-mono text-xs font-bold text-accent">
                {i + 1}
              </span>
              <div className="flex-1 rounded-lg border border-border bg-bg-subtle/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary">
                    Tier {i + 1}
                    {i > 0 && <span className="font-normal"> — if Tier {i} hasn't acknowledged</span>}
                  </span>
                  <button
                    onClick={() => removeEscalationTier(i)}
                    aria-label={`Remove tier ${i + 1}`}
                    className="cursor-pointer rounded p-1 text-text-secondary transition-colors duration-150 hover:bg-critical-subtle hover:text-critical"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
                <div className="mb-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEscalationTierTarget(i, "user")}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 text-2xs font-medium transition-colors duration-150 ${
                      !step.onCall ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-text-secondary hover:bg-bg-subtle"
                    }`}
                  >
                    Specific person
                  </button>
                  <button
                    type="button"
                    onClick={() => setEscalationTierTarget(i, "onCall")}
                    className={`cursor-pointer rounded-md border px-2.5 py-1 text-2xs font-medium transition-colors duration-150 ${
                      step.onCall ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-text-secondary hover:bg-bg-subtle"
                    }`}
                  >
                    Whoever's on call
                  </button>
                </div>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {step.onCall ? (
                      <FieldGroup label="Contact" hint="Resolved at the moment this tier fires, from the group's on-call rotation.">
                        {(ids) => (
                          <p {...ids} className="rounded-md border border-border bg-bg-subtle/60 px-3 py-2 text-xs text-text-secondary">
                            Whoever's on call —{" "}
                            <button
                              type="button"
                              onClick={() => {
                                setEscalationGroup(null);
                                setOncallGroup(escalationGroup);
                              }}
                              className="cursor-pointer text-accent hover:underline"
                            >
                              set up the rotation
                            </button>
                          </p>
                        )}
                      </FieldGroup>
                    ) : (
                      <FieldGroup label="Contact">
                        {(ids) => (
                          <Select {...ids} className="w-full" value={step.userId ?? ""} onChange={(e) => updateEscalationTier(i, { userId: e.target.value })}>
                            <option value="">Select a contact…</option>
                            {users?.map((u) => (
                              <option key={u.id} value={u.id} disabled={u.disabled}>
                                {u.email}
                                {u.disabled ? " (disabled)" : ""}
                              </option>
                            ))}
                          </Select>
                        )}
                      </FieldGroup>
                    )}
                  </div>
                  <FieldGroup label="After (min)">
                    {(ids) => (
                      <Input
                        {...ids}
                        type="number"
                        min={1}
                        max={1440}
                        className="w-20"
                        value={step.afterMinutes}
                        onChange={(e) => updateEscalationTier(i, { afterMinutes: Number(e.target.value) })}
                      />
                    )}
                  </FieldGroup>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={addEscalationTier} disabled={!users || users.length === 0}>
          <Plus size={14} aria-hidden="true" /> Add tier
        </Button>
      </Modal>

      <OnCallRotationEditor group={oncallGroup} users={users} onClose={() => setOncallGroup(null)} />

      <Modal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={form.id ? "Edit device" : "Add device"}
        variant="slide-over"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name || !form.ip}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FieldGroup label="Name">
            {(ids) => (
              <Input
                {...ids}
                name="device-name"
                autoComplete="off"
                className="w-full"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            )}
          </FieldGroup>
          <FieldGroup label="IP address" hint={ipHint}>
            {(ids) => (
              <Input
                {...ids}
                name="device-ip"
                autoComplete="off"
                className="w-full font-mono"
                value={form.ip}
                disabled={!!form.id}
                onChange={(e) => setForm({ ...form, ip: e.target.value })}
              />
            )}
          </FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="Type">
              {(ids) => (
                <Select
                  {...ids}
                  className="w-full"
                  value={form.type}
                  onChange={(e) => {
                    const type = e.target.value as DeviceType;
                    // Only auto-flip the default on create — editing an existing device must never
                    // silently override a criticality the admin already set deliberately.
                    setForm({ ...form, type, criticalAsset: form.id ? form.criticalAsset : DEFAULT_CRITICAL_TYPES.has(type) });
                  }}
                >
                  {DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DEVICE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </FieldGroup>
            <FieldGroup label="Group">
              {(ids) => (
                <Select {...ids} className="w-full" value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                  <option value="">No group</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              )}
            </FieldGroup>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldGroup label="Location (optional)">
              {(ids) => (
                <Input {...ids} className="w-full" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Building 2, Rack 4" />
              )}
            </FieldGroup>
            <FieldGroup label="Tags (comma-separated)">
              {(ids) => (
                <Input {...ids} className="w-full" value={form.tagsText} onChange={(e) => setForm({ ...form, tagsText: e.target.value })} placeholder="e.g. site-hq, core" />
              )}
            </FieldGroup>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={form.criticalAsset}
              onChange={(e) => setForm({ ...form, criticalAsset: e.target.checked })}
              className="cursor-pointer accent-accent"
            />
            Critical asset — page instantly on DOWN, skip storm grouping and hourly rate-limiting
          </label>
          <FieldGroup label="Uplink device (optional)" hint="If this device sits behind another (e.g. a core switch), alerts on it are held back while its uplink is down.">
            {(ids) => (
              <Select {...ids} className="w-full" value={form.uplinkDeviceId} onChange={(e) => setForm({ ...form, uplinkDeviceId: e.target.value })}>
                <option value="">No uplink</option>
                {(devices ?? []).filter((d) => d.id !== form.id).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.ip})
                  </option>
                ))}
              </Select>
            )}
          </FieldGroup>
          <FieldGroup label="Poll interval (seconds)">
            {(ids) => (
              <Input
                {...ids}
                className="w-full"
                type="number"
                min={10}
                value={form.intervalSec}
                onChange={(e) => setForm({ ...form, intervalSec: Number(e.target.value) })}
              />
            )}
          </FieldGroup>
          <div className="flex gap-4 text-sm text-text-secondary">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={form.hasHttp} onChange={(e) => setForm({ ...form, hasHttp: e.target.checked })} className="cursor-pointer accent-accent" />
              Has HTTP (port 80)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={form.hasHttps} onChange={(e) => setForm({ ...form, hasHttps: e.target.checked })} className="cursor-pointer accent-accent" />
              Has HTTPS (443)
            </label>
          </div>
          <FieldGroup label="SNMP version (optional)">
            {(ids) => (
              <Select
                {...ids}
                className="w-full"
                value={form.snmpVersion}
                onChange={(e) => setForm({ ...form, snmpVersion: e.target.value as DeviceForm["snmpVersion"] })}
              >
                <option value="2c">v2c</option>
                <option value="1">v1</option>
                <option value="3">v3 (auth/priv)</option>
              </Select>
            )}
          </FieldGroup>
          {form.snmpVersion === "3" ? (
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Username">
                {(ids) => (
                  <Input
                    {...ids}
                    className="w-full"
                    value={form.snmpV3Username}
                    onChange={(e) => setForm({ ...form, snmpV3Username: e.target.value })}
                    placeholder={form.id ? "Leave blank to keep unchanged" : "netmon"}
                  />
                )}
              </FieldGroup>
              <FieldGroup label="Security level">
                {(ids) => (
                  <Select
                    {...ids}
                    className="w-full"
                    value={form.snmpV3SecurityLevel}
                    onChange={(e) => setForm({ ...form, snmpV3SecurityLevel: e.target.value as DeviceForm["snmpV3SecurityLevel"] })}
                  >
                    <option value="authPriv">authPriv</option>
                    <option value="authNoPriv">authNoPriv</option>
                    <option value="noAuthNoPriv">noAuthNoPriv</option>
                  </Select>
                )}
              </FieldGroup>
              {form.snmpV3SecurityLevel !== "noAuthNoPriv" && (
                <>
                  <FieldGroup label="Auth protocol">
                    {(ids) => (
                      <Select
                        {...ids}
                        className="w-full"
                        value={form.snmpV3AuthProtocol}
                        onChange={(e) => setForm({ ...form, snmpV3AuthProtocol: e.target.value as DeviceForm["snmpV3AuthProtocol"] })}
                      >
                        <option value="sha">SHA</option>
                        <option value="sha256">SHA256</option>
                        <option value="md5">MD5</option>
                      </Select>
                    )}
                  </FieldGroup>
                  <FieldGroup label="Auth key">
                    {(ids) => (
                      <Input
                        {...ids}
                        type="password"
                        className="w-full"
                        value={form.snmpV3AuthKey}
                        onChange={(e) => setForm({ ...form, snmpV3AuthKey: e.target.value })}
                        placeholder={form.id ? "Leave blank to keep unchanged" : "min. 8 characters"}
                      />
                    )}
                  </FieldGroup>
                </>
              )}
              {form.snmpV3SecurityLevel === "authPriv" && (
                <>
                  <FieldGroup label="Privacy protocol">
                    {(ids) => (
                      <Select
                        {...ids}
                        className="w-full"
                        value={form.snmpV3PrivProtocol}
                        onChange={(e) => setForm({ ...form, snmpV3PrivProtocol: e.target.value as DeviceForm["snmpV3PrivProtocol"] })}
                      >
                        <option value="aes">AES</option>
                        <option value="des">DES</option>
                      </Select>
                    )}
                  </FieldGroup>
                  <FieldGroup label="Privacy key">
                    {(ids) => (
                      <Input
                        {...ids}
                        type="password"
                        className="w-full"
                        value={form.snmpV3PrivKey}
                        onChange={(e) => setForm({ ...form, snmpV3PrivKey: e.target.value })}
                        placeholder={form.id ? "Leave blank to keep unchanged" : "min. 8 characters"}
                      />
                    )}
                  </FieldGroup>
                </>
              )}
            </div>
          ) : (
            <FieldGroup label="SNMP community (optional)">
              {(ids) => (
                <Input
                  {...ids}
                  className="w-full"
                  value={form.snmpCommunity}
                  onChange={(e) => setForm({ ...form, snmpCommunity: e.target.value })}
                  placeholder={form.id ? "Leave blank to keep unchanged" : "public"}
                />
              )}
            </FieldGroup>
          )}
          <FieldGroup label="Vendor API (optional)" hint="For a FortiGate firewall — polls CPU/mem/session/VPN-tunnel metrics and firmware/serial/HA role over its REST API, in addition to any SNMP/HTTP checks above.">
            {(ids) => (
              <Select
                {...ids}
                className="w-full"
                value={form.vendorApiVendor}
                onChange={(e) => setForm({ ...form, vendorApiVendor: e.target.value as DeviceForm["vendorApiVendor"] })}
              >
                <option value="">None</option>
                <option value="fortigate">FortiGate</option>
              </Select>
            )}
          </FieldGroup>
          {form.vendorApiVendor === "fortigate" && (
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="API token">
                {(ids) => (
                  <Input
                    {...ids}
                    type="password"
                    className="w-full"
                    value={form.vendorApiToken}
                    onChange={(e) => setForm({ ...form, vendorApiToken: e.target.value })}
                    placeholder={form.id ? "Leave blank to keep unchanged" : "REST API admin token"}
                  />
                )}
              </FieldGroup>
              <FieldGroup label="Port (optional)">
                {(ids) => (
                  <Input
                    {...ids}
                    type="number"
                    className="w-full"
                    value={form.vendorApiPort}
                    onChange={(e) => setForm({ ...form, vendorApiPort: e.target.value })}
                    placeholder="443"
                  />
                )}
              </FieldGroup>
              <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  checked={form.vendorApiVerifyTls}
                  onChange={(e) => setForm({ ...form, vendorApiVerifyTls: e.target.checked })}
                  className="cursor-pointer accent-accent"
                />
                Verify TLS certificate (turn off only for a self-signed lab appliance)
              </label>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </Layout>
  );
}

type SortKey = "state" | "name" | "ip" | "type" | "intervalSec" | "enabled";

// Down-first, not alphabetical — the point of sorting by status in a monitoring table is "show me
// what needs attention," so a plain string sort (which would put "degraded" before "down") would
// actively work against that.
const STATE_SORT_RANK: Record<string, number> = { down: 0, flapping: 1, degraded: 2, maintenance: 3, up: 4 };

function DeviceTable({
  devices,
  onEdit,
  onDelete,
  selected,
  onToggleSelect,
}: {
  devices: DeviceRow[];
  onEdit: (d: DeviceRow) => void;
  onDelete: (d: DeviceRow) => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const list = [...devices];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "state":
          cmp = (STATE_SORT_RANK[a.state ?? "up"] ?? 5) - (STATE_SORT_RANK[b.state ?? "up"] ?? 5);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "ip":
          cmp = a.ip.localeCompare(b.ip, undefined, { numeric: true });
          break;
        case "type":
          cmp = DEVICE_TYPE_LABELS[a.type].localeCompare(DEVICE_TYPE_LABELS[b.type]);
          break;
        case "intervalSec":
          cmp = a.intervalSec - b.intervalSec;
          break;
        case "enabled":
          cmp = Number(b.enabled) - Number(a.enabled);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [devices, sortKey, sortDir]);

  function SortHeader({ label, sortKeyName, className = "" }: { label: string; sortKeyName: SortKey; className?: string }) {
    const active = sortKey === sortKeyName;
    return (
      <th
        className={`cursor-pointer select-none px-3 py-2.5 transition-colors duration-150 hover:text-text-primary ${className}`}
        onClick={() => toggleSort(sortKeyName)}
        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      >
        <span className="flex items-center gap-1">
          {label}
          {active ? (
            sortDir === "asc" ? (
              <ArrowUp size={11} aria-hidden="true" />
            ) : (
              <ArrowDown size={11} aria-hidden="true" />
            )
          ) : (
            <ArrowUpDown size={11} className="opacity-30" aria-hidden="true" />
          )}
        </span>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 border-b border-border-strong bg-bg-surface text-left text-2xs font-medium uppercase tracking-wide text-text-muted">
          <tr>
            <th className="w-8 px-3 py-2.5"></th>
            <SortHeader label="Status" sortKeyName="state" className="w-8" />
            <SortHeader label="Name" sortKeyName="name" />
            <SortHeader label="IP" sortKeyName="ip" />
            <SortHeader label="Type" sortKeyName="type" />
            <th className="px-3 py-2.5">Tags</th>
            <SortHeader label="Interval" sortKeyName="intervalSec" />
            <SortHeader label="Enabled" sortKeyName="enabled" />
            <th className="px-3 py-2.5"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr
              key={d.id}
              className="cursor-pointer border-b border-border/60 transition-colors duration-150 last:border-b-0 hover:bg-bg-subtle/50"
              onClick={() => onEdit(d)}
            >
              <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(d.id)}
                  onChange={() => onToggleSelect(d.id)}
                  aria-label={`Select ${d.name}`}
                  className="cursor-pointer accent-accent"
                />
              </td>
              <td className="px-1 py-2.5">
                <StatusDot state={d.state ?? null} pulse={d.state === "down" || d.state === "flapping"} />
              </td>
              <td className="px-3 py-2.5 font-medium text-text-primary">
                <span className="flex items-center gap-1.5">
                  {d.name}
                  {d.criticalAsset && (
                    <Zap size={12} className="shrink-0 text-warning" aria-hidden="true">
                      <title>Critical asset — pages instantly on DOWN, skips storm grouping</title>
                    </Zap>
                  )}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono text-text-secondary">{d.ip}</td>
              <td className="px-3 py-2.5 text-text-secondary">{DEVICE_TYPE_LABELS[d.type]}</td>
              <td className="px-3 py-2.5">
                {d.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.tags.map((t) => (
                      <span key={t} className="rounded-full border border-border bg-bg-subtle px-1.5 py-0.5 text-2xs text-text-secondary">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-2.5 text-text-secondary">{d.intervalSec}s</td>
              <td className="px-3 py-2.5">
                <Badge tone={d.enabled ? "success" : "neutral"}>{d.enabled ? "Yes" : "No"}</Badge>
              </td>
              <td className="px-3 py-2.5 text-right">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(d);
                  }}
                  aria-label={`Delete ${d.name}`}
                  className="cursor-pointer rounded p-1.5 text-text-secondary transition-colors duration-150 hover:bg-critical-subtle hover:text-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
