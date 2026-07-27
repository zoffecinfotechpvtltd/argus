import { useEffect, useState } from "react";
import { History, Mail, MailX } from "lucide-react";
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
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.licenseId} className="border-b border-border/60">
                  <td className="py-2 pr-4">
                    {r.customer}
                    <div className="text-xs text-dim">{r.contactEmail}</div>
                  </td>
                  <td className="py-2 pr-4">{PLAN_DEVICE_RANGES[r.plan]?.label ?? r.plan}</td>
                  <td className="py-2 pr-4 tabular-nums">{r.deviceLimit}</td>
                  <td className="py-2 pr-4">{new Date(r.issuedAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">{new Date(r.expiresAt).getFullYear() > new Date().getFullYear() + 40 ? "Perpetual" : new Date(r.expiresAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">
                    {r.emailed ? <Mail size={15} className="text-accent" /> : <MailX size={15} className="text-dim" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
