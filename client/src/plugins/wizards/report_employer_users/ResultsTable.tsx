import { Link } from "wouter";
import { Eye } from "lucide-react";
import { ResultsTable as FrameworkResultsTable } from "@/components/wizards/framework/ResultsTable";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

/**
 * Employer Users report results. Reuses the generic framework table but
 * renders the bespoke `viewLink` action column as an Eye link to the
 * employer contact (matching the legacy report ResultsStep). All other
 * columns (boolean/date/string) fall through to the generic renderer.
 */
export function ResultsTable(props: WizardStepComponentProps) {
  return (
    <FrameworkResultsTable
      {...props}
      renderCell={(col, row) => {
        if (col.id === "viewLink") {
          const id = row.employerContactId;
          if (id === null || id === undefined) return "";
          return (
            <Link
              href={`/employer-contacts/${id}`}
              className="inline-flex items-center text-primary hover:text-primary/80"
              data-testid={`link-view-${id}`}
            >
              <Eye className="h-4 w-4" />
            </Link>
          );
        }
        return undefined;
      }}
    />
  );
}
