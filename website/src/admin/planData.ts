// Client-side mirror of the plan labels/ranges in api/lib/license.ts (display + suggestion only —
// the server independently validates, so this being slightly stale is a UX nit, not a security gap).
export type LicensePlan = "starter" | "professional" | "business" | "enterprise" | "unlimited";

export const PLAN_DEVICE_RANGES: Record<LicensePlan, { label: string; min: number; max: number | null }> = {
  starter: { label: "Starter", min: 1, max: 25 },
  professional: { label: "Professional", min: 26, max: 100 },
  business: { label: "Business", min: 101, max: 500 },
  enterprise: { label: "Enterprise", min: 501, max: 2000 },
  unlimited: { label: "Unlimited", min: 2001, max: null },
};

export const LICENSE_PLANS: LicensePlan[] = ["starter", "professional", "business", "enterprise", "unlimited"];

export function suggestPlanForDeviceCount(devices: number): LicensePlan {
  for (const plan of LICENSE_PLANS) {
    const range = PLAN_DEVICE_RANGES[plan];
    if (devices >= range.min && (range.max === null || devices <= range.max)) return plan;
  }
  return "unlimited";
}
