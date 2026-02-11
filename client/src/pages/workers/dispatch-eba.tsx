import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRef, useMemo, useCallback } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import { addDays, startOfDay, isSameDay } from "date-fns";
import type { WorkerDispatchEba } from "@shared/schema";

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface MonthGrid {
  year: number;
  month: number;
  label: string;
  weeks: (Date | null)[][];
}

function buildMonthGrids(days: Date[]): MonthGrid[] {
  const grouped = new Map<string, Date[]>();
  for (const day of days) {
    const key = `${day.getFullYear()}-${day.getMonth()}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(day);
  }

  const grids: MonthGrid[] = [];
  const entries = Array.from(grouped.entries());
  for (const [, monthDays] of entries) {
    const year = monthDays[0].getFullYear();
    const month = monthDays[0].getMonth();
    const label = `${MONTH_NAMES[month]} ${year}`;

    const firstOfMonth = new Date(year, month, 1);
    const startDow = firstOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const daySet = new Set(monthDays.map((d: Date) => d.getDate()));

    const weeks: (Date | null)[][] = [];
    let currentWeek: (Date | null)[] = [];

    for (let i = 0; i < startDow; i++) {
      currentWeek.push(null);
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      if (currentWeek.length === 7) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      if (daySet.has(dayNum)) {
        currentWeek.push(new Date(year, month, dayNum));
      } else {
        currentWeek.push(null);
      }
    }

    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);

    grids.push({ year, month, label, weeks });
  }

  return grids;
}

function DispatchEbaContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const pendingDateRef = useRef<string | null>(null);

  const { data: entries = [], isLoading } = useQuery<WorkerDispatchEba[]>({
    queryKey: ["/api/worker-dispatch-eba/worker", worker.id],
  });

  const savedDates = useMemo(() => new Set(entries.map(e => e.ymd ?? (e as any).date).filter(Boolean)), [entries]);

  const syncMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      return await apiRequest("PUT", `/api/worker-dispatch-eba/worker/${worker.id}/sync`, { dates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-eba/worker", worker.id] });
      pendingDateRef.current = null;
    },
    onError: () => {
      pendingDateRef.current = null;
      toast({ title: "Error", description: "Failed to update availability.", variant: "destructive" });
    },
  });

  const toggleDate = useCallback((dateStr: string) => {
    if (syncMutation.isPending) return;
    pendingDateRef.current = dateStr;
    const updated = new Set(savedDates);
    if (updated.has(dateStr)) {
      updated.delete(dateStr);
    } else {
      updated.add(dateStr);
    }
    const arr: string[] = [];
    updated.forEach(d => arr.push(d));
    syncMutation.mutate(arr);
  }, [savedDates, syncMutation]);

  const today = startOfDay(new Date());
  const next30Days = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 30; i++) {
      days.push(addDays(today, i));
    }
    return days;
  }, [today]);

  const monthGrids = useMemo(() => buildMonthGrids(next30Days), [next30Days]);
  const selectedCount = savedDates.size;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-0 pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2" data-testid="text-eba-title">
              <CalendarDays className="h-5 w-5" />
              Availability Dates
            </CardTitle>
            {syncMutation.isPending && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <CardDescription data-testid="text-eba-description">
            Tap a date to mark yourself available or unavailable. Changes save automatically.
            {selectedCount > 0 && (
              <span className="ml-1 font-medium text-foreground">{selectedCount} day{selectedCount !== 1 ? 's' : ''} selected.</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {monthGrids.map((grid) => (
            <div key={`${grid.year}-${grid.month}`} data-testid={`section-month-${grid.year}-${grid.month}`}>
              <h3 className="text-sm font-semibold mb-2" data-testid={`text-month-label-${grid.year}-${grid.month}`}>
                {grid.label}
              </h3>
              <div className="grid grid-cols-7 gap-1">
                {dayNames.map(name => (
                  <div key={name} className="text-center text-xs font-medium text-muted-foreground py-1">
                    {name}
                  </div>
                ))}
                {grid.weeks.flatMap((week, wi) =>
                  week.map((day, di) => {
                    if (!day) {
                      return <div key={`empty-${grid.year}-${grid.month}-${wi}-${di}`} className="aspect-square" />;
                    }
                    const dateStr = formatYmd(day);
                    const isSelected = savedDates.has(dateStr);
                    const isToday = isSameDay(day, today);
                    const isPending = syncMutation.isPending && pendingDateRef.current === dateStr;
                    return (
                      <button
                        key={dateStr}
                        type="button"
                        onClick={() => toggleDate(dateStr)}
                        disabled={syncMutation.isPending}
                        data-testid={`button-date-${dateStr}`}
                        className={[
                          "aspect-square rounded-md flex flex-col items-center justify-center text-sm transition-colors",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "hover-elevate",
                          isToday && !isSelected ? "ring-1 ring-primary" : "",
                          syncMutation.isPending && !isPending ? "opacity-70" : "",
                        ].filter(Boolean).join(" ")}
                      >
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <span className="font-medium">{day.getDate()}</span>
                          </>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkerDispatchEba() {
  return (
    <WorkerLayout activeTab="dispatch-eba">
      <DispatchEbaContent />
    </WorkerLayout>
  );
}
