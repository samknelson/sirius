import { Link } from "wouter";
import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatYmd, type Ymd } from "@shared/utils/date";

/**
 * Shared body for the incoming-usage cards: one row per name, with what it did
 * today beside what it did over the window.
 *
 * Lives beside the dashboard's other shared widget modules rather than inside
 * a widget folder on purpose — the component registry globs one level down, so
 * a shared piece placed there would register itself as a widget nothing renders.
 *
 * No gating here. `/content` is the authority and hands back nothing when the
 * viewer is not entitled to it.
 */

/** One counted name — a service or a caller — over the window and today. */
export interface UsageRow {
  id: string;
  label: string;
  today: number;
  week: number;
}

/** What a usage widget's `/content` hands back, whichever dimension it counts. */
export interface UsageContent {
  start: Ymd;
  end: Ymd;
  windowDays: number;
  rows: UsageRow[];
}

export function UsageCard({
  title,
  icon: Icon,
  testId,
  columnLabel,
  windowLabel,
  emptyLabel,
  data,
}: {
  title: string;
  icon: LucideIcon;
  /** Suffix for this card's test ids, e.g. `ws-usage-byclient`. */
  testId: string;
  /** Heading over the names column, e.g. "Client". */
  columnLabel: string;
  /** Sentence opening the window line, e.g. "Incoming calls". */
  windowLabel: string;
  /** Sentence shown instead of the table when nothing was counted. */
  emptyLabel: string;
  data: UsageContent;
}) {
  return (
    <Card data-testid={`card-${testId}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <Link
          href="/admin/ws/stats"
          className="text-xs text-primary flex items-center hover:underline"
          data-testid={`link-${testId}-stats-page`}
        >
          View all
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground" data-testid={`text-${testId}-window`}>
          {windowLabel} from {formatYmd(data.start, "short")} to{" "}
          {formatYmd(data.end, "short")}
        </div>

        {data.rows.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid={`text-${testId}-empty`}>
            {emptyLabel}
          </div>
        ) : (
          <table className="w-full text-sm" data-testid={`table-${testId}`}>
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left font-normal pb-1">{columnLabel}</th>
                <th className="text-right font-normal pb-1 w-20">Today</th>
                <th className="text-right font-normal pb-1 w-24">
                  Last {data.windowDays} days
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} data-testid={`row-${testId}-${row.id}`}>
                  <td
                    className="py-1 truncate"
                    title={row.label}
                    data-testid={`text-${testId}-name-${row.id}`}
                  >
                    {row.label}
                  </td>
                  <td
                    className="py-1 text-right tabular-nums"
                    data-testid={`text-${testId}-today-${row.id}`}
                  >
                    {row.today.toLocaleString()}
                  </td>
                  <td
                    className="py-1 text-right tabular-nums"
                    data-testid={`text-${testId}-week-${row.id}`}
                  >
                    {row.week.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
