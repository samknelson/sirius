import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarDays, CheckCircle2, Loader2, Save, XCircle } from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface WeekInfo {
  week: number;
  payWeekStart: string | null;
  payWeekEnding: string | null;
  checkDate: string | null;
}

interface WeekDatesData {
  weeks: WeekInfo[];
  parseError: string | null;
  weekDates: Record<string, string>;
  weekDateSource: Record<string, string>;
}

type SourceChoice = "pay_week_ending" | "check_date" | "manual";

/**
 * Week Dates step: for each detected reporting week, pick where its date
 * comes from — the file's pay-week ending, the (modal) check date, or a
 * manually entered date.
 */
export function Local26WeekDates({ wizardId, step }: WizardStepComponentProps) {
  const { data, isLoading } = useQuery<WeekDatesData>({
    queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
  });

  const [sources, setSources] = useState<Record<number, SourceChoice>>({});
  const [manualDates, setManualDates] = useState<Record<number, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!data || hydrated) return;
    const s: Record<number, SourceChoice> = {};
    const m: Record<number, string> = {};
    for (const w of data.weeks) {
      const savedSource = data.weekDateSource?.[String(w.week)] as SourceChoice | undefined;
      const savedDate = data.weekDates?.[String(w.week)];
      if (savedSource) {
        s[w.week] = savedSource;
        if (savedSource === "manual" && savedDate) m[w.week] = savedDate;
      } else if (w.payWeekEnding) {
        s[w.week] = "pay_week_ending";
      } else if (w.checkDate) {
        s[w.week] = "check_date";
      } else {
        s[w.week] = "manual";
        if (savedDate) m[w.week] = savedDate;
      }
    }
    setSources(s);
    setManualDates(m);
    setHydrated(true);
  }, [data, hydrated]);

  const resolvedDate = (w: WeekInfo): string | null => {
    const source = sources[w.week];
    if (source === "pay_week_ending") return w.payWeekEnding;
    if (source === "check_date") return w.checkDate;
    return manualDates[w.week] || null;
  };

  const allResolved =
    !!data && data.weeks.length > 0 && data.weeks.every((w) => resolvedDate(w));

  const handleSave = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const weekDates: Record<string, string> = {};
      const weekDateSource: Record<string, string> = {};
      for (const w of data.weeks) {
        const date = resolvedDate(w);
        if (!date) throw new Error(`Week ${w.week} has no date`);
        weekDates[String(w.week)] = date;
        weekDateSource[String(w.week)] = sources[w.week];
      }
      await apiRequest(
        "POST",
        `/api/wizards/${wizardId}/dispatch/${step.id}/submit`,
        { input: { weekDates, weekDateSource } },
      );
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
      queryClient.invalidateQueries({
        queryKey: ["/api/wizards", wizardId, "dispatch", step.id, "data"],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save week dates");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          Reporting Week Dates
        </CardTitle>
        <CardDescription>
          Confirm where each reporting week's date comes from, or set it
          manually. Weekly hours and dues are recorded under these dates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data?.parseError && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertTitle>Could not parse the file</AlertTitle>
            <AlertDescription>{data.parseError}</AlertDescription>
          </Alert>
        )}
        {data && data.weeks.length === 0 && !data.parseError && (
          <p className="text-muted-foreground text-sm">
            No reporting weeks detected. Upload and map the file first.
          </p>
        )}
        {data?.weeks.map((w) => (
          <div
            key={w.week}
            className="flex flex-col sm:flex-row sm:items-center gap-3 border rounded-md p-3"
            data-testid={`week-dates-row-${w.week}`}
          >
            <div className="w-24 shrink-0 font-medium">Week {w.week}</div>
            <div className="flex-1">
              <Select
                value={sources[w.week] || "manual"}
                onValueChange={(v) => {
                  setSources((prev) => ({ ...prev, [w.week]: v as SourceChoice }));
                  setSaved(false);
                }}
              >
                <SelectTrigger data-testid={`select-week-source-${w.week}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {w.payWeekEnding && (
                    <SelectItem value="pay_week_ending">
                      Pay week ending ({w.payWeekEnding})
                    </SelectItem>
                  )}
                  {w.checkDate && (
                    <SelectItem value="check_date">
                      Check date ({w.checkDate})
                    </SelectItem>
                  )}
                  <SelectItem value="manual">Set date manually</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sources[w.week] === "manual" && (
              <Input
                type="date"
                className="sm:w-44"
                value={manualDates[w.week] || ""}
                onChange={(e) => {
                  setManualDates((prev) => ({ ...prev, [w.week]: e.target.value }));
                  setSaved(false);
                }}
                data-testid={`input-week-date-${w.week}`}
              />
            )}
            <div className="w-32 shrink-0 text-sm text-muted-foreground">
              {resolvedDate(w) || "no date"}
            </div>
          </div>
        ))}

        {error && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {data && data.weeks.length > 0 && (
          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={!allResolved || saving}
              data-testid="button-save-week-dates"
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save Week Dates
            </Button>
            {saved && (
              <span className="text-sm text-green-600 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Saved
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
