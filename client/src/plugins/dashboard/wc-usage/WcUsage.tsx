import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, ChevronRight } from "lucide-react";
import { formatYmd, type Ymd } from "@shared/utils/date";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

/**
 * Which external services we actually called, and how much. Per service only —
 * the per-day and per-request-type detail lives on the admin Web Client Stats
 * page, which this card links to.
 *
 * No gating here: `/content` is the authority and hands back nothing when the
 * viewer is not entitled to it.
 */

interface WcUsageService {
  service: string;
  today: number;
  week: number;
}

interface WcUsageData {
  today: Ymd;
  start: Ymd;
  end: Ymd;
  windowDays: number;
  services: WcUsageService[];
  todayTotal: number;
  weekTotal: number;
}

export function WcUsage(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<WcUsageData>("wc-usage");

  if (isLoading) return null;
  if (!data) return null;

  return (
    <Card data-testid="card-wc-usage">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Web Services - Outgoing
        </CardTitle>
        <Link
          href="/admin/wc/stats"
          className="text-xs text-primary flex items-center hover:underline"
          data-testid="link-wc-stats-page"
        >
          View all
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground" data-testid="text-wc-usage-window">
          Outbound calls from {formatYmd(data.start, "short")} to{" "}
          {formatYmd(data.end, "short")}
        </div>

        {data.services.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-wc-usage-empty">
            No external services were called in the last {data.windowDays} days.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="table-wc-usage">
            <thead>
              <tr className="text-xs text-muted-foreground border-b">
                <th className="text-left font-normal pb-1">Service</th>
                <th className="text-right font-normal pb-1 w-20">Today</th>
                <th className="text-right font-normal pb-1 w-24">
                  Last {data.windowDays} days
                </th>
              </tr>
            </thead>
            <tbody>
              {data.services.map((row) => (
                <tr key={row.service} data-testid={`row-wc-usage-${row.service}`}>
                  <td
                    className="py-1 truncate"
                    title={row.service}
                    data-testid={`text-wc-usage-service-${row.service}`}
                  >
                    {row.service}
                  </td>
                  <td
                    className="py-1 text-right tabular-nums"
                    data-testid={`text-wc-usage-today-${row.service}`}
                  >
                    {row.today.toLocaleString()}
                  </td>
                  <td
                    className="py-1 text-right tabular-nums"
                    data-testid={`text-wc-usage-week-${row.service}`}
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
