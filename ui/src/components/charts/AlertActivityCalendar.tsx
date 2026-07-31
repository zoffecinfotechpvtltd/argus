import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { format, subDays } from "date-fns";
import { Card } from "../ui";
import { api } from "../../api/client";
import { useEchartsColors, echartsTooltipStyle } from "../../lib/echartsTheme";
import { SEVERITY_HEX } from "../../lib/statusTokens";

const DAYS = 35;

interface DayRow {
  day: string;
  severity: string;
  count: number;
}

/** ECharts `calendar` + `heatmap` — a real calendar grid (correct week/weekday alignment, month
 * boundaries) instead of the hand-rolled div grid this replaces. Cell color is the worst severity
 * present that day (critical > warning > info > none, same rule the old component used), opacity
 * scales with total alert count so a quiet critical day still reads as lighter than a busy one.
 * Self-fetches from the same /reports/alerts-summary endpoint the old AlertHeatmapCard used,
 * just over its own 35-day window (AlertsTrendCard's 14-day fetch is a different range, so the
 * two aren't sharing one call). */
export function AlertActivityCalendar({ className = "" }: { className?: string }) {
  const colors = useEchartsColors();
  const [rows, setRows] = useState<DayRow[] | null>(null);

  useEffect(() => {
    const to = new Date();
    const from = subDays(to, DAYS - 1);
    api
      .get<DayRow[]>(`/reports/alerts-summary?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  const loading = rows === null;

  const { data, allZero, range } = useMemo(() => {
    const to = new Date();
    const from = subDays(to, DAYS - 1);
    const byDay = new Map<string, { critical: number; warning: number; info: number }>();
    for (let i = 0; i < DAYS; i++) {
      const key = format(subDays(to, DAYS - 1 - i), "yyyy-MM-dd");
      byDay.set(key, { critical: 0, warning: 0, info: 0 });
    }
    for (const r of rows ?? []) {
      const key = r.day.slice(0, 10);
      const cell = byDay.get(key);
      if (cell && (r.severity === "critical" || r.severity === "warning" || r.severity === "info")) cell[r.severity] = r.count;
    }
    const maxTotal = Math.max(1, ...[...byDay.values()].map((c) => c.critical + c.warning + c.info));
    let zero = true;
    const points = [...byDay.entries()].map(([date, c]) => {
      const total = c.critical + c.warning + c.info;
      if (total > 0) zero = false;
      const worst = c.critical > 0 ? SEVERITY_HEX.critical : c.warning > 0 ? SEVERITY_HEX.warning : c.info > 0 ? SEVERITY_HEX.info : null;
      const opacity = total > 0 ? 0.35 + 0.65 * (total / maxTotal) : 1;
      return {
        value: [date, total],
        detail: c,
        itemStyle: { color: worst ?? colors.bgSubtle, opacity: worst ? opacity : 1 },
      };
    });
    return { data: points, allZero: zero, range: [format(from, "yyyy-MM-dd"), format(to, "yyyy-MM-dd")] as [string, string] };
  }, [rows, colors.bgSubtle]);

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        ...echartsTooltipStyle(colors),
        formatter: (p: { data: { value: [string, number]; detail: { critical: number; warning: number; info: number } } }) => {
          const [date, total] = p.data.value;
          const { critical, warning, info } = p.data.detail;
          return `<div style="font-weight:600;margin-bottom:2px">${date}</div>${total} alert${total === 1 ? "" : "s"}${
            total > 0 ? `<br/>${critical} critical &middot; ${warning} warning &middot; ${info} info` : ""
          }`;
        },
      },
      calendar: {
        range,
        cellSize: [16, 16],
        splitLine: { lineStyle: { color: colors.border, width: 1 } },
        itemStyle: { color: colors.bgSubtle, borderColor: colors.bgSurface, borderWidth: 2 },
        yearLabel: { show: false },
        monthLabel: { color: colors.textMuted, fontSize: 10, fontFamily: "Geist" },
        dayLabel: { color: colors.textMuted, fontSize: 9, fontFamily: "Geist Mono", firstDay: 1, nameMap: "en" },
        left: 40,
        right: 8,
        top: 24,
        bottom: 8,
      },
      // ECharts throws "Heatmap must use with visualMap" if no visualMap component is registered
      // for the series, even though every cell's color is already set explicitly via itemStyle
      // below (which takes precedence over whatever this would otherwise compute) — this hidden,
      // otherwise-inert visualMap exists only to satisfy that requirement.
      visualMap: { show: false, min: 0, max: 1, seriesIndex: 0 },
      series: [
        {
          type: "heatmap",
          coordinateSystem: "calendar",
          data,
        },
      ],
    }),
    [colors, data, range]
  );

  return (
    <Card className={`p-3 ${className}`}>
      <div className="mb-1 flex items-center justify-between text-xs text-text-secondary">
        <span>Alert activity (last {DAYS} days)</span>
        <div className="hidden gap-2.5 sm:flex">
          {(["info", "warning", "critical"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1 capitalize">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: SEVERITY_HEX[s] }} /> {s}
            </span>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="flex h-[150px] items-center justify-center text-xs text-text-muted">Loading…</div>
      ) : (
        <>
          <ReactECharts option={option} style={{ height: 150, width: "100%" }} notMerge lazyUpdate />
          {allZero && (
            <p className="mt-1 text-center text-2xs text-text-muted">
              No alerts in the last {DAYS} days — every cell above is a genuinely quiet day, not a loading state.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
