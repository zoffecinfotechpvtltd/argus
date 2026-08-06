import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { api } from "../../api/client";
import { useEchartsColors, echartsTooltipStyle } from "../../lib/echartsTheme";
import type { Alert } from "../../api/alertTypes";
import { BentoCard } from "./BentoCard";

const BUCKETS = [
  { label: "<1m", maxMin: 1 },
  { label: "1-5m", maxMin: 5 },
  { label: "5-15m", maxMin: 15 },
  { label: "15-30m", maxMin: 30 },
  { label: "30-60m", maxMin: 60 },
  { label: ">1h", maxMin: Infinity },
];

/** How long it actually takes someone to acknowledge an alert, bucketed — a distribution, not just
 * an average, because "average ack time" hides the difference between "everyone acks in 2 minutes
 * except one alert nobody saw for 6 hours" and "everyone genuinely takes ~20 minutes". Computed
 * client-side from the last 500 alerts' own openedAt/ackedAt timestamps (not a new backend
 * metric) — only alerts that have actually been acknowledged count toward a bucket. */
export function AckTimeHistogram({ className = "" }: { className?: string }) {
  const colors = useEchartsColors();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);

  useEffect(() => {
    api
      .get<{ items: Alert[] }>("/alerts?limit=500")
      .then((p) => setAlerts(p.items))
      .catch(() => setAlerts([]));
  }, []);

  const { counts, sampleSize } = useMemo(() => {
    const buckets = BUCKETS.map(() => 0);
    let n = 0;
    for (const a of alerts ?? []) {
      if (!a.ackedAt) continue;
      const minutes = (new Date(a.ackedAt).getTime() - new Date(a.openedAt).getTime()) / 60_000;
      if (!Number.isFinite(minutes) || minutes < 0) continue;
      const idx = BUCKETS.findIndex((b) => minutes < b.maxMin);
      buckets[idx === -1 ? BUCKETS.length - 1 : idx]!++;
      n++;
    }
    return { counts: buckets, sampleSize: n };
  }, [alerts]);

  const loading = alerts === null;

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      grid: { left: 28, right: 8, top: 8, bottom: 20 },
      tooltip: {
        ...echartsTooltipStyle(colors),
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0]!;
          return `${p.name}: <strong>${p.value}</strong> alert${p.value === 1 ? "" : "s"}`;
        },
      },
      xAxis: {
        type: "category",
        data: BUCKETS.map((b) => b.label),
        axisLine: { lineStyle: { color: colors.border } },
        axisTick: { show: false },
        axisLabel: { color: colors.textMuted, fontSize: 10, fontFamily: "Geist" },
      },
      yAxis: {
        type: "value",
        splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
        axisLabel: { color: colors.textMuted, fontSize: 10, fontFamily: "Geist Mono" },
      },
      series: [
        {
          type: "bar",
          data: counts,
          itemStyle: { color: colors.accent, borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 32,
        },
      ],
    }),
    [colors, counts]
  );

  return (
    <BentoCard className={`p-3 ${className}`}>
      <div className="mb-1 text-xs text-text-secondary">Time to acknowledge{sampleSize > 0 ? ` (last ${sampleSize} acked)` : ""}</div>
      {loading ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-text-muted">Loading…</div>
      ) : sampleSize === 0 ? (
        <div className="flex h-[140px] flex-col items-center justify-center gap-1 text-center text-xs text-text-muted">
          <span>No acknowledged alerts yet</span>
          <span>Fills in as your team acknowledges alerts from the table below</span>
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 140, width: "100%" }} notMerge lazyUpdate />
      )}
    </BentoCard>
  );
}
