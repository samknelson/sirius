import { complianceReportSnapshotSchema } from "@shared/employer-compliance";
import { BulkEnqueueError } from "./bulk-enqueue-templates";
import type { z } from "zod";

type Snapshot = z.infer<typeof complianceReportSnapshotSchema>;
const scopeKey = ({ scope }: Snapshot) => JSON.stringify([
  scope.wizardType, scope.year, scope.month, scope.monthsBack,
  [...scope.ledgerAccountIds].sort(),
]);

/** Adding recipients must never re-date or recalculate earlier recipients' letters. */
export function extendComplianceSnapshot(
  previous: unknown, candidate: Snapshot, employerIds: string[],
): Snapshot {
  if (previous === undefined) return candidate;
  const parsed = complianceReportSnapshotSchema.safeParse(previous);
  if (!parsed.success || scopeKey(parsed.data) !== scopeKey(candidate)) {
    throw new BulkEnqueueError("This message belongs to a different compliance report. Choose another message or create a new draft.", 409);
  }
  const saved = parsed.data;
  if (employerIds.some(id => !saved.valuesByEmployer[id])) {
    throw new BulkEnqueueError("The saved report does not include all selected employers. Create a new draft to capture a new report.", 409);
  }
  const employerByContact = { ...saved.employerByContact };
  for (const [contact, employer] of Object.entries(candidate.employerByContact)) {
    if (employerByContact[contact] && employerByContact[contact] !== employer) {
      throw new BulkEnqueueError("A contact is already linked to another employer in this message. Queue those employers separately.", 409);
    }
    employerByContact[contact] = employer;
  }
  return { ...saved, employerByContact };
}
