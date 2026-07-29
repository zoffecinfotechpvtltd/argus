import { useState, type FormEvent } from "react";
import { Mail, CheckCircle2, AlertCircle } from "lucide-react";
import { ScrollReveal } from "./ScrollReveal";
import { SITE } from "../config";

const PLANS = ["Starter", "Professional", "Business", "Enterprise", "Unlimited", "Not sure yet"];

type Status = "idle" | "submitting" | "sent" | "error";

export function Contact({ plan, onPlanChange }: { plan: string; onPlanChange: (v: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [devices, setDevices] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, devices, plan, message }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      setStatus("sent");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  }

  if (status === "sent") {
    return (
      <section id="contact" className="bg-canvas py-24 sm:py-32">
        <div className="mx-auto max-w-lg px-6 text-center">
          <CheckCircle2 size={36} className="mx-auto text-accent" aria-hidden="true" />
          <h2 className="mt-4 font-display text-xl font-bold tracking-tight text-fog">Message sent.</h2>
          <p className="mt-2 text-muted">We'll get back to you at the email you gave us, usually within one business day.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="contact" className="bg-canvas py-24 sm:py-32">
      <div className="mx-auto grid max-w-5xl grid-cols-1 gap-16 px-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
        <ScrollReveal>
          <span className="text-sm font-medium text-accent">Talk to sales</span>
          <h2 className="mt-3 font-display text-[clamp(1.9rem,4vw,2.6rem)] font-bold tracking-tight text-fog">
            Tell us about your network.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-muted">
            No self-serve checkout — tell us your device count and what you're running, and we'll quote the right
            tier. Prefer email? Reach us directly at{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="text-accent underline underline-offset-2">
              {SITE.contactEmail}
            </a>
            .
          </p>

          <ol className="mt-10 grid max-w-md gap-7">
            {[
              { title: "You tell us the basics", body: "Device count, what you're monitoring, which tier looks right." },
              { title: "We quote it", body: "Usually within one business day — a flat price by device count, no seats." },
              { title: "You get a license key", body: "Paste it into Settings → License and the device cap lifts immediately." },
            ].map((step, i) => (
              <li key={step.title} className="flex gap-4">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-subtle font-mono text-[13px] font-semibold text-accent">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[15px] font-semibold text-fog">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <form
            onSubmit={handleSubmit}
            className="grid gap-5 rounded-2xl border border-border bg-surface p-6 shadow-soft sm:p-8"
          >
            <Field label="Name">
              <input required value={name} onChange={(e) => setName(e.target.value)} className="input" autoComplete="name" />
            </Field>
            <Field label="Work email">
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                autoComplete="email"
              />
            </Field>
            <Field label="Company">
              <input value={company} onChange={(e) => setCompany(e.target.value)} className="input" autoComplete="organization" />
            </Field>
            <Field label="Approx. device count">
              <input value={devices} onChange={(e) => setDevices(e.target.value)} className="input" placeholder="e.g. 150" inputMode="numeric" />
            </Field>
            <Field label="Plan you're interested in">
              <select value={plan} onChange={(e) => onPlanChange(e.target.value)} className="input">
                <option value="">Select a plan…</option>
                {PLANS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Message">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full resize-none rounded-lg border border-border bg-transparent px-3.5 py-3 text-base text-fog placeholder:text-dim transition-colors focus:border-fog focus:outline-none"
                rows={3}
                placeholder="Anything else we should know?"
              />
            </Field>

            {status === "error" && (
              <p role="alert" className="flex items-center gap-2 text-sm text-status-critical">
                <AlertCircle size={15} aria-hidden="true" /> {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "submitting"}
              className="mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-text-on transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Mail size={15} aria-hidden="true" />
              {status === "submitting" ? "Sending…" : "Send message"}
            </button>
          </form>
        </ScrollReveal>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
