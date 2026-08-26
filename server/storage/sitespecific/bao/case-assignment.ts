/**
 * Pure self-vs-other BAO case assignment rule, shared by the create and
 * lifecycle-update routes (and unit-testable without a database).
 *
 * Ordinary BAO staff may only assign a case to THEMSELVES: creating a case
 * assigned to themselves, or explicitly taking an existing case. Holders of
 * the `bao.case.assign` permission may pick any assignee (eligibility —
 * active staff — stays authoritative in storage's isAssignableUser).
 *
 * A request that names the case's CURRENT assignee is never a reassignment:
 * lifecycle edits that echo the unchanged assignee must not require the
 * permission and must not be treated as an assignment.
 */
export const BAO_CASE_ASSIGN_PERMISSION = "bao.case.assign";

export function assignmentForbidden(input: {
  /** Assignee the request names; null/undefined when the request omits it. */
  requestedAssigneeId: string | null | undefined;
  /** The effective acting user. */
  actorUserId: string;
  /** Current assignee for updates; null for creation. */
  existingAssigneeId: string | null;
  /** Whether the actor holds the assign-to-others permission. */
  canAssignOthers: boolean;
}): boolean {
  const { requestedAssigneeId, actorUserId, existingAssigneeId, canAssignOthers } = input;
  if (!requestedAssigneeId) return false; // no assignment requested
  if (canAssignOthers) return false;
  if (requestedAssigneeId === actorUserId) return false; // self-assign / take
  if (existingAssigneeId !== null && requestedAssigneeId === existingAssigneeId) {
    return false; // unchanged assignee echoed on a lifecycle edit
  }
  return true;
}
