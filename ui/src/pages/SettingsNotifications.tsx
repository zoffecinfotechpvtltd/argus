import { useEffect, useState } from "react";
import { Mail, Webhook, BellRing, ChevronDown, Radio, Check, Minus } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import type { NotificationPrefs } from "../api/alertTypes";
import { Button, Card, CardBody, CardHeader, FieldGroup, Input, Select, Skeleton, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { useDirty } from "../hooks/useDirty";

/** At-a-glance status pill for the summary strip — a filled colored dot reads faster than parsing
 * a sentence in each card's own description below, especially with three cards to scan. */
function ChannelStatusPill({ icon: Icon, label, configured }: { icon: typeof Mail; label: string; configured: boolean }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-bg-subtle/40 px-3 py-2.5">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${configured ? "bg-success-subtle text-success" : "bg-bg-subtle text-text-muted"}`}>
        <Icon size={14} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="text-xs font-medium text-text-primary">{label}</div>
        <div className={`flex items-center gap-1 text-2xs ${configured ? "text-success" : "text-text-muted"}`}>
          {configured ? <Check size={11} aria-hidden="true" /> : <Minus size={11} aria-hidden="true" />}
          {configured ? "Configured" : "Not set up"}
        </div>
      </div>
    </div>
  );
}

interface SmtpStatus {
  host?: string;
  port?: number;
  secure?: boolean;
  from?: string;
  hasPassword: boolean;
}

interface SyslogConfig {
  enabled: boolean;
  host: string;
  port: number;
  facility: number;
}

