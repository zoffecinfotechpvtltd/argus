import { useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, Select, SkeletonRows, useToast } from "../components/ui";
import { Users as UsersIcon, Link2, Copy } from "lucide-react";

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
    await api.patch(`/users/${id}/role`, { role: newRole });
    toast.success("Role updated.");
    await load();
  }

  async function toggleDisabled(u: AdminUser) {
    await api.patch(`/users/${u.id}/disabled`, { disabled: !u.disabled });
    toast.success(u.disabled ? `${u.email} enabled.` : `${u.email} disabled.`);
    await load();
  }

  async function viewSessions(id: string) {
    setSessionsFor(id);
    setSessions(await api.get<SessionRow[]>(`/users/${id}/sessions`));
  }

  async function revokeSession(id: string) {
    await api.delete(`/sessions/${id}`);
    if (sessionsFor) setSessions(await api.get<SessionRow[]>(`/users/${sessionsFor}/sessions`));
    toast.success("Session revoked.");
  }

  async function copyShareUrl() {
    await navigator.clipboard.writeText(shareUrl).catch(() => {});
    toast.success("Link copied.");
  }

  return (
    <Layout title="Users" subtitle="Invite teammates and manage roles and sessions">
      <div className="mx-auto max-w-4xl space-y-6">
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
                <div>
                  <label className="mb-1 block text-xs text-text-secondary">Email</label>
                  <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-secondary">Role</label>
                  <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                    <option value="viewer">Viewer</option>
                    <option value="operator">Operator</option>
                    <option value="admin">Admin</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-secondary">Temporary password</label>
                  <Input required minLength={10} value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} />
                </div>
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
