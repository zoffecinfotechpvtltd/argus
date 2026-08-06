import { useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, FieldGroup, Input, Select, SkeletonRows, useConfirm, useToast } from "../components/ui";
import { Users as UsersIcon, Link2, Copy, Dices, ShieldCheck } from "lucide-react";

function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

interface AdminUser {
  id: string;
  email: string;
  role: "admin" | "operator" | "viewer";
  disabled: boolean;
  forcePasswordReset: boolean;
}

interface SessionRow {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip?: string;
}

export function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "operator" | "viewer">("viewer");
  const [tempPassword, setTempPassword] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionsFor, setSessionsFor] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const toast = useToast();
  const confirm = useConfirm();

  const summary = useMemo(() => {
    const list = users ?? [];
    return { total: list.length, admins: list.filter((u) => u.role === "admin").length, disabled: list.filter((u) => u.disabled).length };
  }, [users]);

  const shareUrl = `${window.location.protocol}//${window.location.host}`;

  async function load() {
    setUsers(await api.get<AdminUser[]>("/users"));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      const res = await api.post<{ emailed?: boolean; emailError?: string }>("/users", { email, role, temporaryPassword: tempPassword, sendEmail });
      if (sendEmail) {
        if (res.emailed) toast.success(`${email} invited and emailed their login details.`);
        else toast.error(`${email} invited, but the email failed: ${res.emailError ?? "unknown error"}. Share the password another way.`);
      } else {
        toast.success(`${email} invited.`);
      }
      setEmail("");
      setTempPassword("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to invite user");
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(id: string, newRole: string) {
    try {
      await api.patch(`/users/${id}/role`, { role: newRole });
      toast.success("Role updated.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update role.");
    }
  }

  async function toggleDisabled(u: AdminUser) {
    if (!u.disabled) {
      const ok = await confirm({
        title: `Disable ${u.email}?`,
        message: "They'll be signed out everywhere and can't log back in until you re-enable their account.",
        confirmLabel: "Disable",
      });
      if (!ok) return;
    }
    try {
      await api.patch(`/users/${u.id}/disabled`, { disabled: !u.disabled });
      toast.success(u.disabled ? `${u.email} enabled.` : `${u.email} disabled.`);
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update user.");
    }
  }

  async function viewSessions(id: string) {
    setSessionsFor(id);
    try {
      setSessions(await api.get<SessionRow[]>(`/users/${id}/sessions`));
    } catch {
      toast.error("Failed to load sessions.");
      setSessions([]);
    }
  }

  async function revokeSession(id: string) {
    const ok = await confirm({
      title: "Sign out this session?",
      message: "Whoever's signed in there will need to log in again.",
      confirmLabel: "Sign out",
    });
    if (!ok) return;
    try {
      await api.delete(`/sessions/${id}`);
      if (sessionsFor) setSessions(await api.get<SessionRow[]>(`/users/${sessionsFor}/sessions`));
      toast.success("Session signed out.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to sign out that session.");
    }
  }

  async function copyShareUrl() {
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    toast.success("Link copied.");
  }

  return (
    <Layout title="Users" subtitle="Invite teammates and manage roles and sessions">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Total users</p>
            <p className="mt-1 text-sm font-semibold text-text-primary">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Admins</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-text-primary">
              <ShieldCheck size={13} className="text-accent" aria-hidden="true" /> {summary.admins}
            </p>
          </div>
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Disabled</p>
            <p className={`mt-1 text-sm font-semibold ${summary.disabled > 0 ? "text-critical" : "text-text-primary"}`}>{summary.disabled}</p>
          </div>
        </div>

        <Card>
          <CardBody>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Link2 size={16} className="text-accent" aria-hidden="true" />
                  Shared instance link
                </span>
              }
              description="Anyone else on your network who's been invited can sign in here — this only works while the machine running Argus is on."
            />
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-text-primary">{shareUrl}</code>
              <Button variant="secondary" size="sm" onClick={copyShareUrl}>
                <Copy size={13} aria-hidden="true" /> Copy
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <CardHeader title="Invite a user" description="They'll need this link, their email, and the temporary password to sign in for the first time." />
            <form onSubmit={invite} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <FieldGroup label="Email">
                  {(ids) => <Input {...ids} required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}
                </FieldGroup>
                <FieldGroup label="Role">
                  {(ids) => (
                    <Select {...ids} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                      <option value="viewer">Viewer</option>
                      <option value="operator">Operator</option>
                      <option value="admin">Admin</option>
                    </Select>
                  )}
                </FieldGroup>
                <FieldGroup label="Temporary password">
                  {(ids) => (
                    <div className="flex items-center gap-1.5">
                      <Input {...ids} required minLength={10} value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} className="w-40" />
                      <button
                        type="button"
                        onClick={() => setTempPassword(randomPassword())}
                        title="Generate a random password"
                        aria-label="Generate a random password"
                        className="flex cursor-pointer items-center justify-center rounded-md border border-border p-2 text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary"
                      >
                        <Dices size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </FieldGroup>
                <Button type="submit" disabled={inviting}>
                  {inviting ? "Inviting…" : "Invite"}
                </Button>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="cursor-pointer accent-accent" />
                Email these login details to them (via the SMTP settings in Notifications)
              </label>
            </form>
            {error && (
              <p role="alert" className="mt-2 text-sm text-critical">
                {error}
              </p>
            )}
          </CardBody>
        </Card>

        {users === null ? (
          <SkeletonRows count={4} />
        ) : users.length === 0 ? (
          <EmptyState icon={UsersIcon} title="No other users yet" description="Invite teammates above." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border-strong text-left text-2xs font-medium uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-2 text-text-primary">{u.email}</td>
                    <td className="px-3 py-2">
                      <Select value={u.role} disabled={u.id === me?.id} onChange={(e) => changeRole(u.id, e.target.value)} className="py-1 text-xs">
                        <option value="viewer">Viewer</option>
                        <option value="operator">Operator</option>
                        <option value="admin">Admin</option>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={u.disabled ? "critical" : "success"}>{u.disabled ? "Disabled" : "Active"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => viewSessions(u.id)} className="mr-3 cursor-pointer text-xs text-accent transition-colors duration-150 hover:text-accent/80">
                        Sessions
                      </button>
                      <button
                        disabled={u.id === me?.id}
                        onClick={() => toggleDisabled(u)}
                        className="cursor-pointer text-xs text-critical transition-colors duration-150 hover:text-critical/80 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        {u.disabled ? "Enable" : "Disable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sessionsFor && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-medium text-text-secondary">Sessions</h3>
            <div className="space-y-1 text-sm">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between border-t border-border py-1.5">
                  <span className="text-text-secondary">
                    {s.ip ?? "unknown IP"} · created {new Date(s.createdAt).toLocaleString()}
                    {s.revokedAt && " · revoked"}
                  </span>
                  {!s.revokedAt && (
                    <button onClick={() => revokeSession(s.id)} className="cursor-pointer text-xs text-critical transition-colors duration-150 hover:text-critical/80">
                      Revoke
                    </button>
                  )}
                </div>
              ))}
              {sessions.length === 0 && <p className="text-text-secondary">No sessions.</p>}
            </div>
          </Card>
        )}
      </div>
    </Layout>
  );
}
