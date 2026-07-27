import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Layout } from "../components/Layout";
import { api } from "../api/client";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Input, SkeletonRows, useConfirm, useToast } from "../components/ui";

interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export function AdminApiKeys() {
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  async function load() {
    setKeys(await api.get<ApiKeySummary[]>("/admin/api-keys"));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function createKey() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.post<{ token: string }>("/admin/api-keys", { name: name.trim() });
      setFreshToken(res.token);
      setName("");
      await load();
    } catch {
      toast.error("Failed to create API key.");
    } finally {
      setCreating(false);
    }
  }

  async function copyFreshToken() {
    if (!freshToken) return;
    await navigator.clipboard.writeText(freshToken).catch(() => {});
    toast.success("Key copied to clipboard.");
  }

  async function revokeKey(key: ApiKeySummary) {
    const ok = await confirm({
      title: "Revoke API key?",
      message: `Revoke "${key.name}"? Anything using it will immediately stop working.`,
      confirmLabel: "Revoke",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/admin/api-keys/${key.id}`);
    toast.success("API key revoked.");
    await load();
  }

  return (
    <Layout title="API Keys" subtitle="Read-only external access for integrations (Prometheus, CMDB sync, reporting tools)">
      <div className="mx-auto max-w-3xl space-y-6">
        <Card>
          <CardBody>
            <CardHeader title="Create a key" />
            <p className="mb-4 text-xs leading-relaxed text-text-secondary">
              Keys are read-only by design — they can list devices/alerts, read metrics, and pull reports (including the
              Prometheus-format endpoint at <code className="rounded bg-bg-subtle px-1">/api/metrics/prometheus</code>), but they can
              never create, edit, or delete anything. Send the key as <code className="rounded bg-bg-subtle px-1">Authorization: Bearer &lt;token&gt;</code>.
              The full token is shown exactly once, right after creation — store it somewhere safe.
            </p>
            {freshToken && (
              <div className="mb-4 rounded-md border border-accent/30 bg-accent-subtle p-3">
                <p className="mb-1 text-xs font-medium text-text-primary">Your new key (copy it now — it won't be shown again):</p>
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
              <Input className="min-w-[220px] flex-1" placeholder="Key name (e.g. Grafana scraper)" value={name} onChange={(e) => setName(e.target.value)} />
              <Button onClick={createKey} disabled={creating || !name.trim()}>
                <Plus size={14} aria-hidden="true" /> {creating ? "Creating…" : "Create key"}
              </Button>
            </div>
          </CardBody>
        </Card>

        {keys === null ? (
          <SkeletonRows count={3} />
        ) : keys.length === 0 ? (
          <EmptyState icon={KeyRound} title="No API keys yet" description="Create one above to enable external read-only integrations." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Prefix</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Last used</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-border/60 last:border-b-0">
                    <td className="px-3 py-2 text-text-primary">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-text-secondary">argus_{k.keyPrefix}_…</td>
                    <td className="px-3 py-2 text-text-secondary">{new Date(k.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-text-secondary">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={k.revokedAt ? "critical" : "success"}>{k.revokedAt ? "Revoked" : "Active"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!k.revokedAt && (
                        <button
                          onClick={() => revokeKey(k)}
                          aria-label={`Revoke ${k.name}`}
                          className="cursor-pointer rounded p-1.5 text-text-secondary transition-colors duration-150 hover:bg-critical-subtle hover:text-critical"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
