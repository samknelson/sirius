import { getCommStatusBucket } from "../../../shared/commStatus";
import { isMailingCompleted } from "../../../shared/bulk-mailing";
import type { BulkParticipantStorage } from "../../storage/bulk/participants";

export type MailCsvMode = "outstanding" | "all";
export type MailingParticipant = Awaited<ReturnType<BulkParticipantStorage["getPostalMailingParticipants"]>>[number];
type ExportComm = Awaited<ReturnType<BulkParticipantStorage["getPostalExportComms"]>>[number];

export function selectOfflineMailing(
  messageId: string, participants: MailingParticipant[], evidence: ExportComm[], mode: MailCsvMode,
) {
  const byContact = new Map<string, ExportComm[]>();
  for (const comm of evidence) {
    const list = byContact.get(comm.contactId) ?? [];
    list.push(comm);
    byContact.set(comm.contactId, list);
  }
  return participants.map(participant => {
    const previous = byContact.get(participant.contactId) ?? [];
    const completed = previous.find(comm => isMailingCompleted(comm.status));
    const completedCommId = isMailingCompleted(participant.commStatus)
      ? participant.commId : completed?.id;
    // A failed key stays spent. Follow deterministic retry keys instead of
    // rewriting failed history or mistaking a conflict for successful mailing.
    const byKey = new Map(previous.map(comm => [comm.sendKey, comm]));
    let sendKey = `bulk-postal-export:${messageId}`;
    let existing = byKey.get(sendKey);
    while (existing && getCommStatusBucket(existing.status) === "error") {
      sendKey = `bulk-postal-export:${messageId}:retry:${existing.id}`;
      existing = byKey.get(sendKey);
    }
    return {
      participant, completedCommId, sendKey: completed?.sendKey ?? sendKey,
      selected: mode === "all" || !completedCommId,
      repairLink: !!completedCommId && (
        participant.commId !== completedCommId ||
        (participant.status !== "see_comm" && participant.status !== "send_failed")
      ),
    };
  });
}
