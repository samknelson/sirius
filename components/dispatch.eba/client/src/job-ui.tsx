import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import type { DispatchFormProps } from "../../../../client/src/lib/dispatch-contributions";
import type { DispatchJob, JobTypeData } from "@shared/schema";
export function EbaJobSettings({ data, jobTypeData, register }: DispatchFormProps) {
  const [allow, setAllow] = useState((data as { allowEbaWorkers?: boolean } | undefined)?.allowEbaWorkers !== false);
  const applicable = jobTypeData?.primary === "both";
  useEffect(() => register("dispatch.eba", {
    prepareData(value) {
      const result = { ...value };
      if (applicable) result.allowEbaWorkers = allow;
      else delete result.allowEbaWorkers;
      return result;
    },
  }), [register, allow, applicable]);
  if (!applicable) return null;
  return <div className="flex items-start gap-3 p-3 border rounded-md bg-muted/30">
    <Checkbox id="allow-eba-workers" checked={allow} onCheckedChange={checked => setAllow(checked === true)} data-testid="checkbox-allow-eba" />
    <div className="space-y-1">
      <label htmlFor="allow-eba-workers" className="text-sm font-medium cursor-pointer">Allow EBA Workers</label>
      <p className="text-sm text-muted-foreground">When unchecked, only workers with dispatch status Available are eligible — workers who are merely "Employed but Available" for the start date are excluded.</p>
    </div>
  </div>;
}
export function EbaJobSummary({ job, jobTypeData }: { job: DispatchJob; jobTypeData?: JobTypeData }) {
  if (jobTypeData?.primary !== "both") return null;
  const allowed = (job.data as { allowEbaWorkers?: boolean } | null)?.allowEbaWorkers !== false;
  return <div><p className="text-sm text-muted-foreground">Allow EBA Workers</p><p data-testid="text-allow-eba">{allowed ? "Yes" : "No"}</p></div>;
}
