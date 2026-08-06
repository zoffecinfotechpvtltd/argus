import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { useEchartsColors, echartsTooltipStyle } from "../../lib/echartsTheme";
import { BentoCard } from "./BentoCard";

interface NotificationLogEntry {
  channel: "email" | "webhook";
  status: "sent" | "failed";
}

/** Where alert notifications actually went and whether they landed — an ECharts `sankey`, a
 * genuinely different chart family from everything else on this dashboard (flow, not
 * category/time/distribution). Two real columns from /notifications/log as delivered (channel,
 * then outcome), not a fabricated multi-stage escalation flow the backend doesn't track per
 * notification event. */
export function NotificationDeliverySankey({ className = "" }: { className?: string }) {
  const colors = useEchartsColors();
  const [entries, setEntries] = useState<NotificationLogEntry[] | null>(null);

  useEffect(() => {
    api
      .get<NotificationLogEntry[]>("/notifications/log?limit=500")
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  const { nodes, links, total } = useMemo(() => {
    const byChannelStatus = new Map<string, number>();
    const channelTotals = new Map<string, number>();
    for (const e of entries ?? []) {
      const key = `${e.channel}::${e.status}`;
      byChannelStatus.set(key, (byChannelStatus.get(key) ?? 0) + 1);
      channelTotals.set(e.channel, (channelTotals.get(e.channel) ?? 0) + 1);
    }
    const channels = [...channelTotals.keys()];
    const nodeList = [
      ...channels.map((c) => ({ name: c, itemStyle: { color: colors.accent } })),
      { name: "sent", itemStyle: { color: colors.success } },
      { name: "failed", itemStyle: { color: colors.critical } },
    ];
    const linkList: { source: string; target: string; value: number }[] = [];
    for (const channel of channels) {
      for (const status of ["sent", "failed"] as const) {
        const value = byChannelStatus.get(`${channel}::${status}`) ?? 0;
        if (value > 0) linkList.push({ source: channel, target: status, value });
      }
    }
    return { nodes: nodeList, links: linkList, total: entries?.length ?? 0 };
  }, [entries, colors]);

  const loading = entries === null;
  const empty = !loading && total === 0;

  const option = useMemo(
    () => ({
      backgroundColor: "transparent",
      tooltip: {
        ...echartsTooltipStyle(colors),
        trigger: "item",
        formatter: (p: { dataType: string; name: string; value?: number; data?: { source?: string; target?: string; value?: number } }) =>
          p.dataType === "edge" ? `${p.data?.source} &rarr; ${p.data?.target}: <strong>${p.data?.value}</strong>` : p.name,
      },
      series: [
        {
          type: "sankey",
          data: nodes,
          links,
          nodeWidth: 14,
          nodeGap: 12,
          layoutIterations: 32,
          emphasis: { focus: "adjacency" },
          lineStyle: { color: "gradient", opacity: 0.35, curveness: 0.5 },
          label: { color: colors.textSecondary, fontSize: 11, fontFamily: "Geist" },
        },
      ],
    }),
    [colors, nodes, links]
  );

  return (
    <BentoCard className={`p-3 ${className}`}>
      <div className="mb-1 text-xs text-text-secondary">Notification delivery{total > 0 ? ` (last ${total})` : ""}</div>
      {loading ? (
        <div className="flex h-[140px] items-center justify-center text-xs text-text-muted">Loading…</div>
      ) : empty ? (
        <div className="flex h-[140px] flex-col items-center justify-center gap-1 text-center text-xs text-text-muted">
          <span>No notifications sent yet</span>
          <Link to="/settings/notifications" className="text-accent hover:opacity-80">
            Set up alert notifications →
          </Link>
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: 140, width: "100%" }} notMerge lazyUpdate />
      )}
    </BentoCard>
  );
}
