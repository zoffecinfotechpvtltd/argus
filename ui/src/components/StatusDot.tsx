import { DEVICE_STATE_FALLBACK_HEX, DEVICE_STATE_HEX } from "../lib/statusTokens";

export function StatusDot({ state, pulse = false, size = 10 }: { state: string | null; pulse?: boolean; size?: number }) {
  const color = DEVICE_STATE_HEX[state as keyof typeof DEVICE_STATE_HEX] ?? DEVICE_STATE_FALLBACK_HEX;
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      {pulse && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: color }} />}
      <span className="relative inline-flex rounded-full" style={{ width: size, height: size, backgroundColor: color }} />
    </span>
  );
}

export function statusColor(state: string | null): string {
  return DEVICE_STATE_HEX[state as keyof typeof DEVICE_STATE_HEX] ?? DEVICE_STATE_FALLBACK_HEX;
}
