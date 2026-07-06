import { Link } from "wouter";
import { ResultsTable as FrameworkResultsTable } from "@/components/wizards/framework/ResultsTable";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface WorkerDetail {
  workerId: string;
  siriusId: string;
  displayName: string;
}

/**
 * Duplicate-SSN report results. Reuses the generic framework table but
 * renders the `workers` column as clickable per-worker links from the
 * row's `workerDetails` array (matching the legacy report ResultsStep).
 */
export function ResultsTable(props: WizardStepComponentProps) {
  return (
    <FrameworkResultsTable
      {...props}
      renderCell={(col, row) => {
        if (col.id === "workers" && Array.isArray(row.workerDetails)) {
          const details = row.workerDetails as WorkerDetail[];
          return (
            <div className="space-y-1">
              {details.map((worker) => (
                <div key={worker.workerId}>
                  <Link
                    href={`/workers/${worker.workerId}`}
                    className="text-sm font-medium text-primary hover:underline"
                    data-testid={`link-worker-${worker.workerId}`}
                  >
                    {worker.displayName} (ID: {worker.siriusId})
                  </Link>
                </div>
              ))}
            </div>
          );
        }
        return undefined;
      }}
    />
  );
}
