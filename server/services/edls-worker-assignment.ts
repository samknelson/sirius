import type { AssignmentForWorker } from "../storage/edls/assignments";
import { entityMetadataStorage } from "../storage/system/entity-metadata";

export type ReviewScheduleAssignment = Pick<AssignmentForWorker, "assignmentId" | "ymd"> & {
  sheetStatus: "draft" | "request";
};
export type ConfirmedScheduleAssignment = AssignmentForWorker & {
  sheetStatus: "lock" | "reserved"; revision: number | null; updatedAt: string | null;
};

/** The same allowlist and metadata interpretation for public JSON and worker messages. */
export async function projectWorkerAssignments(
  assignments: AssignmentForWorker[],
): Promise<Array<ReviewScheduleAssignment | ConfirmedScheduleAssignment>> {
  const metadata = await entityMetadataStorage.getMany(
    assignments.filter(a => a.sheetStatus === "lock" || a.sheetStatus === "reserved").map(a => a.assignmentId),
  );
  return assignments.map(assignment => {
    if (assignment.sheetStatus === "draft" || assignment.sheetStatus === "request") {
      return { assignmentId: assignment.assignmentId, ymd: assignment.ymd, sheetStatus: assignment.sheetStatus };
    }
    if (assignment.sheetStatus !== "lock" && assignment.sheetStatus !== "reserved") {
      throw new Error("Unexpected EDLS public schedule sheet status");
    }
    const record = metadata.get(assignment.assignmentId);
    const own = record?.contextId === "edls_assignments" ? record : null;
    const modified = own?.modified.date;
    return {
      ...assignment, sheetStatus: assignment.sheetStatus,
      revision: own && Number.isSafeInteger(own.rev) && own.rev > 0 ? own.rev : null,
      updatedAt: modified && Number.isFinite(modified.getTime()) ? modified.toISOString() : null,
    };
  });
}
