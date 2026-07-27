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
      <section id="contact" className="bg-canvas py-24">
        <div className="mx-auto max-w-lg px-6 text-center">
          <CheckCircle2 size={40} className="mx-auto text-accent" aria-hidden="true" />
          <h2 className="mt-4 font-display text-xl font-bold text-fog">Message sent.</h2>
          <p className="mt-2 text-muted">We'll get back to you at the email you gave us, usually within one business day.</p>
        </div>
      </section>
    );
  }

  return (
    <section id="contact" className="bg-canvas py-24">
      <div className="mx-auto max-w-lg px-6">
        <ScrollReveal className="mb-10 text-center">
          <span className="font-display text-xs font-bold uppercase tracking-[0.16em] text-accent">Talk to sales</span>
          <h2 className="mt-3 font-display text-[clamp(1.6rem,3vw,2.2rem)] font-bold text-fog">Tell us about your network.</h2>
          <p className="mt-3 text-muted">
            Or email us directly at{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="text-accent underline underline-offset-2">
              {SITE.contactEmail}
            </a>
            .
          </p>
        </ScrollReveal>

        <ScrollReveal delay={0.1}>
          <form onSubmit={handleSubmit} className="grid gap-4 rounded-2xl border border-border bg-surface/50 p-6 backdrop-blur-xl">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  autoComplete="name"
                />
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
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Company">
                <input value={company} onChange={(e) => setCompany(e.target.value)} className="input" autoComplete="organization" />
              </Field>
              <Field label="Approx. device count">
                <input value={devices} onChange={(e) => setDevices(e.target.value)} className="input" placeholder="e.g. 150" inputMode="numeric" />
              </Field>
            </div>
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
                className="input h-28 resize-none"
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
              className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-bold text-accent-text-on transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
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
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
