import { useEffect, useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Eye, EyeOff, KeyRound, Monitor, ShieldCheck, ShieldOff } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { Badge, Button, Card, CardBody, CardHeader, FieldGroup, Input, useConfirm, useToast } from "../components/ui";
import { useAuth } from "../auth/AuthContext";

interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string | null;
}

function PasswordField({
  label,
  hint,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <FieldGroup label={label} hint={hint}>
      {(ids) => (
        <div className="relative">
          <Input
            {...ids}
            type={visible ? "text" : "password"}
            required
            minLength={minLength}
            autoComplete={autoComplete}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center text-text-muted transition-colors hover:text-text-secondary"
          >
            {visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
          </button>
        </div>
      )}
    </FieldGroup>
  );
}

/** Manual-entry fallback for enrollment — collapsed by default since the QR code is the primary
 * path; only someone entering it into a desktop password manager or a phone that can't scan needs
 * this at all. */
function ManualEntryReveal({ secret }: { secret: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the code manually.");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer text-2xs font-medium text-accent hover:text-accent-hover"
      >
        {open ? "Hide manual entry code" : "Can't scan the code? Enter it manually"}
      </button>
      {open && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2">
          <code className="select-all font-mono text-xs tracking-wider text-text-primary">{secret}</code>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy code"
            className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs font-medium text-text-secondary hover:text-text-primary"
          >
            {copied ? <Check size={13} className="text-success" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}

export function SettingsSecurity() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function loadSessions() {
    if (!user) return;
    try {
      setSessions(await api.get<SessionInfo[]>(`/users/${user.id}/sessions`));
    } catch {
      setSessions([]);
    }
  }

  useEffect(() => {
    loadSessions().catch(() => {});
  }, [user?.id]);

  async function revokeSession(session: SessionInfo) {
    const ok = await confirm({
      title: "Sign out this session?",
      message: "Whoever's signed in there will need to log in again. If this is your own current browser, you'll be signed out too.",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    setRevokingId(session.id);
    try {
      await api.delete(`/sessions/${session.id}`);
      toast.success("Session signed out.");
      await loadSessions();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to sign out that session.");
    } finally {
      setRevokingId(null);
    }
  }

  const [enrolling, setEnrolling] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [disabling, setDisabling] = useState(false);

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSavingPassword(true);
    try {
      await api.post(`/users/${user.id}/password`, { currentPassword, newPassword });
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      toast.error(err instanceof ApiError && err.code === "INVALID_CURRENT_PASSWORD" ? "Current password is incorrect." : "Failed to update password.");
    } finally {
      setSavingPassword(false);
    }
  }

  async function startEnroll() {
    setEnrolling(true);
    try {
      const res = await api.post<{ secret: string; uri: string }>("/auth/totp/enroll");
      setSecret(res.secret);
      setUri(res.uri);
    } catch {
      toast.error("Failed to start 2FA enrollment.");
    } finally {
      setEnrolling(false);
    }
  }

  async function confirmEnroll() {
    setVerifying(true);
    try {
      await api.post("/auth/totp/verify", { code: verifyCode });
      toast.success("Two-factor authentication enabled.");
      setSecret(null);
      setUri(null);
      setVerifyCode("");
      await refresh();
    } catch {
      toast.error("That code didn't verify — check your authenticator app and try again.");
    } finally {
      setVerifying(false);
    }
  }

  const activeSessions = (sessions ?? []).filter((s) => !s.revokedAt && new Date(s.expiresAt).getTime() > Date.now());

  async function disable2fa() {
    setDisabling(true);
    try {
      await api.post("/auth/totp/disable");
      toast.success("Two-factor authentication disabled.");
      await refresh();
    } catch {
      toast.error("Failed to disable 2FA.");
    } finally {
      setDisabling(false);
    }
  }

  return (
    <Layout title="Security" subtitle="Password and two-factor authentication for your account">
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardBody>
            <CardHeader title="Change password" description="Use at least 10 characters — a passphrase is easier to remember than random symbols." />
            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <PasswordField label="Current password" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
              <PasswordField label="New password" value={newPassword} onChange={setNewPassword} autoComplete="new-password" minLength={10} />
              <div className="flex items-center gap-2 pt-1">
                <KeyRound size={14} className="text-text-muted" aria-hidden="true" />
                <Button type="submit" disabled={savingPassword}>
                  {savingPassword ? "Saving…" : "Update password"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title="Two-factor authentication"
              action={
                user?.totpEnabled ? (
                  <Badge tone="success">
                    <ShieldCheck size={11} aria-hidden="true" /> Enabled
                  </Badge>
                ) : (
                  <Badge tone="neutral">
                    <ShieldOff size={11} aria-hidden="true" /> Not enabled
                  </Badge>
                )
              }
            />
            {user?.totpEnabled ? (
              <div className="space-y-4">
                <p className="text-sm text-text-secondary">
                  Signing in now requires a code from your authenticator app after your password. Disabling this removes that requirement.
                </p>
                <Button variant="secondary" onClick={disable2fa} disabled={disabling}>
                  {disabling ? "Disabling…" : "Disable 2FA"}
                </Button>
              </div>
            ) : secret && uri ? (
              <div className="space-y-5">
                <ol className="space-y-4">
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-2xs font-semibold text-accent">1</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-text-primary">Scan this with an authenticator app</p>
                      <p className="mt-0.5 text-2xs text-text-muted">Google Authenticator, Authy, 1Password, or any TOTP-compatible app.</p>
                      <div className="mt-3 inline-block rounded-lg border border-border bg-white p-3">
                        <QRCodeSVG value={uri} size={168} bgColor="#FFFFFF" fgColor="#0A0A0A" level="M" />
                      </div>
                      <div className="mt-3">
                        <ManualEntryReveal secret={secret} />
                      </div>
                    </div>
                  </li>
                  <li className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-2xs font-semibold text-accent">2</span>
                    <div className="min-w-0 flex-1">
                      <p className="mb-2 text-sm text-text-primary">Enter the 6-digit code it shows</p>
                      <div className="flex flex-wrap items-end gap-3">
                        <FieldGroup label="Verification code">
                          {(ids) => (
                            <Input
                              {...ids}
                              className="w-32 text-center font-mono text-lg tracking-[0.3em]"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              maxLength={6}
                              placeholder="000000"
                              value={verifyCode}
                              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                            />
                          )}
                        </FieldGroup>
                        <Button onClick={confirmEnroll} disabled={verifying || verifyCode.length !== 6}>
                          {verifying ? "Verifying…" : "Verify and enable"}
                        </Button>
                      </div>
                    </div>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-text-secondary">
                  Add a second factor so signing in also requires a code from an authenticator app, not just your password.
                </p>
                <Button onClick={startEnroll} disabled={enrolling}>
                  {enrolling ? "Starting…" : "Set up 2FA"}
                </Button>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader
              title="Active sessions"
              description="Every browser currently signed in as you. Sign one out remotely if you don't recognize it, or after using a shared/public computer."
            />
            {sessions === null ? (
              <p className="text-sm text-text-secondary">Loading…</p>
            ) : activeSessions.length === 0 ? (
              <p className="text-sm text-text-secondary">No active sessions found.</p>
            ) : (
              <div className="space-y-2">
                {activeSessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Monitor size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text-primary">{s.ip ?? "Unknown IP"}</p>
                        <p className="text-2xs text-text-secondary">
                          Signed in {new Date(s.createdAt).toLocaleString()} · expires {new Date(s.expiresAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Button variant="secondary" size="sm" disabled={revokingId === s.id} onClick={() => revokeSession(s)}>
                      {revokingId === s.id ? "Signing out…" : "Sign out"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Layout>
  );
}
