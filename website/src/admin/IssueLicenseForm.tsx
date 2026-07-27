import { useState } from "react";
import { CheckCircle2, KeyRound, AlertTriangle } from "lucide-react";
import { LICENSE_PLANS, PLAN_DEVICE_RANGES, suggestPlanForDeviceCount, type LicensePlan } from "./planData";

interface IssueResult {
  ok: boolean;
  licenseFile?: string;
  emailed?: boolean;
  emailError?: string;
  error?: string;
  message?: string;
}

export function IssueLicenseForm({ onIssued }: { onIssued: () => void }) {
  const [customer, setCustomer] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [devices, setDevices] = useState("");
  const [plan, setPlan] = useState<LicensePlan>("starter");
  const [planTouched, setPlanTouched] = useState(false);
  const [perpetual, setPerpetual] = useState(false);
  const [expires, setExpires] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IssueResult | null>(null);

  function onDevicesChange(v: string) {
    setDevices(v);
    const n = Number(v);
    if (!planTouched && Number.isFinite(n) && n > 0) setPlan(suggestPlanForDeviceCount(n));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/licenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer, contactEmail, plan, devices: Number(devices), perpetual, expires, sendEmail }),
      });
      const data: IssueResult = await res.json();
      setResult(data);
      if (res.ok) {
        onIssued();
        setCustomer("");
        setContactEmail("");
        setDevices("");
        setExpires("");
        setPlanTouched(false);
      }
    } catch {
      setResult({ ok: false, message: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const range = PLAN_DEVICE_RANGES[plan];

  return (
    <section className="rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <div className="mb-6 flex items-center gap-2">
        <KeyRound size={18} className="text-accent" />
        <h2 className="font-display text-lg font-semibold">Issue a license</h2>
      </div>

      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-sm text-muted">Customer / company name</label>
          <input className="input" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Acme Corp" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-muted">Contact email</label>
          <input
            type="email"
            className="input"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="ops@acme.com"
            required={sendEmail}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm text-muted">Device limit</label>
          <input type="number" min={1} className="input" value={devices} onChange={(e) => onDevicesChange(e.target.value)} placeholder="150" required />
        </div>
        <div>
          <label className="mb-1.5 block text-sm text-muted">Plan</label>
          <select
            className="input"
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value as LicensePlan);
              setPlanTouched(true);
            }}
          >
            {LICENSE_PLANS.map((p) => (
              <option key={p} value={p}>
                {PLAN_DEVICE_RANGES[p].label} ({PLAN_DEVICE_RANGES[p].min}–{PLAN_DEVICE_RANGES[p].max ?? "∞"} devices)
              </option>
            ))}
          </select>
          {devices && (Number(devices) < range.min || (range.max !== null && Number(devices) > range.max)) ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-500">
              <AlertTriangle size={12} aria-hidden="true" />
              {range.label} is sold for {range.min}–{range.max ?? "∞"} devices.
            </p>
          ) : (
            <p className="mt-1 text-xs text-dim">Auto-suggested from device limit — change it if you're selling an exception.</p>
          )}
        </div>

        <div className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" id="perpetual" checked={perpetual} onChange={(e) => setPerpetual(e.target.checked)} className="h-4 w-4 accent-accent" />
          <label htmlFor="perpetual" className="text-sm text-fog">
            Perpetual (one-time purchase, no renewal)
          </label>
        </div>

        {!perpetual && (
          <div>
            <label className="mb-1.5 block text-sm text-muted">Expires on</label>
            <input type="date" className="input" value={expires} onChange={(e) => setExpires(e.target.value)} required={!perpetual} />
          </div>
        )}

        <div className="flex items-center gap-2 sm:col-span-2">
          <input type="checkbox" id="sendEmail" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} className="h-4 w-4 accent-accent" />
          <label htmlFor="sendEmail" className="text-sm text-fog">
            Email this license to the contact address now
          </label>
        </div>

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-text-on transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Issuing…" : "Issue license"}
          </button>
        </div>
      </form>

      {result && (
        <div className={`mt-6 rounded-lg border p-4 text-sm ${result.ok ? "border-accent/30 bg-accent/5" : "border-status-critical/30 bg-status-critical/5"}`}>
          {result.ok ? (
            <>
              <p className="mb-2 flex items-center gap-2 font-medium text-fog">
                <CheckCircle2 size={16} className="text-accent" />
                License issued{result.emailed ? " and emailed." : "."}
              </p>
              {!result.emailed && result.emailError && <p className="mb-2 text-status-warning">Email failed: {result.emailError}</p>}
              <textarea readOnly className="input h-24 font-mono text-xs" value={result.licenseFile} onClick={(e) => e.currentTarget.select()} />
            </>
          ) : (
            <p className="text-status-critical">{result.message || result.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
