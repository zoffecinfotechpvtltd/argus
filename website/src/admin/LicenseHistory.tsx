import { useEffect, useState } from "react";
import { History, Mail, MailX, Trash2 } from "lucide-react";
import { PLAN_DEVICE_RANGES, type LicensePlan } from "./planData";

interface IssuedRecord {
  licenseId: string;
  customer: string;
  contactEmail: string;
  plan: LicensePlan;
  deviceLimit: number;
  issuedAt: string;
  expiresAt: string;
  emailed: boolean;
}

export function LicenseHistory({ refreshKey }: { refreshKey: number }) {
  const [configured, setConfigured] = useState(true);
  const [records, setRecords] = useState<IssuedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/licenses")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(!!d.configured);
        setRecords(d.records ?? []);
      })
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function handleDelete(record: IssuedRecord) {
    const isPerpetual = new Date(record.expiresAt).getFullYear() > new Date().getFullYear() + 40;
    const expiryNote = isPerpetual ? "" : ` (expired/expires ${new Date(record.expiresAt).toLocaleDateString()})`;
    const confirmed = window.confirm(
      `Remove ${record.customer}'s license${expiryNote} from this history list?\n\n` +
        "This only removes it from your records here — Argus licenses are verified offline, so it does NOT " +
        "disable a license file already delivered to the customer."
    );
    if (!confirmed) return;

    setDeletingId(record.licenseId);
    try {
      const res = await fetch(`/api/admin/licenses?licenseId=${encodeURIComponent(record.licenseId)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Delete failed (${res.status})`);
      }
      setRecords((prev) => prev.filter((r) => r.licenseId !== record.licenseId));
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <div className="mb-4 flex items-center gap-2">
        <History size={18} className="text-accent" />
        <h2 className="font-display text-lg font-semibold">Previously issued</h2>
      </div>

      {!configured && !loading && (
        <p className="rounded-lg border border-border bg-canvas px-4 py-3 text-sm text-muted">
          No issuance history is stored — set <code className="text-fog">KV_REST_API_URL</code> / <code className="text-fog">KV_REST_API_TOKEN</code>{" "}
          (a Vercel KV / Upstash Redis store) on this deployment to keep a record of every license issued here. Issuing still works without it.
        </p>
      )}

      {configured && !loading && records.length === 0 && <p className="text-sm text-muted">Nothing issued from this portal yet.</p>}

      {records.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-dim">
                <th className="py-2 pr-4">Customer</th>
                <th className="py-2 pr-4">Plan</th>
                <th className="py-2 pr-4">Devices</th>
                <th className="py-2 pr-4">Issued</th>
                <th className="py-2 pr-4">Expires</th>
                <th className="py-2 pr-4">Emailed</th>
                <th className="py-2 pr-0" />
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const isPerpetual = new Date(r.expiresAt).getFullYear() > new Date().getFullYear() + 40;
                const isExpired = !isPerpetual && new Date(r.expiresAt).getTime() < Date.now();
                return (
                  <tr key={r.licenseId} className={`border-b border-border/60 ${isExpired ? "opacity-60" : ""}`}>
                    <td className="py-2 pr-4">
                      {r.customer}
                      <div className="text-xs text-dim">{r.contactEmail}</div>
                    </td>
                    <td className="py-2 pr-4">{PLAN_DEVICE_RANGES[r.plan]?.label ?? r.plan}</td>
                    <td className="py-2 pr-4 tabular-nums">{r.deviceLimit}</td>
                    <td className="py-2 pr-4">{new Date(r.issuedAt).toLocaleDateString()}</td>
                    <td className="py-2 pr-4">
                      {isPerpetual ? "Perpetual" : new Date(r.expiresAt).toLocaleDateString()}
                      {isExpired && <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-500">Expired</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {r.emailed ? <Mail size={15} className="text-accent" /> : <MailX size={15} className="text-dim" />}
                    </td>
                    <td className="py-2 pr-0 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        disabled={deletingId === r.licenseId}
                        title="Remove from this history list (does not revoke the delivered license file)"
                        className="rounded-md p-1.5 text-dim transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
