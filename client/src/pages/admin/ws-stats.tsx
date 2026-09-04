import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { WsLayout } from "@/components/layouts/WebServicesLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Loader2 } from "lucide-react";
import { addDaysYmd, formatYmd, getTodayYmd, isYmdAfter, type Ymd } from "@shared/utils/date";

/**
 * How many calls we served — the inbound mirror of the outgoing stats page.
 *
 * Not derived from the request log, and it could not be: the log is
 * per-request and pruned on a retention schedule, so it stops being able to
 * answer "how much did this partner use us last quarter" the moment the window
 * closes. These counts come from a counter the dispatcher bumps once per call
 * that reached a service handler, so a number here means "we did the work" —
 * every refusal above the handler counts nothing, and a handler that then
 * raised an error still counts, because the work was ours to do.
 */

interface WsStatsDay {
  ymd: Ymd;
  calls: number;
}

interface WsStatsDimension {
  pluginId: string;
  clientId: string;
  clientName: string;
  operation: string;
}

interface WsStatsResponse {
  start: Ymd;
  end: Ymd;
  days: WsStatsDay[];
  total: number;
  byPlugin: { pluginId: string; calls: number }[];
  byPluginOperation: { pluginId: string; operation: string; calls: number }[];
  byClient: { clientId: string; clientName: string; calls: number }[];
  dimensions: WsStatsDimension[];
}

const DEFAULT_RANGE_DAYS = 30;

// `--chart-1` already holds a whole colour, so it is named as-is: wrapping it
// in a colour function nests one colour inside another, which parses but is
// not a colour, and the line silently renders invisible.
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
function fillRange(start: Ymd, end: Ymd, days: WsStatsDay[]): WsStatsDay[] {
  const counted = new Map(days.map((d) => [d.ymd, d.calls]));
  const filled: WsStatsDay[] = [];
  let ymd = start;
  // Bounded by the range the server echoed back, which it refuses to return
  // inverted, so this cannot run away.
  while (!isYmdAfter(ymd, end)) {
    filled.push({ ymd, calls: counted.get(ymd) ?? 0 });
    ymd = addDaysYmd(ymd, 1);
  }
  return filled;
}

const ALL = "all";

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

/** One breakdown table: what was called, and how often, over the range. */
function Breakdown({
  title,
  columns,
  rows,
  testId,
}: {
  title: string;
  columns: string[];
  rows: { key: string; cells: string[]; calls: number }[];
  testId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4" data-testid={`text-${testId}-empty`}>
            Nothing was called in this range.
          </p>
        ) : (
          <Table data-testid={`table-${testId}`}>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
                <TableHead className="text-right">Calls</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key} data-testid={`row-${testId}-${row.key}`}>
                  {row.cells.map((cell, index) => (
                    <TableCell key={index} className={index === 0 ? "font-medium" : undefined}>
                      {cell}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">
                    {row.calls.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WsStatsPage() {
  usePageTitle("Incoming Web Service Usage");

  const today = getTodayYmd();
  const [start, setStart] = useState<Ymd>(addDaysYmd(today, -(DEFAULT_RANGE_DAYS - 1)));
  const [end, setEnd] = useState<Ymd>(today);
  const [pluginId, setPluginId] = useState(ALL);
  const [clientId, setClientId] = useState(ALL);
  const [operation, setOperation] = useState(ALL);

  const params: Record<string, string> = { start, end };
  if (pluginId !== ALL) params.pluginId = pluginId;
  if (clientId !== ALL) params.clientId = clientId;
  if (operation !== ALL) params.operation = operation;

  const rangeInverted = isYmdAfter(start, end);

  const { data, isLoading, isError } = useQuery<WsStatsResponse>({
    queryKey: ["/api/admin/ws-stats", params],
    enabled: !rangeInverted,
  });

  const dimensions = data?.dimensions ?? [];
  const services = unique(dimensions.map((d) => d.pluginId));
  // Each filter offers only what the others leave reachable, so no combination
  // of the three can be assembled that matches nothing.
  const clients = Array.from(
    new Map(
      dimensions
        .filter((d) => pluginId === ALL || d.pluginId === pluginId)
        .map((d) => [d.clientId, d.clientName]),
    ),
  ).sort((a, b) => a[1].localeCompare(b[1]));
  const operations = unique(
    dimensions
      .filter((d) => pluginId === ALL || d.pluginId === pluginId)
      .filter((d) => clientId === ALL || d.clientId === clientId)
      .map((d) => d.operation),
  );

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
    setPluginId(ALL);
    setClientId(ALL);
    setOperation(ALL);
  }

  return (
    <WsLayout activeTab="ws-stats">
      <p className="text-muted-foreground" data-testid="text-page-description">
        Calls other people made to us, counted once each at the moment the call
        reached a service. A request refused before it got that far — an unknown
        service, a missing grant, a disabled configuration — is not a call we
        served and is not counted here; one whose handler then failed is,
        because the work was still ours.
      </p>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="ws-stats-start" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="ws-stats-start"
                type="date"
                className="w-40"
                value={start}
                max={end}
                onChange={(e) => setStart(e.target.value)}
                data-testid="input-start-date"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="ws-stats-end" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="ws-stats-end"
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
                value={pluginId}
                onValueChange={(v) => {
                  setPluginId(v);
                  setClientId(ALL);
                  setOperation(ALL);
                }}
              >
                <SelectTrigger className="w-52" data-testid="select-plugin">
                  <SelectValue placeholder="All services" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All services</SelectItem>
                  {services.map((id) => (
                    <SelectItem key={id} value={id}>
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Client</Label>
              <Select
                value={clientId}
                onValueChange={(v) => {
                  setClientId(v);
                  setOperation(ALL);
                }}
              >
                <SelectTrigger className="w-52" data-testid="select-client">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All clients</SelectItem>
                  {clients.map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Operation</Label>
              <Select value={operation} onValueChange={setOperation}>
                <SelectTrigger className="w-52" data-testid="select-operation">
                  <SelectValue placeholder="All operations" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All operations</SelectItem>
                  {operations.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
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
            <p className="py-16 text-center text-sm text-muted-foreground" data-testid="text-empty">
              No calls were served in this range.
            </p>
          ) : (
            <ChartContainer
              config={chartConfig}
              className="h-72 w-full"
              data-testid="chart-ws-calls"
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

      {!rangeInverted && data && total > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown
            title="By service"
            columns={["Service"]}
            testId="by-plugin"
            rows={data.byPlugin.map((row) => ({
              key: row.pluginId,
              cells: [row.pluginId],
              calls: row.calls,
            }))}
          />
          <Breakdown
            title="By client"
            columns={["Client"]}
            testId="by-client"
            rows={data.byClient.map((row) => ({
              key: row.clientId,
              cells: [row.clientName],
              calls: row.calls,
            }))}
          />
          <Breakdown
            title="By operation"
            columns={["Service", "Operation"]}
            testId="by-operation"
            rows={data.byPluginOperation.map((row) => ({
              key: `${row.pluginId}-${row.operation}`,
              cells: [row.pluginId, row.operation],
              calls: row.calls,
            }))}
          />
        </div>
      )}
    </WsLayout>
  );
}
