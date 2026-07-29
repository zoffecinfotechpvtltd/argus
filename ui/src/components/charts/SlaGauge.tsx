import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { useEchartsColors } from "../../lib/echartsTheme";

/** Radial SLA gauge — ECharts `gauge` series. A percentage this close to 100 (typically
 * 99.0-100.0) is exactly the case a plain linear progress bar hides: the last percentage point is
 * the one that matters most and a bar makes it look identical to being at 60%. The gauge's arc +
 * big center number reads at a glance the way an actual NOC wallboard gauge does. */
export function SlaGauge({ pct, targetPct }: { pct: number; targetPct: number }) {
  const colors = useEchartsColors();

  const option = useMemo(() => {
    const good = pct >= targetPct;
    const needleColor = good ? colors.success : pct >= targetPct - 0.5 ? colors.warning : colors.critical;
    return {
      series: [
        {
          type: "gauge",
          startAngle: 210,
          endAngle: -30,
          min: Math.max(0, Math.floor(targetPct) - 2),
          max: 100,
          radius: "100%",
          center: ["50%", "60%"],
          progress: { show: true, width: 10, itemStyle: { color: needleColor } },
          axisLine: { lineStyle: { width: 10, color: [[1, colors.bgSubtle]] } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, "-5%"],
            formatter: (v: number) => `${v.toFixed(1)}%`,
            color: colors.textPrimary,
            fontSize: 22,
            fontWeight: 700,
            fontFamily: "Geist, ui-sans-serif, sans-serif",
          },
          title: {
            offsetCenter: [0, "35%"],
            color: colors.textMuted,
            fontSize: 11,
            fontFamily: "Geist, ui-sans-serif, sans-serif",
          },
          data: [{ value: pct, name: `target ${targetPct}%` }],
        },
      ],
    };
  }, [pct, targetPct, colors]);

  return <ReactECharts option={option} style={{ height: 110, width: 110 }} notMerge lazyUpdate />;
}
