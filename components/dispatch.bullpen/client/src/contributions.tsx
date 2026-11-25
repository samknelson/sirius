import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DispatchFormProps } from "../../../../client/src/lib/dispatch-contributions";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

function BullpenSettings({ data, register }: DispatchFormProps) {
  const existing = data as { bullpen?: string; bullpenEventTypeId?: string } | undefined;
  const [setting, setSetting] = useState(existing?.bullpen || "none");
  const [eventTypeId, setEventTypeId] = useState(existing?.bullpenEventTypeId || "");
  const [error, setError] = useState<string | null>(null);
  const { data: eventTypes = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ["/api/options/event-type"] });
  useEffect(() => {
    setSetting(existing?.bullpen || "none");
    setEventTypeId(existing?.bullpenEventTypeId || "");
    setError(null);
  }, [data]);
  useEffect(() => register("dispatch.bullpen", {
    validate() {
      const error = setting !== "none" && !eventTypeId ? "An event type is required when Bullpen is set to Host or Shared." : null;
      setError(error);
      return error;
    },
    prepareData(value) {
      const result = { ...value, bullpen: setting };
      if (setting === "none") delete (result as Record<string, unknown>).bullpenEventTypeId;
      else (result as Record<string, unknown>).bullpenEventTypeId = eventTypeId;
      return result;
    },
  }), [register, setting, eventTypeId]);
  return <>
    <div className="space-y-2">
      <FormLabel>Bullpen?</FormLabel>
      <Select value={setting} onValueChange={value => { setSetting(value); if (value === "none") { setEventTypeId(""); setError(null); } }}>
        <SelectTrigger data-testid="select-bullpen"><SelectValue /></SelectTrigger>
        <SelectContent>{["none", "host", "shared"].map(value => <SelectItem key={value} value={value} data-testid={`option-bullpen-${value}`}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">Whether this job type hosts a bullpen or shares one.</p>
    </div>
    {setting !== "none" && <div className="space-y-2">
      <FormLabel>Event Type</FormLabel>
      <Select value={eventTypeId} onValueChange={value => { setEventTypeId(value); setError(null); }}>
        <SelectTrigger data-testid="select-bullpen-event-type"><SelectValue placeholder="Select an event type" /></SelectTrigger>
        <SelectContent>{eventTypes.map(type => <SelectItem key={type.id} value={type.id} data-testid={`option-event-type-${type.id}`}>{type.name}</SelectItem>)}</SelectContent>
      </Select>
      {error && <p className="text-sm font-medium text-destructive" data-testid="error-bullpen-event-type">{error}</p>}
      <p className="text-sm text-muted-foreground">Required for host or shared bullpens.</p>
    </div>}
  </>;
}
export const contributions: ComponentBrowserContributions = {
  dispatchUi: [{ component: "dispatch.bullpen", jobTypeForm: BullpenSettings }],
};
