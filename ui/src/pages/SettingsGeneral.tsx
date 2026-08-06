import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { Button, Card, CardBody, CardHeader, FieldGroup, Input, Select, Skeleton, useConfirm, useToast } from "../components/ui";
import { useDirty } from "../hooks/useDirty";

interface GeneralSettings {
  instanceName: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
  polling: { defaultIntervalSec: number; concurrency: number };
  retention: { rawDays: number; rollupDays: number };
  updateCheckUrl: string;
  heartbeatUrl: string;
  version: string;
  mode: "exe" | "saas";
}

interface UpdateCheckResult {
  configured: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  releaseUrl?: string;
  notes?: string;
  canAutoUpdate?: boolean;
  error?: string;
}

interface BackupScheduleConfig {
  enabled: boolean;
  recurrence: "daily" | "weekly";
  keepCount: number;
  lastRunAt: string | null;
}

export function SettingsGeneral() {
  const [settings, setSettings] = useState<GeneralSettings | null>(null);
  const [restartNotice, setRestartNotice] = useState("");
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [testingHeartbeat, setTestingHeartbeat] = useState(false);
  const [heartbeatResult, setHeartbeatResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [backupSchedule, setBackupSchedule] = useState<BackupScheduleConfig | null>(null);
  const [savingBackupSchedule, setSavingBackupSchedule] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const [dirty, markClean] = useDirty(settings);

  useEffect(() => {
    api.get<GeneralSettings>("/settings/general").then(setSettings).catch(() => {});
    api.get<BackupScheduleConfig>("/settings/backup-schedule").then(setBackupSchedule).catch(() => {});
  }, []);

  async function saveBackupSchedule() {
    if (!backupSchedule) return;
    setSavingBackupSchedule(true);
    try {
      await api.put("/settings/backup-schedule", {
        enabled: backupSchedule.enabled,
        recurrence: backupSchedule.recurrence,
        keepCount: backupSchedule.keepCount,
      });
      toast.success("Backup schedule saved.");
    } catch {
      toast.error("Failed to save backup schedule.");
    } finally {
      setSavingBackupSchedule(false);
    }
  }

  async function save() {
    if (!settings) return;
    const res = await api.put<{ ok: boolean; restartRequired: boolean; message?: string }>("/settings/general", settings);
    markClean();
    if (res.restartRequired) {
      setRestartNotice(res.message ?? "Restart required.");
    } else {
      setRestartNotice("");
      toast.success("Settings saved.");
    }
  }

  function downloadBackup() {
    window.open("/api/backup", "_blank");
  }

  async function checkForUpdates() {
    setCheckingUpdate(true);
    setUpdateCheck(null);
    try {
      const res = await api.get<UpdateCheckResult>("/settings/update-check");
      setUpdateCheck(res);
    } catch {
      setUpdateCheck({ configured: true, currentVersion: settings?.version ?? "", error: "Request failed" });
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function testHeartbeat() {
    setTestingHeartbeat(true);
    setHeartbeatResult(null);
    try {
      const res = await api.post<{ ok: boolean; error?: string }>("/settings/heartbeat-test");
      setHeartbeatResult(res);
    } catch (err) {
      setHeartbeatResult({ ok: false, error: err instanceof ApiError ? err.message : "Request failed" });
    } finally {
      setTestingHeartbeat(false);
    }
  }

  async function applyUpdate() {
    const ok = await confirm({
      title: "Update Argus?",
      message: `Update to ${updateCheck?.latestVersion}? Argus will restart automatically — this takes about 10 seconds.`,
      confirmLabel: "Update now",
    });
    if (!ok) return;
    setApplyingUpdate(true);
    try {
      const res = await api.post<{ ok: boolean; toVersion: string }>("/settings/update-apply");
      toast.success(`Updating to ${res.toVersion}… reload this page in about 10 seconds.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Update failed.");
      setApplyingUpdate(false);
    }
  }

  async function handleRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = await confirm({
      title: "Restore from backup?",
      message: `This replaces your entire device inventory, history, and config with the contents of "${file.name}". Whatever's in Argus right now that isn't in that file will be gone — there's no undo.`,
      confirmLabel: "Restore",
    });
    if (!ok) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch("/api/backup/restore", { method: "POST", body: buf, credentials: "same-origin" });
      const body = await res.json();
      const text = body.message ?? body.error ?? "Unknown response";
      if (res.ok) toast.success(text);
      else toast.error(text);
    } catch {
      toast.error("Upload failed");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!settings) {
    return (
      <Layout title="General" subtitle="Instance name, retention, updates, and backups">
        <div className="mx-auto max-w-2xl space-y-6">
          <Card>
            <CardBody>
              <Skeleton className="mb-4 h-5 w-40" />
              <div className="space-y-3">
                <Skeleton className="h-9 w-full" />
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <Skeleton className="mb-3 h-5 w-24" />
              <Skeleton className="h-4 w-2/3" />
            </CardBody>
          </Card>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="General" subtitle="Instance name, retention, updates, and backups">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Version</p>
            <p className="mt-1 truncate text-sm font-semibold text-text-primary" title={`${settings.version} (${settings.mode} mode)`}>
              {settings.version} <span className="font-normal capitalize text-text-secondary">· {settings.mode}</span>
            </p>
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Update checks</p>
            <p className={`mt-1 text-sm font-semibold ${settings.updateCheckUrl ? "text-success" : "text-text-secondary"}`}>
              {settings.updateCheckUrl ? "Configured" : "Not configured"}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Heartbeat</p>
            <p className={`mt-1 text-sm font-semibold ${settings.heartbeatUrl ? "text-success" : "text-text-secondary"}`}>
              {settings.heartbeatUrl ? "Configured" : "Not configured"}
            </p>
          </div>
        </div>

        <Card>
          <CardBody>
            <CardHeader title="Instance settings" />
            <div className="space-y-3">
              <FieldGroup label="Instance name" hint="Shown in the browser tab, emails, and the top-left of the app — useful if you run more than one Argus instance.">
                {(ids) => <Input {...ids} className="w-full" value={settings.instanceName} onChange={(e) => setSettings({ ...settings, instanceName: e.target.value })} />}
              </FieldGroup>
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Port (restart required)" hint="Which TCP port the dashboard/API listens on. Changing it doesn't open your firewall — run Argus.exe --fix-firewall for the exact command if teammates on your network can't reach it.">
                  {(ids) => (
                    <Input {...ids} className="w-full" type="number" value={settings.port} onChange={(e) => setSettings({ ...settings, port: Number(e.target.value) })} />
                  )}
                </FieldGroup>
                <FieldGroup label="Log level" hint="How much detail goes into the log file. Info is right for normal use; Debug is verbose, only useful while troubleshooting.">
                  {(ids) => (
                    <Select {...ids} className="w-full" value={settings.logLevel} onChange={(e) => setSettings({ ...settings, logLevel: e.target.value as GeneralSettings["logLevel"] })}>
                      <option value="debug">Debug</option>
                      <option value="info">Info</option>
                      <option value="warn">Warn</option>
                      <option value="error">Error</option>
                    </Select>
                  )}
                </FieldGroup>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Default poll interval (s)" hint="How often a newly-added device is checked, unless you set a different interval on that device itself.">
                  {(ids) => (
                    <Input
                      {...ids}
                      className="w-full"
                      type="number"
                      value={settings.polling.defaultIntervalSec}
                      onChange={(e) => setSettings({ ...settings, polling: { ...settings.polling, defaultIntervalSec: Number(e.target.value) } })}
                    />
                  )}
                </FieldGroup>
                <FieldGroup label="Concurrency (restart required)" hint="Max devices checked at the same moment. Higher finishes a full round faster on a large fleet; lower is gentler on this machine's CPU/network.">
                  {(ids) => (
                    <Input
                      {...ids}
                      className="w-full"
                      type="number"
                      value={settings.polling.concurrency}
                      onChange={(e) => setSettings({ ...settings, polling: { ...settings.polling, concurrency: Number(e.target.value) } })}
                    />
                  )}
                </FieldGroup>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldGroup label="Raw metric retention (days)" hint="How long full-resolution metrics (every individual check) are kept before being rolled up. Longer keeps more detail in device charts but uses more disk.">
                  {(ids) => (
                    <Input
                      {...ids}
                      className="w-full"
                      type="number"
                      value={settings.retention.rawDays}
                      onChange={(e) => setSettings({ ...settings, retention: { ...settings.retention, rawDays: Number(e.target.value) } })}
                    />
                  )}
                </FieldGroup>
                <FieldGroup label="Rollup retention (days)" hint="How long the hourly-averaged history (used for long-range reports and SLA) is kept after that.">
                  {(ids) => (
                    <Input
                      {...ids}
                      className="w-full"
                      type="number"
                      value={settings.retention.rollupDays}
                      onChange={(e) => setSettings({ ...settings, retention: { ...settings.retention, rollupDays: Number(e.target.value) } })}
                    />
                  )}
                </FieldGroup>
              </div>
              <FieldGroup
                label="Update check URL (optional)"
                hint={
                  <>
                    Off by default. If set, must return JSON like <code>{'{ "version": "1.2.0", "url": "https://..." }'}</code>.
                  </>
                }
              >
                {(ids) => (
                  <Input
                    {...ids}
                    className="w-full"
                    placeholder="https://example.com/argus-latest.json"
                    value={settings.updateCheckUrl}
                    onChange={(e) => setSettings({ ...settings, updateCheckUrl: e.target.value })}
                  />
                )}
              </FieldGroup>
              <div className="flex items-center gap-3 pt-1">
                {dirty && <Button onClick={save}>Save</Button>}
                {restartNotice && <p className="text-sm text-warning">{restartNotice}</p>}
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader title="About" />
            <p className="text-sm text-text-secondary">
              Argus <span className="font-mono text-text-primary">{settings.version}</span> ({settings.mode} mode)
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={checkForUpdates} disabled={checkingUpdate || !settings.updateCheckUrl}>
              {checkingUpdate ? "Checking…" : "Check for updates"}
            </Button>
            {!settings.updateCheckUrl && <p className="mt-2 text-xs text-text-secondary">Set an update check URL above to enable this.</p>}
            {updateCheck && (
              <div className="mt-3 text-sm">
                {updateCheck.error && <p className="text-critical">{updateCheck.error}</p>}
                {!updateCheck.error && updateCheck.updateAvailable && (
                  <div className="space-y-2">
                    <p className="text-warning">
                      Update available: {updateCheck.latestVersion}.{" "}
                      {updateCheck.releaseUrl && (
                        <a href={updateCheck.releaseUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                          Release notes
                        </a>
                      )}
                    </p>
                    {updateCheck.canAutoUpdate ? (
                      <Button onClick={applyUpdate} disabled={applyingUpdate}>
                        {applyingUpdate ? "Updating…" : `Update to ${updateCheck.latestVersion}`}
                      </Button>
                    ) : (
                      <p className="text-xs text-text-secondary">Automatic update isn't available for this install — download the new version manually.</p>
                    )}
                  </div>
                )}
                {!updateCheck.error && updateCheck.updateAvailable === false && <p className="text-accent">You're up to date.</p>}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title="Heartbeat"
              description="Pings an external dead-man's-switch URL every 5 minutes. If the whole Argus process, the Windows service, or the machine itself goes down, this is the only thing that can still notice — nothing running inside a dead process can alert on its own behalf."
            />
            <FieldGroup
              label="Heartbeat URL (optional)"
              hint={
                <>
                  A push-monitor ping URL from healthchecks.io, Cronitor, Uptime Kuma, or similar. Set that service's own grace period to at least 15-20 minutes
                  so one missed ping doesn't false-page.
                </>
              }
            >
              {(ids) => (
                <Input
                  {...ids}
                  className="w-full"
                  placeholder="https://hc-ping.com/your-check-uuid"
                  value={settings.heartbeatUrl}
                  onChange={(e) => setSettings({ ...settings, heartbeatUrl: e.target.value })}
                />
              )}
            </FieldGroup>
            <div className="flex items-center gap-3 pt-3">
              {dirty && <Button onClick={save}>Save</Button>}
              <Button variant="secondary" size="sm" onClick={testHeartbeat} disabled={testingHeartbeat || !settings.heartbeatUrl}>
                {testingHeartbeat ? "Sending…" : "Send test ping"}
              </Button>
            </div>
            {!settings.heartbeatUrl && <p className="mt-2 text-xs text-text-secondary">Set a heartbeat URL above (and save) to enable this.</p>}
            {heartbeatResult && (
              <p className={`mt-2 text-sm ${heartbeatResult.ok ? "text-accent" : "text-critical"}`}>
                {heartbeatResult.ok ? "Ping sent successfully." : heartbeatResult.error}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader title="Backup & restore" description="The backup archive contains your full device inventory, history, and config — including any configured secrets. Store it securely." />
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={downloadBackup}>
                <Download size={14} aria-hidden="true" /> Download backup
              </Button>
              <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary">
                <Upload size={14} aria-hidden="true" />
                Restore from file
                <input ref={fileInputRef} type="file" accept=".zip" onChange={handleRestoreFile} className="hidden" />
              </label>
            </div>

            {backupSchedule && (
              <div className="mt-5 border-t border-border pt-4">
                <h4 className="mb-1 text-sm font-medium text-text-primary">Automatic scheduled backups</h4>
                <p className="mb-3 text-xs text-text-secondary">
                  Writes the same archive to <code className="rounded bg-bg-subtle px-1">dataDir/backups/</code> on a schedule, keeping only the
                  most recent copies. This doesn't replace an off-machine copy — copy that folder somewhere else too if the whole machine could be lost.
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={backupSchedule.enabled}
                      onChange={(e) => setBackupSchedule({ ...backupSchedule, enabled: e.target.checked })}
                      className="cursor-pointer accent-accent"
                    />
                    Enabled
                  </label>
                  <Select
                    value={backupSchedule.recurrence}
                    onChange={(e) => setBackupSchedule({ ...backupSchedule, recurrence: e.target.value as "daily" | "weekly" })}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </Select>
                  <FieldGroup label="Keep last N">
                    {(ids) => (
                      <Input
                        {...ids}
                        type="number"
                        min={1}
                        max={90}
                        className="w-20"
                        value={backupSchedule.keepCount}
                        onChange={(e) => setBackupSchedule({ ...backupSchedule, keepCount: Number(e.target.value) })}
                      />
                    )}
                  </FieldGroup>
                  <Button size="sm" onClick={saveBackupSchedule} disabled={savingBackupSchedule}>
                    {savingBackupSchedule ? "Saving…" : "Save"}
                  </Button>
                </div>
                {backupSchedule.lastRunAt && (
                  <p className="mt-2 text-xs text-text-secondary">Last automatic backup: {new Date(backupSchedule.lastRunAt).toLocaleString()}.</p>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}
