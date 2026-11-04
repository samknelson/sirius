import type { ContactPostal } from "../../../shared/schema";
import type { IStorage } from "../../storage";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { runInTransaction } from "../../storage/transaction-context";
import { selectActivePostalAddress } from "./postal-address";
import { createOfflinePostalExportStorage, type OfflinePostalRecord, type OfflinePostalOutcome } from "../../storage/bulk/offline-postal";
import { prepareOfflinePostalRecord } from "./offline-postal-content";
import { resolveTagIdsForMedium } from "./deliver";
import { selectOfflineMailing, type MailCsvMode } from "./offline-mail-selection";

export class MailCsvError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

const columns = [
  "Full Name", "Address 1", "Address 2", "City", "State", "ZIP",
  "Primary Address", "Deliverability Status",
];

function csvCell(value: string): string {
  // Quote every field and neutralize spreadsheet formulas, including those
  // hidden behind whitespace. ZIP stays a string, never a numeric conversion.
  const safe = /^[\s\uFEFF]*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
    ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export interface MailingContactRow {
  contactId: string;
  name: string | null;
  address: ContactPostal | null;
}

function mailingContacts(rows: MailingContactRow[]) {
  const contacts = new Map<string, { name: string; addresses: ContactPostal[] }>();
  for (const row of rows) {
    let contact = contacts.get(row.contactId);
    if (!contact) {
      contact = { name: row.name ?? "", addresses: [] };
      contacts.set(row.contactId, contact);
    }
    if (row.address) contact.addresses.push(row.address);
  }
  return contacts;
}

export function buildMailCsv(rows: MailingContactRow[]) {
  const contacts = mailingContacts(rows);
  let missingAddressCount = 0;
  let undeliverableCount = 0;
  const records = [columns];
  for (const contact of contacts.values()) {
    const address = selectActivePostalAddress(contact.addresses);
    if (!address) { missingAddressCount++; continue; }
    if (address.deliverabilityStatus === "undeliverable") { undeliverableCount++; continue; }
    const street = address?.street.split(/\r\n|\r|\n/) ?? [];
    records.push([
      contact.name, street[0] ?? "", street.slice(1).join("\n"),
      address?.city ?? "", address?.state ?? "", address?.postalCode ?? "",
      address ? String(address.isPrimary) : "", address?.deliverabilityStatus ?? "",
    ]);
  }
  return {
    csv: "\uFEFF" + records.map(record => record.map(csvCell).join(",")).join("\r\n") + "\r\n",
    recipientCount: records.length - 1,
    missingAddressCount,
    blockedCount: missingAddressCount + undeliverableCount,
  };
}

/** Generate everything before the authorized, audited sent-state write.
 * The parent row lock makes concurrent downloads a single completion. There
 * are no provider calls. Offline comm records and participant links commit
 * atomically with the sent state, including repairs of older sent exports. */
export async function downloadMailCsv(storage: IStorage, messageId: string, userId?: string, mode: MailCsvMode = "outstanding") {
  return runInTransaction(async () => {
    const bulk = await storage.bulkMessages.getByIdForUpdate(messageId);
    if (!bulk) throw new MailCsvError(404, "Bulk message not found");
    const data = bulk.data as { offline?: boolean } | null;
    if (data?.offline !== true || !bulk.medium.includes("postal")) {
      throw new MailCsvError(400, "Mail CSV downloads require an offline postal bulk message.");
    }
    const participantStorage = createBulkParticipantStorage();
    const participants = await participantStorage.getPostalMailingParticipants(messageId);
    const evidence = await participantStorage.getPostalExportComms(messageId);
    const selection = selectOfflineMailing(messageId, participants, evidence, mode);
    const selected = selection.filter(row => row.selected);
    const rows = await participantStorage.getMailingContacts(messageId, selected.map(row => row.participant.contactId));
    const output = buildMailCsv(rows);
    const contacts = mailingContacts(rows);
    const outcomes = new Map<string, OfflinePostalOutcome>();
    const exportStorage = createOfflinePostalExportStorage();
    // Repair lost participant links without exporting already-completed contacts.
    for (const row of selection.filter(row => row.repairLink)) {
      outcomes.set(row.participant.id, {
        participantId: row.participant.id, contactId: row.participant.contactId,
        previousCommId: row.participant.commId, commId: row.completedCommId!,
        status: "see_comm", message: null,
      });
    }
    const pending: typeof selected = [];
    for (const row of selected) {
      const contact = contacts.get(row.participant.contactId);
      if (!contact) throw new Error("Mailing recipient is no longer available");
      const address = selectActivePostalAddress(contact.addresses);
      const error = !address ? "Contact has no active postal address. Add or activate an address before retrying."
        : address.deliverabilityStatus === "undeliverable"
          ? "Postal address is marked undeliverable. Correct the address before retrying." : null;
      if (error) {
        // A historical success remains in history, but this export refusal must
        // be visible as a participant error, not another successful send.
        outcomes.set(row.participant.id, {
          participantId: row.participant.id, contactId: row.participant.contactId,
          previousCommId: row.participant.commId, commId: row.participant.commId,
          status: "send_failed", message: error,
        });
      } else if (!row.completedCommId) {
        pending.push(row);
      } else if (!row.repairLink && (row.participant.status !== "see_comm" || row.participant.message)) {
        outcomes.set(row.participant.id, {
          participantId: row.participant.id, contactId: row.participant.contactId,
          previousCommId: row.participant.commId, commId: row.completedCommId,
          status: "see_comm", message: null,
        });
      }
    }
    if (pending.length) {
      const configuredContent = await storage.bulkMessagesPostal.getByBulkId(messageId);
      const tagIds = await resolveTagIdsForMedium(storage, bulk.data, "postal");
      const records: OfflinePostalRecord[] = [];
      for (const row of pending) {
        const participant = row.participant;
        const contact = contacts.get(participant.contactId);
        if (!contact) throw new Error("Mailing recipient is no longer available");
        const address = selectActivePostalAddress(contact.addresses);
        const street = address?.street.split(/\r\n|\r|\n/) ?? [];
        const record = await prepareOfflinePostalRecord(storage, participant, contact.name, {
          name: contact.name,
          addressLine1: street[0] ?? "",
          addressLine2: street.slice(1).join("\n") || undefined,
          city: address?.city ?? "",
          state: address?.state ?? "",
          zip: address?.postalCode ?? "",
          country: address?.country ?? "US",
        }, configuredContent, bulk.name);
        records.push({ ...record, previousCommId: participant.commId, sendKey: row.sendKey ?? undefined });
      }
      await exportStorage.record(messageId, records, tagIds, userId);
    }
    if (outcomes.size) await exportStorage.applyOutcomes(messageId, [...outcomes.values()], userId);
    if (output.recipientCount && bulk.status !== "sent") {
      const updated = await storage.bulkMessages.update(messageId, { status: "sent", sendDate: null });
      if (!updated) throw new Error("Bulk message completion failed");
    }
    // Return normally so address refusals commit even when there is no CSV.
    return {
      ...output, content: Buffer.from(output.csv, "utf8"), noFile: output.recipientCount === 0,
      message: output.recipientCount ? "Mailing list prepared."
        : output.blockedCount ? `No mailing file was created. ${output.blockedCount} recipient(s) have address errors; correct them and retry.`
          : participants.length ? "No recipients need mailing. Use All recipients to re-download a completed mailing."
            : "No postal recipients have been added. Add recipients before downloading.",
    };
  });
}
