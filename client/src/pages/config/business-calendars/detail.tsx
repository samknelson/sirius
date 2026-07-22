import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
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

interface HolidayRegionOption {
  code: string;
  name: string;
}

interface RegionOptionsResponse {
  options: HolidayRegionOption[];
}

function RegionCombobox({
  label,
  value,
  options,
  isLoading,
  placeholder,
  allowNone,
  onSelect,
  testId,
}: {
  label: string;
  value: string;
  options: HolidayRegionOption[];
  isLoading: boolean;
  placeholder: string;
  allowNone: boolean;
  onSelect: (code: string) => void;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.code.toLowerCase() === value.toLowerCase());
  const display = selected ? selected.name : value ? `${value} (unrecognized)` : placeholder;
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            disabled={isLoading}
            data-testid={testId}
          >
            <span className={cn("truncate", !selected && !value && "text-muted-foreground")}>
              {isLoading ? "Loading…" : display}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>No match found.</CommandEmpty>
              <CommandGroup>
                {allowNone && (
                  <CommandItem
                    value="__none__"
                    onSelect={() => {
                      onSelect("");
                      setOpen(false);
                    }}
                    data-testid={`${testId}-option-none`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === "" ? "opacity-100" : "opacity-0")} />
                    None
                  </CommandItem>
                )}
                {options.map((o) => (
                  <CommandItem
                    key={o.code}
                    value={`${o.name} ${o.code}`}
                    onSelect={() => {
                      onSelect(o.code);
                      setOpen(false);
                    }}
                    data-testid={`${testId}-option-${o.code}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        o.code.toLowerCase() === value.toLowerCase() ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {o.name} <span className="ml-1 text-muted-foreground">({o.code})</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SettingsTabContent() {
  const { full, calendarId: id } = useBusinessCalendarLayout();
  const calendar = full.calendar;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [siriusId, setSiriusId] = useState("");
  const [regionCountry, setRegionCountry] = useState("");
  const [regionState, setRegionState] = useState("");
  const [regionSub, setRegionSub] = useState("");
  const [weekends, setWeekends] = useState<number[]>([6, 7]);
  const [sources, setSources] = useState<BusinessCalendarSource[]>([]);

  useEffect(() => {
    const data = (calendar.data ?? {}) as BusinessCalendarData;
    setName(calendar.name);
    setDescription(calendar.description || "");
    setSiriusId(calendar.siriusId || "");
    const [country = "", state = "", sub = ""] = (data.region || "").split("-");
    setRegionCountry(country);
    setRegionState(state);
    setRegionSub(sub);
    setWeekends(data.weekends?.length ? data.weekends : [6, 7]);
    setSources((calendar.sources || []) as BusinessCalendarSource[]);
  }, [calendar]);

  const countriesQuery = useQuery<RegionOptionsResponse>({
    queryKey: ["/api/business-calendars", "holiday-regions"],
  });
  const statesQuery = useQuery<RegionOptionsResponse>({
    queryKey: [
      "/api/business-calendars",
      `holiday-regions?country=${encodeURIComponent(regionCountry)}`,
    ],
    enabled: !!regionCountry,
  });
  const subsQuery = useQuery<RegionOptionsResponse>({
    queryKey: [
      "/api/business-calendars",
      `holiday-regions?country=${encodeURIComponent(regionCountry)}&state=${encodeURIComponent(regionState)}`,
    ],
    enabled: !!regionCountry && !!regionState,
  });

  const countryOptions = countriesQuery.data?.options ?? [];
  const stateOptions = statesQuery.data?.options ?? [];
  const subOptions = subsQuery.data?.options ?? [];
  const region = [regionCountry, regionState, regionSub].filter(Boolean).join("-");

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
          region: region || undefined,
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
  const anyHolidaySourceOn = sources.some((s) => s.startsWith("date-holiday-"));

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
          {anyHolidaySourceOn && (
          <div className="space-y-2">
            <Label>Holiday region</Label>
            <div className="grid gap-3 sm:grid-cols-3">
              <RegionCombobox
                label="Country"
                value={regionCountry}
                options={countryOptions}
                isLoading={countriesQuery.isLoading}
                placeholder="Select a country…"
                allowNone
                onSelect={(code) => {
                  setRegionCountry(code);
                  setRegionState("");
                  setRegionSub("");
                }}
                testId="combobox-region-country"
              />
              {regionCountry && (statesQuery.isLoading || stateOptions.length > 0 || !!regionState) && (
                <RegionCombobox
                  label="State / territory"
                  value={regionState}
                  options={stateOptions}
                  isLoading={statesQuery.isLoading}
                  placeholder="Whole country"
                  allowNone
                  onSelect={(code) => {
                    setRegionState(code);
                    setRegionSub("");
                  }}
                  testId="combobox-region-state"
                />
              )}
              {regionCountry &&
                regionState &&
                (subsQuery.isLoading || subOptions.length > 0 || !!regionSub) && (
                  <RegionCombobox
                    label="Region"
                    value={regionSub}
                    options={subOptions}
                    isLoading={subsQuery.isLoading}
                    placeholder="Whole state"
                    allowNone
                    onSelect={(code) => setRegionSub(code)}
                    testId="combobox-region-sub"
                  />
                )}
            </div>
            <p className="text-sm text-muted-foreground">
              {region
                ? `Saved as "${region}". Used by the holiday sources below.`
                : "Pick a country (and optionally a state and region) to enable the holiday sources below."}
            </p>
          </div>
          )}

          {sourceOn("weekends") && (
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
          )}

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
