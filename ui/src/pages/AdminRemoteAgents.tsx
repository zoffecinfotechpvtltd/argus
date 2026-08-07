import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Radio, Trash2 } from "lucide-react";
import { Layout } from "../components/Layout";
import { api, ApiError } from "../api/client";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, SkeletonRows, useConfirm, useToast } from "../components/ui";

interface RemoteAgentSummary {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

/** Last-seen freshness heuristic — an agent that's polled at least once in the last 5 minutes
 * (double the default 30s cycle plus slack for a slow segment) is presumed healthy; anything older
 * gets called out, since "the agent process died three days ago" is exactly the kind of silent
 * failure a remote poller is otherwise invisible about. */
const STALE_AFTER_MS = 5 * 60 * 1000;

export function AdminRemoteAgents() {
  const [agents, setAgents] = useState<RemoteAgentSummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setAgents(await api.get<RemoteAgentSummary[]>("/remote-agents"));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function createAgent() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.post<{ token: string }>("/remote-agents", { name: name.trim() });
      setFreshToken(res.token);
      setName("");
      await load();
    } catch {
      toast.error("Failed to create agent.");
    } finally {
      setCreating(false);
    }
  }

  async function copyFreshToken() {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken).catch(() => {});
    toast.success("Token copied to clipboard.");
  }

  async function revokeAgent(agent: RemoteAgentSummary) {
    const ok = await confirm({
      title: "Revoke this agent?",
      message: `Revoke "${agent.name}"? It will immediately stop being able to push check results — devices assigned to it will show stale data until reassigned or the agent's replaced.`,
      confirmLabel: "Revoke",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/remote-agents/${agent.id}`);
      toast.success("Agent revoked.");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to revoke agent.");
    }
  }

  const sortedAgents = useMemo(() => (agents ?? []).slice().sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt)), [agents]);
  const activeCount = (agents ?? []).filter((a) => !a.revokedAt).length;

  return (
    <Layout title="Remote Agents" subtitle="Lightweight pollers for network segments this instance can't reach directly">
      <div className="mx-auto max-w-3xl space-y-6">
        {agents !== null && agents.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-bg-surface p-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Active agents</p>
              <p className="mt-1 text-sm font-semibold text-text-primary">{activeCount}</p>
            </div>
            <div className="rounded-lg border border-border bg-bg-surface p-3">
              <p className="text-2xs font-medium uppercase tracking-wide text-text-muted">Revoked</p>
              <p className="mt-1 text-sm font-semibold text-text-secondary">{agents.length - activeCount}</p>
            </div>
          </div>
        )}

        <Card>
          <CardBody>
            <CardHeader title="Create an agent" />
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              An agent is a small standalone process (<code className="rounded bg-bg-subtle px-1">bun run agent</code>, see the docs) you run
              inside a network segment this instance can't reach directly — it polls ICMP/TCP/HTTP checks locally on devices you assign to it and
              pushes results back. SNMP and vendor-API checks aren't supported on agent-assigned devices yet. Set{" "}
              <code className="rounded bg-bg-subtle px-1">ARGUS_AGENT_TOKEN</code> and{" "}
              <code className="rounded bg-bg-subtle px-1">ARGUS_CENTRAL_URL</code> to the token below and this instance's URL. Assign devices to
              an agent from that device's edit screen in Inventory.
            </p>
            {freshToken && (
              <div className="mb-4 rounded-md border border-accent/30 bg-accent-subtle p-3">
                <p className="mb-1 text-xs font-medium text-text-primary">Your new agent token (copy it now — it won't be shown again):</p>
                <div className="flex items-center gap-2">
                  <code className="block flex-1 break-all rounded bg-bg-subtle px-2 py-1.5 text-xs text-text-primary">{freshToken}</code>
                  <Button variant="secondary" size="sm" onClick={copyFreshToken}>
                    <Copy size={13} aria-hidden="true" /> Copy
                  </Button>
                </div>
                <button onClick={() => setFreshToken(null)} className="mt-2 cursor-pointer text-xs text-accent hover:text-accent/80">
                  Dismiss
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <Input className="min-w-[220px] flex-1" placeholder="Agent name (e.g. Branch office VLAN)" value={name} onChange={(e) => setName(e.target.value)} />
              <Button onClick={createAgent} disabled={creating || !name.trim()}>
                <Plus size={14} aria-hidden="true" /> {creating ? "Creating…" : "Create agent"}
              </Button>
            </div>
          </CardBody>
        </Card>

        {agents === null ? (
          <SkeletonRows count={3} />
        ) : agents.length === 0 ? (
          <EmptyState icon={Radio} title="No remote agents yet" description="Create one above to start monitoring a segmented network." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Last seen</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedAgents.map((a) => {
                  const stale = !a.revokedAt && (!a.lastSeenAt || Date.now() - new Date(a.lastSeenAt).getTime() > STALE_AFTER_MS);
                  return (
                    <tr key={a.id} className={`border-b border-border/60 last:border-b-0 ${a.revokedAt ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-text-primary">{a.name}</td>
                      <td className="px-3 py-2 text-text-secondary">{new Date(a.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 text-text-secondary">{a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleString() : "Never"}</td>
                      <td className="px-3 py-2">
                        {a.revokedAt ? (
                          <Badge tone="critical">Revoked</Badge>
                        ) : stale ? (
                          <Badge tone="warning">Not checking in</Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {!a.revokedAt && (
                          <button
                            onClick={() => revokeAgent(a)}
                            aria-label={`Revoke ${a.name}`}
                            className="cursor-pointer rounded p-1.5 text-text-secondary transition-colors duration-150 hover:bg-critical-subtle hover:text-critical"
                          >
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
