import type { BaoCaseStatusSavedPayload } from "../../../services/event-bus";
import type { TokenEntity } from "../../tokens/types";
import { composeBaoCaseEntity } from "../../tokens/plugins/sitespecific-bao-case";

/**
 * Did this committed write genuinely change the assignee? Creation counts
 * (null → assignee), so being handed a brand-new case notifies too; the
 * self-take/self-create cases are handled by actor suppression, not here.
 * Legacy emits without the assignee identity never count.
 */
export function assignmentChange(payload: BaoCaseStatusSavedPayload): boolean {
  if (typeof payload.assigneeUserId !== "string" || !payload.assigneeUserId) return false;
  if (payload.previousAssigneeUserId === undefined) return false;
  return payload.previousAssigneeUserId !== payload.assigneeUserId;
}

/**
 * Did this committed write ARRIVE at one of the given statuses? Creation
 * into it counts; a save that leaves the status unchanged does not.
 */
export function statusEntry(payload: BaoCaseStatusSavedPayload, statusIds: string[]): boolean {
  if (!payload.statusId || payload.previousStatusId === undefined) return false;
  if (!statusIds.includes(payload.statusId)) return false;
  return payload.previousStatusId !== payload.statusId;
}

/**
 * The `sitespecific_bao_case` token record for a committed case write,
 * shared by every notifier on BAO_CASE_STATUS_SAVED so the same event seeds
 * the same record on every surface.
 *
 * The committed case row carried on the event, plus the event-time display
 * names and appeal facts captured in the writing transaction. Not reloaded
 * by id: a later edit (or delete) must not rewrite the message this
 * transition earned. `change_summary` states what THIS write did — an
 * assignment-only save must not imply a status transition that never
 * happened.
 */
export function buildBaoCaseRecord(payload: BaoCaseStatusSavedPayload): TokenEntity | null {
  if (!payload.row) return null;
  const statusMoved = payload.previousStatusId !== payload.statusId;
  const changeSummary =
    !statusMoved && assignmentChange(payload)
      ? `was assigned to ${payload.assigneeName ?? "a new assignee"}`
      : `is now ${payload.statusName}`;
  return composeBaoCaseEntity(
    payload.row,
    {
      statusName: payload.statusName,
      entityName: payload.entityName,
      assigneeName: payload.assigneeName ?? null,
      benefitName: payload.benefitName ?? null,
      denialReasonName: payload.denialReasonName ?? null,
      spdCitation: payload.spdCitation ?? null,
    },
    changeSummary,
  );
}
