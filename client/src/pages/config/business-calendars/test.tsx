import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Calculator, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  BusinessCalendarLayout,
  useBusinessCalendarLayout,
} from "@/components/layouts/BusinessCalendarLayout";

type DayRule = "manual-open" | "weekend" | "manual-byday" | "vacation" | "holiday";

interface DayExplanation {
  ymd: string;
  isBusinessDay: boolean;
  rule?: DayRule;
  holidayName?: string;
  vacationStart?: string;
  vacationEnd?: string;
}

interface ExplainRangeResponse {
  op: string;
  start: string;
  end: string;
  days: DayExplanation[];
}

const RULE_META: Record<DayRule, { label: string; className: string }> = {
  "manual-open": {
    label: "Forced open (override)",
    className: "bg-emerald-100 text-emerald-900 ring-2 ring-emerald-500 dark:bg-emerald-900/40 dark:text-emerald-200",
  },
  weekend: {
    label: "Weekend",
    className: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
  },
  "manual-byday": {
    label: "Manual closed day",
    className: "bg-orange-200 text-orange-900 dark:bg-orange-900/50 dark:text-orange-200",
  },
  vacation: {
    label: "Vacation (closed range)",
    className: "bg-purple-200 text-purple-900 dark:bg-purple-900/50 dark:text-purple-200",
  },
  holiday: {
    label: "Holiday",
    className: "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-200",
  },
};

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** ISO weekday of the 1st of the month: 1=Mon .. 7=Sun */
function firstIsoWeekday(year: number, month1: number): number {
  const dow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function dayDetail(day: DayExplanation): string {
  if (!day.rule) return "Business day (open)";
  const meta = RULE_META[day.rule];
  if (day.rule === "holiday" && day.holidayName) {
    return `${meta.label}: ${day.holidayName}`;
  }
  if (day.rule === "vacation" && day.vacationStart && day.vacationEnd) {
    return `${meta.label}: ${day.vacationStart} to ${day.vacationEnd}`;
  }
  if (day.rule === "manual-open") {
    return `${meta.label} — open despite other closure rules`;
  }
  return meta.label;
}

function AnnotatedMonthCalendar({ calendarId }: { calendarId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12

  const start = `${year}-${pad2(month)}-01`;
  const end = `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;

  const { data, isLoading, isError, error } = useQuery<ExplainRangeResponse>({
    queryKey: [
      "/api/business-calendars",
      calendarId,
      `compute?op=explainRange&start=${start}&end=${end}`,
    ],
  });

  const byYmd = useMemo(() => {
    const map = new Map<string, DayExplanation>();
    for (const d of data?.days ?? []) map.set(d.ymd, d);
    return map;
  }, [data]);

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setMonth(m);
    setYear(y);
  };

  const leadingBlanks = firstIsoWeekday(year, month) - 1;
  const totalDays = daysInMonth(year, month);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar View</CardTitle>
        <CardDescription>
          Each day is colored by the rule that determines whether it is a business day. Hover a
          day for details.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(-1)}
            data-testid="button-prev-month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="font-semibold text-lg" data-testid="text-month-label">
            {MONTH_NAMES[month - 1]} {year}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => goMonth(1)}
            data-testid="button-next-month"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {isError ? (
          <p className="text-sm text-destructive" data-testid="text-calendar-error">
            {(error as any)?.message || "Failed to load calendar data."}
          </p>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-1 max-w-2xl">
            {WEEKDAY_HEADERS.map((h) => (
              <div key={h} className="text-center text-xs font-medium text-muted-foreground py-1">
                {h}
              </div>
            ))}
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}
            {Array.from({ length: totalDays }).map((_, i) => {
              const dayNum = i + 1;
              const ymd = `${year}-${pad2(month)}-${pad2(dayNum)}`;
              const day = byYmd.get(ymd);
              const ruleClass = day?.rule
                ? RULE_META[day.rule].className
                : "bg-background text-foreground border border-border";
              return (
                <Tooltip key={ymd}>
                  <TooltipTrigger asChild>
                    <div
                      className={`rounded-md min-h-14 p-1 text-sm flex flex-col items-center cursor-default ${ruleClass}`}
                      data-testid={`cell-day-${ymd}`}
                    >
                      <span className="font-medium">{dayNum}</span>
                      {day?.rule === "holiday" && day.holidayName && (
                        <span className="text-[10px] leading-tight text-center line-clamp-2">
                          {day.holidayName}
                        </span>
                      )}
                      {day?.rule === "manual-open" && (
                        <span className="text-[10px] leading-tight">Open</span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{ymd}</p>
                    <p>{day ? dayDetail(day) : "No data"}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2" data-testid="legend-calendar">
          <div className="flex items-center gap-2 text-sm">
            <span className="inline-block h-4 w-4 rounded border border-border bg-background" />
            Business day (open)
          </div>
          {(Object.keys(RULE_META) as DayRule[]).map((rule) => (
            <div key={rule} className="flex items-center gap-2 text-sm">
              <span className={`inline-block h-4 w-4 rounded ${RULE_META[rule].className}`} />
              {RULE_META[rule].label}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TestTabContent() {
  const { calendarId: id } = useBusinessCalendarLayout();
  const { toast } = useToast();

  const onMutationError = (fallback: string) => (error: any) =>
    toast({ title: "Error", description: error.message || fallback, variant: "destructive" });

  const [calcStart, setCalcStart] = useState("");
  const [calcN, setCalcN] = useState("1");
  const [calcResult, setCalcResult] = useState<string | null>(null);
  const [checkDate, setCheckDate] = useState("");
  const [checkResult, setCheckResult] = useState<boolean | null>(null);

  const computeMutation = useMutation({
    mutationFn: async () =>
      apiRequest(
        "GET",
        `/api/business-calendars/${id}/compute?op=addBusinessDays&start=${calcStart}&n=${encodeURIComponent(calcN)}`,
      ),
    onSuccess: (res: { result: string }) => setCalcResult(res.result),
    onError: (error: any) => {
      setCalcResult(null);
      onMutationError("Computation failed.")(error);
    },
  });

  const checkMutation = useMutation({
    mutationFn: async () =>
      apiRequest("GET", `/api/business-calendars/${id}/compute?op=isBusinessDay&date=${checkDate}`),
    onSuccess: (res: { isBusinessDay: boolean }) => setCheckResult(res.isBusinessDay),
    onError: (error: any) => {
      setCheckResult(null);
      onMutationError("Check failed.")(error);
    },
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Test Calculator
          </CardTitle>
          <CardDescription>
            Sanity-check this calendar against the server's business-day computation. Uses the
            saved settings — save on the Settings tab first if you changed anything.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="calc-start">Start date</Label>
              <Input id="calc-start" type="date" value={calcStart} onChange={(e) => setCalcStart(e.target.value)} data-testid="input-calc-start" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calc-n">Business days (N)</Label>
              <Input id="calc-n" type="number" className="w-32" value={calcN} onChange={(e) => setCalcN(e.target.value)} data-testid="input-calc-n" />
            </div>
            <Button
              onClick={() => computeMutation.mutate()}
              disabled={computeMutation.isPending || !calcStart || calcN === ""}
              data-testid="button-compute"
            >
              {computeMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Compute
            </Button>
            {calcResult && (
              <Badge variant="secondary" className="text-sm h-9 px-3" data-testid="text-calc-result">
                Result: {calcResult}
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="check-date">Is this a business day?</Label>
              <Input id="check-date" type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} data-testid="input-check-date" />
            </div>
            <Button
              variant="outline"
              onClick={() => checkMutation.mutate()}
              disabled={checkMutation.isPending || !checkDate}
              data-testid="button-check-day"
            >
              {checkMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Check
            </Button>
            {checkResult !== null && (
              <Badge
                variant={checkResult ? "secondary" : "destructive"}
                className="text-sm h-9 px-3"
                data-testid="text-check-result"
              >
                {checkResult ? "Business day (open)" : "Not a business day (closed)"}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <AnnotatedMonthCalendar calendarId={id} />
    </div>
  );
}

export default function BusinessCalendarTestPage() {
  return (
    <BusinessCalendarLayout activeTab="test">
      <TestTabContent />
    </BusinessCalendarLayout>
  );
}
