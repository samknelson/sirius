import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  CalendarDays,
  Calculator,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import {
  businessCalendarSources,
  type BusinessCalendar,
  type BusinessCalendarData,
  type BusinessCalendarManualByday,
  type BusinessCalendarManualVacation,
  type BusinessCalendarManualOpen,
  type BusinessCalendarSource,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface CalendarWithRules {
  calendar: BusinessCalendar;
  manualByday: BusinessCalendarManualByday[];
  manualVacations: BusinessCalendarManualVacation[];
  manualOpen: BusinessCalendarManualOpen[];
}

const SOURCE_LABELS: Record<BusinessCalendarSource, string> = {
  weekends: "Weekends",
  "manual-byday": "Manual closed days",
  "manual-vacation": "Vacations (closed ranges)",
  "manual-open": "Forced-open days (override)",
  "date-holiday-public": "Holidays: public",
  "date-holiday-bank": "Holidays: bank",
  "date-holiday-observance": "Holidays: observance",
  "date-holiday-school": "Holidays: school",
  "date-holiday-optional": "Holidays: optional",
};

const WEEKDAYS: Array<{ iso: number; label: string }> = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

export default function BusinessCalendarDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: full, isLoading } = useQuery<CalendarWithRules>({
    queryKey: ["/api/business-calendars", id],
  });
  const calendar = full?.calendar;

  usePageTitle(calendar ? `Calendar: ${calendar.name}` : "Business Calendar");

  // ── Settings form state ─────────────────────────────────────────
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [siriusId, setSiriusId] = useState("");
  const [region, setRegion] = useState("");
  const [weekends, setWeekends] = useState<number[]>([6, 7]);
  const [sources, setSources] = useState<BusinessCalendarSource[]>([]);

  useEffect(() => {
    if (!calendar) return;
    const data = (calendar.data ?? {}) as BusinessCalendarData;
    setName(calendar.name);
    setDescription(calendar.description || "");
    setSiriusId(calendar.siriusId || "");
    setRegion(data.region || "");
    setWeekends(data.weekends?.length ? data.weekends : [6, 7]);
    setSources((calendar.sources || []) as BusinessCalendarSource[]);
  }, [calendar]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/business-calendars", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/business-calendars"] });
  };

  const onMutationError = (fallback: string) => (error: any) =>
    toast({ title: "Error", description: error.message || fallback, variant: "destructive" });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existingData = (calendar?.data ?? {}) as Record<string, unknown>;
      return apiRequest("PUT", `/api/business-calendars/${id}`, {
        name: name.trim(),
        description: description.trim() || null,
        siriusId: siriusId.trim() || null,
        sources,
        data: {
          ...existingData,
          region: region.trim() || undefined,
          weekends,
        },
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Saved", description: "Calendar settings updated." });
    },
    onError: onMutationError("Failed to save calendar."),
  });

  // ── Manual rows ─────────────────────────────────────────────────
  const [newClosedDay, setNewClosedDay] = useState("");
  const [newOpenDay, setNewOpenDay] = useState("");
  const [newVacStart, setNewVacStart] = useState("");
  const [newVacEnd, setNewVacEnd] = useState("");

  const addBydayMutation = useMutation({
    mutationFn: async (ymd: string) =>
      apiRequest("POST", `/api/business-calendars/${id}/manual-byday`, { ymd }),
    onSuccess: () => {
      invalidate();
      setNewClosedDay("");
    },
    onError: onMutationError("Failed to add closed day."),
  });
  const deleteBydayMutation = useMutation({
    mutationFn: async (rowId: string) =>
      apiRequest("DELETE", `/api/business-calendars/${id}/manual-byday/${rowId}`),
    onSuccess: invalidate,
    onError: onMutationError("Failed to delete closed day."),
  });

  const addVacationMutation = useMutation({
    mutationFn: async (v: { startYmd: string; endYmd: string }) =>
      apiRequest("POST", `/api/business-calendars/${id}/manual-vacations`, v),
    onSuccess: () => {
      invalidate();
      setNewVacStart("");
      setNewVacEnd("");
    },
    onError: onMutationError("Failed to add vacation."),
  });
  const deleteVacationMutation = useMutation({
    mutationFn: async (rowId: string) =>
      apiRequest("DELETE", `/api/business-calendars/${id}/manual-vacations/${rowId}`),
    onSuccess: invalidate,
    onError: onMutationError("Failed to delete vacation."),
  });

  const addOpenMutation = useMutation({
    mutationFn: async (ymd: string) =>
      apiRequest("POST", `/api/business-calendars/${id}/manual-open`, { ymd }),
    onSuccess: () => {
      invalidate();
      setNewOpenDay("");
    },
    onError: onMutationError("Failed to add open day."),
  });
  const deleteOpenMutation = useMutation({
    mutationFn: async (rowId: string) =>
      apiRequest("DELETE", `/api/business-calendars/${id}/manual-open/${rowId}`),
    onSuccess: invalidate,
    onError: onMutationError("Failed to delete open day."),
  });

  // ── Test calculator ─────────────────────────────────────────────
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

  const toggleSource = (source: BusinessCalendarSource, checked: boolean) => {
    setSources((prev) => (checked ? [...prev, source] : prev.filter((s) => s !== source)));
  };
  const toggleWeekday = (iso: number, checked: boolean) => {
    setWeekends((prev) =>
      checked ? [...prev, iso].sort((a, b) => a - b) : prev.filter((d) => d !== iso),
    );
  };

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!full || !calendar) {
    return (
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-muted-foreground" data-testid="text-calendar-not-found">
          Business calendar not found.
        </p>
        <Link href="/config/business-calendars">
          <Button variant="outline" className="mt-4" data-testid="button-back-to-list">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to calendars
          </Button>
        </Link>
      </div>
    );
  }

  const sourceOn = (s: BusinessCalendarSource) => sources.includes(s);

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/config/business-calendars">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <CalendarDays className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="heading-calendar-name">
          {calendar.name}
        </h1>
      </div>

      {/* Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Calendar Settings</CardTitle>
          <CardDescription>
            Name, region, weekend days, and which closure sources are active.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cal-name">Name *</Label>
              <Input id="cal-name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-calendar-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-sirius-id">Sirius ID</Label>
              <Input id="cal-sirius-id" value={siriusId} onChange={(e) => setSiriusId(e.target.value)} placeholder="Optional unique ID" data-testid="input-calendar-sirius-id" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cal-description">Description</Label>
            <Textarea id="cal-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-calendar-description" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cal-region">Holiday region</Label>
            <Input
              id="cal-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder='e.g. "US", "US-la", or "US-la-no"'
              data-testid="input-calendar-region"
            />
            <p className="text-sm text-muted-foreground">
              Country, optionally followed by state and region, separated by dashes. Used by the
              holiday sources below.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Weekend days</Label>
            <div className="flex flex-wrap gap-4">
              {WEEKDAYS.map((d) => (
                <label key={d.iso} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={weekends.includes(d.iso)}
                    onCheckedChange={(c) => toggleWeekday(d.iso, c === true)}
                    data-testid={`checkbox-weekend-${d.iso}`}
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              These days are closed when the "Weekends" source is enabled.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Active sources</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {businessCalendarSources.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sourceOn(s)}
                    onCheckedChange={(c) => toggleSource(s, c === true)}
                    data-testid={`checkbox-source-${s}`}
                  />
                  {SOURCE_LABELS[s]}
                </label>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Turning a manual source off keeps its saved days — they simply stop applying until the
              source is re-enabled.
            </p>
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim()}
            data-testid="button-save-calendar"
          >
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Test calculator */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Test Calculator
          </CardTitle>
          <CardDescription>
            Sanity-check this calendar against the server's business-day computation. Uses the
            saved settings — save first if you changed anything above.
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

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Manual closed days */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closed Days</CardTitle>
            <CardDescription>
              Single closed days.{" "}
              {!sourceOn("manual-byday") && (
                <span className="text-destructive">Source is off — these are inactive.</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input type="date" value={newClosedDay} onChange={(e) => setNewClosedDay(e.target.value)} data-testid="input-new-closed-day" />
              <Button
                size="icon"
                onClick={() => newClosedDay && addBydayMutation.mutate(newClosedDay)}
                disabled={!newClosedDay || addBydayMutation.isPending}
                data-testid="button-add-closed-day"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Table>
              <TableBody>
                {full.manualByday.length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground text-sm">No closed days.</TableCell>
                  </TableRow>
                )}
                {full.manualByday.map((row) => (
                  <TableRow key={row.id} data-testid={`row-closed-day-${row.id}`}>
                    <TableCell className="font-mono text-sm">{row.ymd}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteBydayMutation.mutate(row.id)}
                        data-testid={`button-delete-closed-day-${row.id}`}
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

        {/* Vacations */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vacations</CardTitle>
            <CardDescription>
              Closed date ranges.{" "}
              {!sourceOn("manual-vacation") && (
                <span className="text-destructive">Source is off — these are inactive.</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input type="date" value={newVacStart} onChange={(e) => setNewVacStart(e.target.value)} data-testid="input-new-vacation-start" />
                <Input type="date" value={newVacEnd} onChange={(e) => setNewVacEnd(e.target.value)} data-testid="input-new-vacation-end" />
              </div>
              <Button
                size="sm"
                className="w-full"
                onClick={() => {
                  if (!newVacStart || !newVacEnd) return;
                  if (newVacStart > newVacEnd) {
                    toast({
                      title: "Validation Error",
                      description: "Start date must be on or before the end date.",
                      variant: "destructive",
                    });
                    return;
                  }
                  addVacationMutation.mutate({ startYmd: newVacStart, endYmd: newVacEnd });
                }}
                disabled={!newVacStart || !newVacEnd || addVacationMutation.isPending}
                data-testid="button-add-vacation"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Vacation
              </Button>
            </div>
            <Table>
              <TableBody>
                {full.manualVacations.length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground text-sm">No vacations.</TableCell>
                  </TableRow>
                )}
                {full.manualVacations.map((row) => (
                  <TableRow key={row.id} data-testid={`row-vacation-${row.id}`}>
                    <TableCell className="font-mono text-sm">
                      {row.startYmd} → {row.endYmd}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteVacationMutation.mutate(row.id)}
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

        {/* Forced open */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Forced-Open Days</CardTitle>
            <CardDescription>
              Always business days, overriding every closure.{" "}
              {!sourceOn("manual-open") && (
                <span className="text-destructive">Source is off — these are inactive.</span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input type="date" value={newOpenDay} onChange={(e) => setNewOpenDay(e.target.value)} data-testid="input-new-open-day" />
              <Button
                size="icon"
                onClick={() => newOpenDay && addOpenMutation.mutate(newOpenDay)}
                disabled={!newOpenDay || addOpenMutation.isPending}
                data-testid="button-add-open-day"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Table>
              <TableBody>
                {full.manualOpen.length === 0 && (
                  <TableRow>
                    <TableCell className="text-muted-foreground text-sm">No forced-open days.</TableCell>
                  </TableRow>
                )}
                {full.manualOpen.map((row) => (
                  <TableRow key={row.id} data-testid={`row-open-day-${row.id}`}>
                    <TableCell className="font-mono text-sm">{row.ymd}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteOpenMutation.mutate(row.id)}
                        data-testid={`button-delete-open-day-${row.id}`}
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
    </div>
  );
}
