import { useId } from "react";
import { Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";

/** Presentation only: callers retain ownership of polling, admission and locks. */
export function WizardProgress({ label, percentComplete, phase, counts, activity = "Running…" }: {
  label: string;
  percentComplete?: number | null;
  phase?: string;
  counts?: string;
  activity?: string;
}) {
  const descriptionId = useId();
  const measured = typeof percentComplete === "number" && Number.isFinite(percentComplete) &&
    percentComplete >= 0 && percentComplete <= 100;

  return <div className="space-y-2">
    {measured
      ? <Progress value={percentComplete} aria-label={label} aria-describedby={descriptionId}
          className="motion-reduce:[&>div]:transition-none" />
      : <div role="progressbar" aria-label={label} aria-describedby={descriptionId}
          className="h-4 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse" />
        </div>}
    <p id={descriptionId} role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary motion-safe:animate-spin" />
      <span>{activity}{measured ? ` ${percentComplete}%` : " Progress percentage unavailable."}
        {phase && ` · ${phase}`}{counts && ` · ${counts}`}
      </span>
    </p>
  </div>;
}
