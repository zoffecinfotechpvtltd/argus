import { useMemo, useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Badge, Button } from "./ui";
import type { Alert, AlertSeverity } from "../api/alertTypes";

interface Row {
  alert: Alert;
  deviceName: string | null;
  groupName: string | null;
}

const SEVERITY_ICON: Record<AlertSeverity, typeof AlertOctagon> = { critical: AlertOctagon, warning: AlertTriangle, info: Info };
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

const columnHelper = createColumnHelper<Row>();

/** Dense, sortable alternative to the card list — same data, same actions, just the shape an
 * operator scanning fifty rows at once wants instead of fifty expandable cards. Selection +
 * bulk-acknowledge is the one piece of the original ask deliberately deferred: bulk actions need
 * a `POST /alerts/bulk-ack`-style endpoint that doesn't exist yet (looping N individual
 * acknowledge calls client-side isn't the same guarantee and isn't atomic), so it's not included
 * here rather than faked. */
export function AlertsTable({
  rows,
  busyId,
  onAck,
  onResolve,
}: {
  rows: Row[];
  busyId: string | null;
  onAck: (a: Alert) => void;
  onResolve: (a: Alert) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "opened", desc: true }]);

  const columns = useMemo(
    () => [
      columnHelper.accessor((r) => SEVERITY_ORDER[r.alert.severity], {
        id: "severity",
        header: "Severity",
        cell: (ctx) => {
          const a = ctx.row.original.alert;
          const Icon = SEVERITY_ICON[a.severity];
          return (
            <Badge tone={a.severity === "critical" ? "critical" : a.severity === "warning" ? "warning" : "info"}>
              <Icon size={11} aria-hidden="true" /> {a.severity}
            </Badge>
          );
        },
        sortingFn: "basic",
      }),
      columnHelper.accessor((r) => r.alert.title, {
        id: "title",
        header: "Alert",
        cell: (ctx) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-text-primary">{ctx.row.original.alert.title}</p>
            {ctx.row.original.alert.detail && <p className="truncate text-2xs text-text-secondary">{ctx.row.original.alert.detail}</p>}
          </div>
        ),
      }),
      columnHelper.accessor((r) => r.deviceName ?? "", { id: "device", header: "Device" }),
      columnHelper.accessor((r) => r.groupName ?? "", { id: "group", header: "Group" }),
      columnHelper.accessor((r) => r.alert.openedAt, {
        id: "opened",
        header: "Opened",
        cell: (ctx) => {
          const iso = ctx.getValue();
          return (
            <span title={new Date(iso).toLocaleString()} className="font-mono text-2xs text-text-secondary">
              {formatDistanceToNowStrict(new Date(iso), { addSuffix: true })}
            </span>
          );
        },
      }),
      columnHelper.accessor((r) => r.alert.status, {
        id: "status",
        header: "Status",
        cell: (ctx) => <span className="text-xs uppercase text-text-secondary">{ctx.getValue()}</span>,
      }),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: (ctx) => {
          const a = ctx.row.original.alert;
          if (a.status === "resolved") return null;
          return (
            <div className="flex justify-end gap-2">
              {a.status === "open" && (
                <Button variant="secondary" size="sm" disabled={busyId === a.id} onClick={() => onAck(a)}>
                  Acknowledge
                </Button>
              )}
              <Button size="sm" disabled={busyId === a.id} onClick={() => onResolve(a)}>
                Resolve
              </Button>
            </div>
          );
        },
      }),
    ],
    [busyId, onAck, onResolve]
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-bg-subtle text-2xs uppercase tracking-wide text-text-secondary">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const dir = header.column.getIsSorted();
                return (
                  <th key={header.id} className="whitespace-nowrap px-3 py-2 text-left font-medium">
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex cursor-pointer items-center gap-1 text-left transition-colors hover:text-text-primary"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {dir === "asc" ? (
                          <ArrowUp size={11} aria-hidden="true" />
                        ) : dir === "desc" ? (
                          <ArrowDown size={11} aria-hidden="true" />
                        ) : (
                          <ArrowUpDown size={11} className="opacity-40" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-border">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-bg-subtle/60">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2.5 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
