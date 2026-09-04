import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { WcLayout } from "@/components/layouts/WebServicesLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Loader2 } from "lucide-react";
import { addDaysYmd, formatYmd, getTodayYmd, isYmdAfter, type Ymd } from "@shared/utils/date";

/**
 * How often we actually went out to a third party.
 *
 * Not derived from the cache, and it could not be: the cache holds one row per
 * request key carrying only the last attempt, and a request type registered as
 * uncached writes to it not at all. These counts come from a counter the
 * request wrapper bumps once at the moment it decides to contact the vendor,
 * so a number here means "we contacted them" — a cache hit, a refusal and a
 * pass-through count nothing, and a failed attempt counts, because it is a
 * call we made.
 */

interface WcStatsDay {
  ymd: Ymd;
  calls: number;
}

interface WcStatsDimension {
  service: string;
  requestType: string;
}

interface WcStatsResponse {
  start: Ymd;
  end: Ymd;
  days: WcStatsDay[];
  total: number;
  dimensions: WcStatsDimension[];
}

const DEFAULT_RANGE_DAYS = 30;

// `--chart-1` already holds a whole colour (`hsl(221 83% 53%)`), so it is named
// as-is. Wrapping it in a colour function — as the upstream chart examples do,
// because their themes store bare channel values — nests one colour inside
// another. That parses but is not a colour, so the browser drops the stroke and
// the line renders invisibly while the grid and axes look perfectly fine.
const chartConfig = {
  calls: {
    label: "Calls",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

/**
 * Every day in the range, with the counted days filled in and the rest at zero.
 *
 * A day with no calls is a fact, not a gap: without this the chart would draw
 * one straight line from a busy Monday to a busy Friday and quietly claim the
 * days between were the average of the two.
 */
function fillRange(start: Ymd, end: Ymd, days: WcStatsDay[]): WcStatsDay[] {
  const counted = new Map(days.map((d) => [d.ymd, d.calls]));
  const filled: WcStatsDay[] = [];
  let ymd = start;
  // Bounded by the range the server echoed back, which it refuses to return
  // inverted, so this cannot run away.
  while (!isYmdAfter(ymd, end)) {
    filled.push({ ymd, calls: counted.get(ymd) ?? 0 });
    ymd = addDaysYmd(ymd, 1);
  }
  return filled;
}

export default function WcStatsPage() {
  usePageTitle("Outgoing Web Service Usage");

  const today = getTodayYmd();
  const [start, setStart] = useState<Ymd>(addDaysYmd(today, -(DEFAULT_RANGE_DAYS - 1)));
  const [end, setEnd] = useState<Ymd>(today);
  const [service, setService] = useState("all");
  const [requestType, setRequestType] = useState("all");

  const params: Record<string, string> = { start, end };
  if (service !== "all") params.service = service;
  if (requestType !== "all") params.requestType = requestType;

  const rangeInverted = isYmdAfter(start, end);

  const { data, isLoading, isError } = useQuery<WcStatsResponse>({
    queryKey: ["/api/admin/wc-stats", params],
    enabled: !rangeInverted,
  });

  const dimensions = data?.dimensions ?? [];
  const services = Array.from(new Set(dimensions.map((d) => d.service))).sort();
  // Request types narrow to the chosen service, so the two filters cannot be
  // combined into one that matches nothing.
  const typesForService = Array.from(
    new Set(
      dimensions
        .filter((d) => service === "all" || d.service === service)
        .map((d) => d.requestType),
    ),
  ).sort();

  const points = useMemo(() => {
    if (!data) return [];
    return fillRange(data.start, data.end, data.days).map((day) => ({
      ...day,
      label: formatYmd(day.ymd, "short"),
    }));
  }, [data]);

  const total = data?.total ?? 0;

  function resetFilters() {
    setStart(addDaysYmd(today, -(DEFAULT_RANGE_DAYS - 1)));
    setEnd(today);
    setService("all");
    setRequestType("all");
  }

  return (
    <WcLayout activeTab="wc-stats">
      <p className="text-muted-foreground" data-testid="text-page-description">
        Calls we actually made to a third party, counted once each at the moment
        the request wrapper decided to contact the vendor. An answer served from
        the cache, a request refused before the call and a local pass-through
        are not calls and are not counted here; a failed attempt is.
      </p>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="stats-start" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="stats-start"
                type="date"
                className="w-40"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
                data-testid="input-start-date"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="stats-end" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="stats-end"
                type="date"
                className="w-40"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                data-testid="input-end-date"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Service</Label>
              <Select
                value={service}
                onValueChange={(v) => {
                  setService(v);
                  setRequestType("all");
                }}
              >
                <SelectTrigger className="w-48" data-testid="select-service">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Request type</Label>
              <Select value={requestType} onValueChange={setRequestType}>
                <SelectTrigger className="w-56" data-testid="select-request-type">
                  <SelectValue placeholder="All request types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All request types</SelectItem>
                  {typesForService.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button variant="outline" onClick={resetFilters} data-testid="button-clear-filters">
              Clear
            </Button>
          </div>

          {rangeInverted ? (
            <p
              className="py-16 text-center text-sm text-muted-foreground"
              data-testid="text-range-invalid"
            >
              The range starts after it ends.
            </p>
          ) : isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin" data-testid="loading-stats" />
            </div>
          ) : isError || !data ? (
            <p
              className="py-16 text-center text-sm text-muted-foreground"
              data-testid="text-stats-error"
            >
              The call counts could not be loaded.
            </p>
          ) : total === 0 ? (
            <p
              className="py-16 text-center text-sm text-muted-foreground"
              data-testid="text-empty"
            >
              No calls were made in this range.
            </p>
          ) : (
            <ChartContainer
              config={chartConfig}
              className="h-72 w-full"
              data-testid="chart-wc-calls"
            >
              <LineChart data={points} margin={{ left: 4, right: 12, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line
                  dataKey="calls"
                  type="monotone"
                  stroke="var(--color-calls)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ChartContainer>
          )}

          <p className="text-sm text-muted-foreground" data-testid="text-total">
            {rangeInverted
              ? "No range selected"
              : `${total.toLocaleString()} ${total === 1 ? "call" : "calls"} from ${formatYmd(start, "short")} to ${formatYmd(end, "short")}`}
          </p>
        </CardContent>
      </Card>
    </WcLayout>
  );
}
