import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  businessCalendarSources,
  type BusinessCalendarData,
  type BusinessCalendarSource,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  BusinessCalendarLayout,
  useBusinessCalendarLayout,
} from "@/components/layouts/BusinessCalendarLayout";

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

function SettingsTabContent() {
  const { full, calendarId: id } = useBusinessCalendarLayout();
  const calendar = full.calendar;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [siriusId, setSiriusId] = useState("");
  const [region, setRegion] = useState("");
  const [weekends, setWeekends] = useState<number[]>([6, 7]);
  const [sources, setSources] = useState<BusinessCalendarSource[]>([]);

  useEffect(() => {
    const data = (calendar.data ?? {}) as BusinessCalendarData;
    setName(calendar.name);
    setDescription(calendar.description || "");
    setSiriusId(calendar.siriusId || "");
    setRegion(data.region || "");
    setWeekends(data.weekends?.length ? data.weekends : [6, 7]);
    setSources((calendar.sources || []) as BusinessCalendarSource[]);
  }, [calendar]);

  const onMutationError = (fallback: string) => (error: any) =>
    toast({ title: "Error", description: error.message || fallback, variant: "destructive" });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const existingData = (calendar.data ?? {}) as Record<string, unknown>;
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
      queryClient.invalidateQueries({ queryKey: ["/api/business-calendars", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/business-calendars"] });
      toast({ title: "Saved", description: "Calendar settings updated." });
    },
    onError: onMutationError("Failed to save calendar."),
  });

  const toggleSource = (source: BusinessCalendarSource, checked: boolean) => {
    setSources((prev) => (checked ? [...prev, source] : prev.filter((s) => s !== source)));
  };
  const toggleWeekday = (iso: number, checked: boolean) => {
    setWeekends((prev) =>
      checked ? [...prev, iso].sort((a, b) => a - b) : prev.filter((d) => d !== iso),
    );
  };
  const sourceOn = (s: BusinessCalendarSource) => sources.includes(s);

  return (
    <div className="space-y-6">
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
              source is re-enabled. The Closed Days, Vacations, and Forced-Open Days tabs only appear
              while their source is enabled.
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
    </div>
  );
}

export default function BusinessCalendarDetailPage() {
  return (
    <BusinessCalendarLayout activeTab="settings">
      <SettingsTabContent />
    </BusinessCalendarLayout>
  );
}