export function SettingsNotifications() {
  const [smtp, setSmtp] = useState({ host: "", port: 587, secure: false, user: "", pass: "", from: "" });
  const [smtpStatus, setSmtpStatus] = useState<SmtpStatus | null>(null);
  const [testEmail, setTestEmail] = useState("");
  const [payloadOpen, setPayloadOpen] = useState(false);

  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookHasSecret, setWebhookHasSecret] = useState(false);
  const [testWebhookUrl, setTestWebhookUrl] = useState("");

  const [syslog, setSyslog] = useState<SyslogConfig>({ enabled: false, host: "", port: 514, facility: 16 });
  const [testingSyslog, setTestingSyslog] = useState(false);

  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [prefsDirty, markPrefsClean] = useDirty(prefs);
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    // SMTP/webhook config is admin-only server-side (requireRole("admin")) — a non-admin's GET
    // would just 403, so skip the call entirely rather than showing an empty/broken form.
    if (isAdmin) {
      api
        .get<{ smtp: SmtpStatus | null; webhook: { hasSecret: boolean }; syslog: SyslogConfig }>("/settings/notifications")
        .then((s) => {
          setSmtpStatus(s.smtp);
          if (s.smtp) setSmtp((prev) => ({ ...prev, ...s.smtp, pass: "" }));
          setWebhookHasSecret(s.webhook.hasSecret);
          setSyslog(s.syslog);
        })
        .catch(() => {});
    }
    api.get<NotificationPrefs>("/notification-prefs").then(setPrefs).catch(() => {});
  }, [isAdmin]);

  async function saveSmtp() {
    try {
      await api.put("/settings/notifications/smtp", smtp);
      setSmtpStatus({ ...smtp, hasPassword: !!smtp.pass });
      toast.success("SMTP settings saved.");
    } catch (err) {
      // Every "test" function on this page already catches and surfaces its own failure — the
      // four "save" functions right next to them didn't, so a rejected save (a validation error,
      // a transient network blip) left the form looking like nothing happened at all, no different
      // from a successful save the user just hadn't noticed yet.
      toast.error(err instanceof ApiError ? err.message : "Failed to save SMTP settings.");
    }
  }

  async function testSmtp() {
    try {
      await api.post("/settings/notifications/smtp/test", { to: testEmail });
      toast.success(`Test email sent to ${testEmail}. Check its inbox (and spam folder).`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send test email.");
    }
  }

  async function saveWebhook() {
    try {
      await api.put("/settings/notifications/webhook", { secret: webhookSecret || undefined });
      setWebhookHasSecret(!!webhookSecret);
      setWebhookSecret("");
      toast.success("Webhook secret saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save the webhook secret.");
    }
  }

  async function testWebhook() {
    try {
      await api.post("/settings/notifications/webhook/test", { url: testWebhookUrl });
      toast.success("Test webhook sent — check the receiving endpoint's logs.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send test webhook.");
    }
  }

  async function saveSyslog() {
    try {
      await api.put("/settings/notifications/syslog", syslog);
      toast.success("Syslog forwarding settings saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save syslog settings.");
    }
  }

  async function testSyslog() {
    setTestingSyslog(true);
    try {
      await api.post("/settings/notifications/syslog/test", { host: syslog.host, port: syslog.port, facility: syslog.facility });
      toast.success("Test CEF message sent — check the receiving syslog server.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to send test syslog message.");
    } finally {
      setTestingSyslog(false);
    }
  }

  async function savePrefs() {
    if (!prefs) return;
    try {
      await api.put("/notification-prefs", prefs);
      markPrefsClean();
      toast.success("Preferences saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save preferences.");
    }
  }

  function toggleChannel(channel: "email" | "webhook") {
    if (!prefs) return;
    const has = prefs.channels.includes(channel);
    setPrefs({ ...prefs, channels: has ? prefs.channels.filter((c) => c !== channel) : [...prefs.channels, channel] });
  }

  return (
    <Layout title="Notifications" subtitle="SMTP, webhook, and syslog delivery, plus your personal alert preferences">
      <div className="mx-auto max-w-3xl space-y-6">
        {isAdmin && (
        <>
        <div>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-secondary">Instance delivery channels</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ChannelStatusPill icon={Mail} label="Email (SMTP)" configured={!!smtpStatus?.host} />
            <ChannelStatusPill icon={Webhook} label="Webhook signing" configured={webhookHasSecret} />
            <ChannelStatusPill icon={Radio} label="Syslog forwarding" configured={syslog.enabled} />
          </div>
        </div>
        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Mail size={16} className="text-accent" aria-hidden="true" />
                  SMTP (email)
                </span>
              }
              description={smtpStatus?.host ? `Currently sending via ${smtpStatus.host}` : "Not configured yet — alerts can't email anyone until this is set up."}
            />
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              Any standard email provider works here — Gmail, Microsoft 365/Outlook, SendGrid, Amazon SES, or your own mail
              server. Argus sends <em>as</em> the mailbox you configure below, so the recipient can be any address, on any
              domain — a company mailbox sending to a personal Gmail address (or the reverse) is completely normal; that's
              how email has always worked. Common ports: <strong>587</strong> with TLS checked (most providers, including
              Gmail app passwords and Microsoft 365), <strong>465</strong> for implicit TLS, or <strong>25</strong>{" "}
              unencrypted (only for a mail server on your own trusted network).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Host">
                {(ids) => <Input {...ids} className="w-full" placeholder="smtp.gmail.com" value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} />}
              </FieldGroup>
              <FieldGroup label="Port">
                {(ids) => (
                  <Input {...ids} className="w-full" type="number" placeholder="587" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} />
                )}
              </FieldGroup>
              <FieldGroup label="Username">
                {(ids) => <Input {...ids} className="w-full" value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} />}
              </FieldGroup>
              <FieldGroup label="Password">
                {(ids) => <Input {...ids} className="w-full" type="password" value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} />}
              </FieldGroup>
              <div className="col-span-2">
                <FieldGroup label="From address">
                  {(ids) => (
                    <Input {...ids} className="w-full" placeholder="alerts@yourcompany.com" value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} />
                  )}
                </FieldGroup>
              </div>
              <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })} className="cursor-pointer accent-accent" />
                Use TLS (secure) — leave checked unless your provider tells you otherwise
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Button size="sm" onClick={saveSmtp}>
                Save
              </Button>
              <FieldGroup label="Send a test to">
                {(ids) => <Input {...ids} className="max-w-[200px]" placeholder="test@you.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />}
              </FieldGroup>
              <Button variant="secondary" size="sm" onClick={testSmtp} disabled={!testEmail}>
                Send test email
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Webhook size={16} className="text-accent" aria-hidden="true" />
                  Webhook
                </span>
              }
              description={webhookHasSecret ? "Shared HMAC secret configured." : "No signing secret set — webhooks still send without one, just unsigned."}
            />
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              A webhook is an outbound HTTP <code className="rounded bg-bg-subtle px-1 py-0.5">POST</code> Argus sends the
              instant an alert fires — point it at Slack, Microsoft Teams, PagerDuty, n8n, or your own automation to pipe
              alerts anywhere email can't reach. The URL must be a real, externally reachable address (not{" "}
              <code className="rounded bg-bg-subtle px-1 py-0.5">localhost</code> or a private LAN IP — those are blocked for
              safety). Setting a shared secret below signs every request with{" "}
              <code className="rounded bg-bg-subtle px-1 py-0.5">X-Argus-Signature: sha256=&lt;hmac&gt;</code>, so the
              receiving endpoint can verify the payload really came from this Argus instance.
            </p>
            <button
              type="button"
              onClick={() => setPayloadOpen((v) => !v)}
              className="mb-3 flex cursor-pointer items-center gap-1.5 text-xs font-medium text-accent"
            >
              <ChevronDown size={13} className={`transition-transform ${payloadOpen ? "rotate-180" : ""}`} aria-hidden="true" />
              {payloadOpen ? "Hide" : "Show"} example payload
            </button>
            {payloadOpen && (
              <pre className="mb-4 overflow-x-auto rounded-md border border-border bg-bg-subtle/60 p-3 font-mono text-2xs leading-relaxed text-text-secondary">
{`{
  "alert": { "id": "...", "severity": "critical", "title": "Router is DOWN", "openedAt": "..." },
  "device": { "id": "...", "name": "Core Router", "ip": "192.168.1.1", "type": "router" },
  "tenant": "local"

  // Only present when many devices go down at once (a storm — e.g. a whole site's link
  // dropping) and Argus aggregates into one notification instead of flooding you with one
  // per device. Lists every affected device explicitly so you still know exactly who's down:
  // "affectedDevices": [{ "name": "Core Router", "ip": "192.168.1.1" }, ...]
}`}
              </pre>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <FieldGroup label="Shared HMAC secret (optional)">
                  {(ids) => <Input {...ids} className="w-full" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />}
                </FieldGroup>
              </div>
              <Button size="sm" onClick={saveWebhook}>
                Save
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <FieldGroup label="Send a test to">
                  {(ids) => <Input {...ids} className="w-full" placeholder="https://example.com/webhook" value={testWebhookUrl} onChange={(e) => setTestWebhookUrl(e.target.value)} />}
                </FieldGroup>
              </div>
              <Button variant="secondary" size="sm" onClick={testWebhook} disabled={!testWebhookUrl}>
                Send test webhook
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Radio size={16} className="text-accent" aria-hidden="true" />
                  SIEM / syslog forwarding
                </span>
              }
              description="Forwards every alert as a CEF-formatted message over UDP syslog — independent of per-user channels/quiet hours, for feeding a SIEM (Splunk, QRadar, Sentinel, etc.)."
            />
            <div className="grid grid-cols-2 gap-3">
              <FieldGroup label="Host">
                {(ids) => <Input {...ids} className="w-full" value={syslog.host} onChange={(e) => setSyslog({ ...syslog, host: e.target.value })} />}
              </FieldGroup>
              <FieldGroup label="Port" hint="514 is the default.">
                {(ids) => (
                  <Input {...ids} className="w-full" type="number" placeholder="514" value={syslog.port} onChange={(e) => setSyslog({ ...syslog, port: Number(e.target.value) })} />
                )}
              </FieldGroup>
              <label className="col-span-2 flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={syslog.enabled} onChange={(e) => setSyslog({ ...syslog, enabled: e.target.checked })} className="cursor-pointer accent-accent" />
                Enabled
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={saveSyslog}>
                Save
              </Button>
              <Button variant="secondary" size="sm" onClick={testSyslog} disabled={!syslog.host || testingSyslog}>
                {testingSyslog ? "Sending…" : "Send test message"}
              </Button>
            </div>
          </CardBody>
        </Card>
        </>
        )}

        {isAdmin && (
          <h2 className="pt-2 text-xs font-medium uppercase tracking-wide text-text-secondary">My personal preferences</h2>
        )}

        {prefs === null ? (
          <Card>
            <CardBody>
              <Skeleton className="mb-4 h-5 w-56" />
              <div className="space-y-3">
                <Skeleton className="h-14 w-full rounded-lg" />
                <Skeleton className="h-14 w-full rounded-lg" />
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardBody>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <BellRing size={16} className="text-accent" aria-hidden="true" />
                    My notification preferences
                  </span>
                }
                description="Where and when you personally get notified — separate from the SMTP/webhook setup above, which just configures the channels themselves."
              />

              <div className="space-y-3">
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${prefs.channels.includes("email") ? "border-accent/40 bg-accent-subtle" : "border-border"}`}
                >
                  <input type="checkbox" checked={prefs.channels.includes("email")} onChange={() => toggleChannel("email")} className="mt-0.5 cursor-pointer accent-accent" />
                  <div>
                    <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                      <Mail size={13} aria-hidden="true" /> Email
                    </div>
                    <p className="text-xs text-text-secondary">Sends to your account's email address via the SMTP settings above.</p>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${prefs.channels.includes("webhook") ? "border-accent/40 bg-accent-subtle" : "border-border"}`}
                >
                  <input type="checkbox" checked={prefs.channels.includes("webhook")} onChange={() => toggleChannel("webhook")} className="mt-0.5 cursor-pointer accent-accent" />
                  <div className="w-full">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
                      <Webhook size={13} aria-hidden="true" /> Webhook
                    </div>
                    <p className="mb-2 text-xs text-text-secondary">Sends a POST to a URL only you get — separate from the shared webhook above.</p>
                    {prefs.channels.includes("webhook") && (
                      <Input
                        className="w-full"
                        placeholder="Your personal webhook URL"
                        value={prefs.webhookUrl ?? ""}
                        onChange={(e) => setPrefs({ ...prefs, webhookUrl: e.target.value || null })}
                      />
                    )}
                  </div>
                </label>
              </div>

              <div className="mt-4">
                <FieldGroup label="Minimum severity">
                  {(ids) => (
                    <Select {...ids} className="w-full" value={prefs.severityFloor} onChange={(e) => setPrefs({ ...prefs, severityFloor: e.target.value as NotificationPrefs["severityFloor"] })}>
                      <option value="info">Info — notify me about everything</option>
                      <option value="warning">Warning — skip info-level alerts</option>
                      <option value="critical">Critical — only wake me up for the big ones</option>
                    </Select>
                  )}
                </FieldGroup>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-sm text-text-secondary">
                  Quiet hours (optional) — warning/info notifications are skipped (not queued — you won't get a backlog when
                  quiet hours end) if they open inside this window. Critical alerts always notify you regardless.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <FieldGroup label="Start">
                    {(ids) => (
                      <Input
                        {...ids}
                        className="w-full"
                        placeholder="HH:MM"
                        value={prefs.quietHoursStart ?? ""}
                        onChange={(e) => setPrefs({ ...prefs, quietHoursStart: e.target.value || null })}
                      />
                    )}
                  </FieldGroup>
                  <FieldGroup label="End">
                    {(ids) => (
                      <Input
                        {...ids}
                        className="w-full"
                        placeholder="HH:MM"
                        value={prefs.quietHoursEnd ?? ""}
                        onChange={(e) => setPrefs({ ...prefs, quietHoursEnd: e.target.value || null })}
                      />
                    )}
                  </FieldGroup>
                </div>
              </div>

              <div className="mt-4">
                <FieldGroup label="Summary digest email" hint="An opt-in periodic email summarizing open alerts and SLA — independent of the real-time channels above.">
                  {(ids) => (
                    <Select
                      {...ids}
                      className="w-full sm:w-56"
                      value={prefs.digestRecurrence ?? ""}
                      onChange={(e) => setPrefs({ ...prefs, digestRecurrence: (e.target.value || null) as NotificationPrefs["digestRecurrence"] })}
                    >
                      <option value="">Off</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  )}
                </FieldGroup>
              </div>

              {prefsDirty && (
                <Button className="mt-4" onClick={savePrefs}>
                  Save preferences
                </Button>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </Layout>
  );
}
