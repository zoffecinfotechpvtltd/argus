import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Radar, BellRing, LayoutDashboard, ShieldCheck, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../api/client";
import { Button, Modal } from "../ui";

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Optional deep link into the page this step is talking about — closes the tour and navigates,
   * since staying on top of the real page is more useful than describing it in the abstract once
   * someone's ready to act on it. */
  cta?: { label: string; to: string };
}

const STEPS: Step[] = [
  {
    icon: Rocket,
    title: "Welcome to Argus",
    body: "Argus watches every device on your network and tells you — and the right person on your team — the moment one goes down. This is a 60-second tour of how to actually put it to work.",
  },
  {
    icon: Radar,
    title: "Add your devices",
    body: "Point Discovery at a subnet (e.g. 192.168.1.0/24) and it finds what's there, guesses what each device is, and suggests checks — in seconds. Prefer to add one by hand instead? Inventory does that too.",
    cta: { label: "Go to Discovery", to: "/discovery" },
  },
  {
    icon: BellRing,
    title: "Set up alerting",
    body: "Each device group has an escalation chain — the owner is notified first, then it works up the chain if nobody acknowledges. Configure where those notifications actually go (email, webhook, syslog) in Notifications.",
    cta: { label: "Go to Notifications", to: "/settings/notifications" },
  },
  {
    icon: LayoutDashboard,
    title: "Watch the Dashboard",
    body: "Device health, traffic, alert activity, and SLA history all live on the Dashboard — the one screen worth keeping open on a second monitor.",
    cta: { label: "Go to Dashboard", to: "/" },
  },
  {
    icon: ShieldCheck,
    title: "You're set",
    body: "One more thing worth doing early: turn on two-factor authentication under Settings → Security. If you're an admin, that's also where you'll find License, Users, and the rest of the admin area.",
  },
];

export function OnboardingTour() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  const show = !!user && !user.onboardingCompletedAt;
  if (!show) return null;

  async function complete() {
    setDismissing(true);
    try {
      await api.post("/auth/onboarding-complete");
    } catch {
      // Non-fatal: worst case the tour shows again next login, never blocks the app.
    } finally {
      await refresh();
      setDismissing(false);
    }
  }

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      open={show}
      onClose={complete}
      size="lg"
      ariaLabel={`${current.title} (step ${step + 1} of ${STEPS.length})`}
      title={
        <span className="flex items-center justify-between">
          <span className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span key={i} className={`h-1.5 w-6 rounded-full transition-colors ${i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-bg-subtle"}`} />
            ))}
          </span>
          <button type="button" onClick={complete} disabled={dismissing} className="text-xs font-medium text-text-secondary hover:text-text-primary">
            Skip
          </button>
        </span>
      }
    >
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-accent-subtle text-accent">
        <current.icon size={20} aria-hidden="true" />
      </div>
      <p className="text-lg font-semibold text-text-primary">{current.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{current.body}</p>

      <div className="mt-8 flex items-center justify-between">
        <Button variant="secondary" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        <div className="flex gap-2">
          {current.cta && (
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await complete();
                navigate(current.cta!.to);
              }}
            >
              {current.cta.label}
            </Button>
          )}
          <Button size="sm" disabled={dismissing} onClick={() => (isLast ? complete() : setStep((s) => Math.min(STEPS.length - 1, s + 1)))}>
            {isLast ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
