import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DateRange } from "react-day-picker";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  BusinessCalendarLayout,
  useBusinessCalendarLayout,
} from "@/components/layouts/BusinessCalendarLayout";
import { ymdToDate, dateToYmd } from "./ymd";

function VacationsContent() {
  const { full, calendarId: id } = useBusinessCalendarLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [pendingRange, setPendingRange] = useState<DateRange | undefined>();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/business-calendars", id] });

  const onMutationError = (fallback: string) => (error: any) =>
    toast({ title: "Error", description: error.message || fallback, variant: "destructive" });

  const addMutation = useMutation({
    mutationFn: async (v: { startYmd: string; endYmd: string }) =>
      apiRequest("POST", `/api/business-calendars/${id}/manual-vacations`, v),
    onSuccess: () => {
      invalidate();
      setPendingRange(undefined);
      toast({ title: "Vacation added" });
    },
    onError: onMutationError("Failed to add vacation."),
  });

  const deleteMutation = useMutation({
    mutationFn: async (rowId: string) =>
      apiRequest("DELETE", `/api/business-calendars/${id}/manual-vacations/${rowId}`),
    onSuccess: invalidate,
    onError: onMutationError("Failed to delete vacation."),
  });

  const vacations = full.manualVacations;
  const sortedVacations = [...vacations].sort((a, b) => a.startYmd.localeCompare(b.startYmd));
  const existingRanges = vacations.map((v) => ({
    from: ymdToDate(v.startYmd),
    to: ymdToDate(v.endYmd),
  }));

  const confirmAdd = () => {
    if (!pendingRange?.from) return;
    const from = pendingRange.from;
    const to = pendingRange.to ?? pendingRange.from;
    const startYmd = dateToYmd(from);
    const endYmd = dateToYmd(to);
    if (startYmd > endYmd) {
      // react-day-picker range mode already orders from/to, but guard anyway
      addMutation.mutate({ startYmd: endYmd, endYmd: startYmd });
      return;
    }
    addMutation.mutate({ startYmd, endYmd });
  };

  const pendingLabel = pendingRange?.from
    ? `${dateToYmd(pendingRange.from)} → ${dateToYmd(pendingRange.to ?? pendingRange.from)}`
    : null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Vacations
            {addMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </CardTitle>
          <CardDescription>
            Closed date ranges. Pick a start and end date on the calendar, then confirm. Existing
            vacations are shaded.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Calendar
            mode="range"
            selected={pendingRange}
            onSelect={setPendingRange}
            numberOfMonths={2}
            modifiers={{ vacation: existingRanges }}
            modifiersClassNames={{
              vacation: "bg-destructive/20 text-destructive rounded-none",
            }}
            data-testid="calendar-vacations"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={confirmAdd}
              disabled={!pendingRange?.from || addMutation.isPending}
              data-testid="button-add-vacation"
            >
              <Plus className="mr-2 h-4 w-4" />
              {pendingLabel ? `Add vacation ${pendingLabel}` : "Add vacation"}
            </Button>
            {pendingRange?.from && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPendingRange(undefined)}
                data-testid="button-clear-vacation-range"
              >
                <X className="mr-1 h-4 w-4" />
                Clear selection
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current vacations</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableBody>
              {sortedVacations.length === 0 && (
                <TableRow>
                  <TableCell className="text-muted-foreground text-sm">No vacations.</TableCell>
                </TableRow>
              )}
              {sortedVacations.map((row) => (
                <TableRow key={row.id} data-testid={`row-vacation-${row.id}`}>
                  <TableCell className="font-mono text-sm">
                    {row.startYmd} → {row.endYmd}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(row.id)}
                      data-testid={`button-delete-vacation-${row.id}`}
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

export default function BusinessCalendarVacationsPage() {
  return (
    <BusinessCalendarLayout activeTab="vacations">
      <VacationsContent />
    </BusinessCalendarLayout>
  );
}
