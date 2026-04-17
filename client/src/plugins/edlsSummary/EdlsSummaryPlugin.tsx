import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import type { DashboardPluginProps } from "../types";

interface EdlsSummaryData {
  memberStatuses: string[];
  grid: Record<string, Record<string, number>>;
}

const sheetStatusColumns = [
  { key: "draft", label: "Draft" },
  { key: "request", label: "Requested" },
  { key: "reserved", label: "Reserved" },
  { key: "lock", label: "Scheduled" },
];

const statusHeaderColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  reserved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  lock: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

function getTodayYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatYmdDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${d}, ${y}`;
}

export function EdlsSummaryPlugin({ enabledComponents }: DashboardPluginProps) {
  const [selectedDate, setSelectedDate] = useState(getTodayYmd());

  if (!enabledComponents?.includes("edls")) return null;

  const { data, isLoading, isError } = useQuery<EdlsSummaryData>({
    queryKey: ["/api/dashboard-plugins/edls-summary", selectedDate],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard-plugins/edls-summary?ymd=${selectedDate}`);
      if (!res.ok) throw new Error("Failed to fetch EDLS summary");
      return res.json();
    },
  });

  const hasData = data && data.memberStatuses.length > 0;

  const columnTotals: Record<string, number> = {};
  if (hasData) {
    for (const col of sheetStatusColumns) {
      columnTotals[col.key] = data.memberStatuses.reduce(
        (sum, ms) => sum + (data.grid[ms]?.[col.key] || 0),
        0
      );
    }
  }
  const grandTotal = Object.values(columnTotals).reduce((s, v) => s + v, 0);

  return (
    <Card data-testid="card-edls-summary">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="flex items-center gap-2" data-testid="title-edls-summary">
            <CalendarDays className="h-5 w-5" />
            EDLS Daily Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSelectedDate(shiftYmd(selectedDate, -1))}
              data-testid="button-edls-prev-day"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                className="h-8 w-auto"
                data-testid="input-edls-date"
              />
              <span className="text-sm text-muted-foreground hidden sm:inline" data-testid="text-edls-date-display">
                {formatYmdDisplay(selectedDate)}
              </span>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setSelectedDate(shiftYmd(selectedDate, 1))}
              data-testid="button-edls-next-day"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {selectedDate !== getTodayYmd() && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setSelectedDate(getTodayYmd())}
                data-testid="button-edls-today"
              >
                Today
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8" data-testid="loading-edls-summary">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive py-4" data-testid="error-edls-summary">
            Unable to load EDLS summary data.
          </p>
        ) : !hasData ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="empty-edls-summary">
            <p className="text-sm">No assignments found for this date.</p>
          </div>
        ) : (
          <div className="overflow-x-auto" data-testid="table-edls-summary">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-sm border-b bg-muted/50">
                    Member Status
                  </th>
                  {sheetStatusColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`text-center px-4 py-2 font-medium text-sm border-b ${statusHeaderColors[col.key]}`}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="text-center px-4 py-2 font-semibold text-sm border-b bg-muted">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.memberStatuses.map((ms, idx) => {
                  const rowTotal = sheetStatusColumns.reduce(
                    (sum, col) => sum + (data.grid[ms]?.[col.key] || 0),
                    0
                  );
                  return (
                    <tr
                      key={ms}
                      className={idx % 2 === 0 ? "bg-background" : "bg-muted/30"}
                      data-testid={`row-edls-ms-${ms.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <td className="px-4 py-2 text-sm font-medium border-b">{ms}</td>
                      {sheetStatusColumns.map((col) => {
                        const val = data.grid[ms]?.[col.key] || 0;
                        return (
                          <td
                            key={col.key}
                            className="text-center px-4 py-2 text-sm tabular-nums border-b"
                          >
                            {val > 0 ? val : <span className="text-muted-foreground">—</span>}
                          </td>
                        );
                      })}
                      <td className="text-center px-4 py-2 text-sm font-semibold tabular-nums border-b bg-muted/50">
                        {rowTotal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-muted/70 font-semibold">
                  <td className="px-4 py-2 text-sm border-t">Total</td>
                  {sheetStatusColumns.map((col) => (
                    <td key={col.key} className="text-center px-4 py-2 text-sm tabular-nums border-t">
                      {columnTotals[col.key] || 0}
                    </td>
                  ))}
                  <td className="text-center px-4 py-2 text-sm tabular-nums border-t font-bold">
                    {grandTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
