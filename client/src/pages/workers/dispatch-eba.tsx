import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useMemo, useCallback } from "react";
import { CalendarDays, Save, ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, startOfDay, isSameDay } from "date-fns";
import type { WorkerDispatchEba } from "@shared/schema";

function formatYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function DispatchEbaContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();

  const { data: entries = [], isLoading } = useQuery<WorkerDispatchEba[]>({
    queryKey: ["/api/worker-dispatch-eba/worker", worker.id],
  });

  const savedDates = useMemo(() => new Set(entries.map(e => e.date)), [entries]);

  const [selectedDates, setSelectedDates] = useState<Set<string> | null>(null);

  const effectiveDates = selectedDates ?? savedDates;

  const hasChanges = useMemo(() => {
    if (!selectedDates) return false;
    if (selectedDates.size !== savedDates.size) return true;
    let changed = false;
    selectedDates.forEach(d => {
      if (!savedDates.has(d)) changed = true;
    });
    return changed;
  }, [selectedDates, savedDates]);

  const syncMutation = useMutation({
    mutationFn: async (dates: string[]) => {
      return await apiRequest("PUT", `/api/worker-dispatch-eba/worker/${worker.id}/sync`, { dates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/worker-dispatch-eba/worker", worker.id] });
      setSelectedDates(null);
      toast({ title: "Availability saved", description: "Your available dates have been updated." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save availability dates.", variant: "destructive" });
    },
  });

  const handleSave = useCallback(() => {
    syncMutation.mutate(Array.from(effectiveDates));
  }, [effectiveDates, syncMutation]);

  const toggleDate = useCallback((dateStr: string) => {
    setSelectedDates(prev => {
      const current = new Set(prev ?? savedDates);
      if (current.has(dateStr)) {
        current.delete(dateStr);
      } else {
        current.add(dateStr);
      }
      return current;
    });
  }, [savedDates]);

  const today = startOfDay(new Date());
  const next30Days = useMemo(() => {
    const days: Date[] = [];
    for (let i = 0; i < 30; i++) {
      days.push(addDays(today, i));
    }
    return days;
  }, [today]);

  const weeks = useMemo(() => {
    const result: (Date | null)[][] = [];
    let currentWeek: (Date | null)[] = [];

    const firstDay = next30Days[0];
    const startDow = firstDay.getDay();
    for (let i = 0; i < startDow; i++) {
      currentWeek.push(null);
    }

    for (const day of next30Days) {
      if (currentWeek.length === 7) {
        result.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(day);
    }

    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    result.push(currentWeek);

    return result;
  }, [next30Days]);

  const selectedCount = effectiveDates.size;
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
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <div>
            <CardTitle className="flex items-center gap-2" data-testid="text-eba-title">
              <CalendarDays className="h-5 w-5" />
              Availability Dates
            </CardTitle>
            <CardDescription data-testid="text-eba-description">
              Select the days you are available for dispatch in the next 30 days.
              {selectedCount > 0 && (
                <span className="ml-1 font-medium text-foreground">{selectedCount} day{selectedCount !== 1 ? 's' : ''} selected.</span>
              )}
            </CardDescription>
          </div>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || syncMutation.isPending}
            data-testid="button-save-eba"
          >
            <Save className="h-4 w-4 mr-1" />
            {syncMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-1" data-testid="grid-eba-calendar">
            {dayNames.map(name => (
              <div key={name} className="text-center text-xs font-medium text-muted-foreground py-1">
                {name}
              </div>
            ))}
            {weeks.flatMap((week, wi) =>
              week.map((day, di) => {
                if (!day) {
                  return <div key={`empty-${wi}-${di}`} className="aspect-square" />;
                }
                const dateStr = formatYmd(day);
                const isSelected = effectiveDates.has(dateStr);
                const isToday = isSameDay(day, today);
                return (
                  <button
                    key={dateStr}
                    type="button"
                    onClick={() => toggleDate(dateStr)}
                    data-testid={`button-date-${dateStr}`}
                    className={[
                      "aspect-square rounded-md flex flex-col items-center justify-center text-sm transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "hover-elevate",
                      isToday && !isSelected ? "ring-1 ring-primary" : "",
                    ].filter(Boolean).join(" ")}
                  >
                    <span className="font-medium">{day.getDate()}</span>
                    <span className="text-[10px] leading-none opacity-70">{format(day, "MMM")}</span>
                  </button>
                );
              })
            )}
          </div>
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
