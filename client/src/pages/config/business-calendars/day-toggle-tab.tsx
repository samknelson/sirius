import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useBusinessCalendarLayout } from "@/components/layouts/BusinessCalendarLayout";
import { ymdToDate, dateToYmd } from "./ymd";

interface DayRow {
  id: string;
  ymd: string;
}

interface DayToggleTabProps {
  title: string;
  description: string;
  emptyText: string;
  /** e.g. "manual-byday" or "manual-open" (URL segment) */
  endpoint: "manual-byday" | "manual-open";
  rows: DayRow[];
  testIdPrefix: string;
  addErrorFallback: string;
  deleteErrorFallback: string;
}

export function DayToggleTab({
  title,
  description,
  emptyText,
  endpoint,
  rows,
  testIdPrefix,
  addErrorFallback,
  deleteErrorFallback,
}: DayToggleTabProps) {
  const { calendarId: id } = useBusinessCalendarLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/business-calendars", id] });

  const onMutationError = (fallback: string) => (error: any) =>
    toast({ title: "Error", description: error.message || fallback, variant: "destructive" });

  const addMutation = useMutation({
    mutationFn: async (ymd: string) =>
      apiRequest("POST", `/api/business-calendars/${id}/${endpoint}`, { ymd }),
    onSuccess: invalidate,
    onError: onMutationError(addErrorFallback),
  });

  const deleteMutation = useMutation({
    mutationFn: async (rowId: string) =>
      apiRequest("DELETE", `/api/business-calendars/${id}/${endpoint}/${rowId}`),
    onSuccess: invalidate,
    onError: onMutationError(deleteErrorFallback),
  });

  const isSaving = addMutation.isPending || deleteMutation.isPending;
  const rowsByYmd = new Map(rows.map((r) => [r.ymd, r]));
  const selectedDates = rows.map((r) => ymdToDate(r.ymd));
  const sortedRows = [...rows].sort((a, b) => a.ymd.localeCompare(b.ymd));

  const handleDayClick = (day: Date) => {
    if (isSaving) return;
    const ymd = dateToYmd(day);
    const existing = rowsByYmd.get(ymd);
    if (existing) {
      deleteMutation.mutate(existing.id);
    } else {
      addMutation.mutate(ymd);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {title}
            {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="multiple"
            selected={selectedDates}
            onDayClick={handleDayClick}
            numberOfMonths={2}
            data-testid={`calendar-${testIdPrefix}`}
          />
          <p className="text-sm text-muted-foreground mt-2">
            Click a day to add it; click a highlighted day to remove it.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current entries</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {sortedRows.length === 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground text-sm">{emptyText}</TableCell>
                </TableRow>
              )}
              {sortedRows.map((row) => (
                <TableRow key={row.id} data-testid={`row-${testIdPrefix}-${row.id}`}>
                  <TableCell className="font-mono text-sm">{row.ymd}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(row.id)}
                      data-testid={`button-delete-${testIdPrefix}-${row.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
