import type { ContactPostal } from "../../../shared/schema";
import type { IStorage } from "../../storage";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { runInTransaction } from "../../storage/transaction-context";
import { selectActivePostalAddress } from "./postal-address";
import { deliverPostal } from "./deliver-postal";
import { resolveTagIdsForMedium } from "./deliver";
import {
  BULK_PARTICIPANT_ROOT_NAME,
  composeBulkParticipantEntity,
} from "../../plugins/tokens/plugins/bulk-participant";

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
  const records = [columns];
  for (const contact of contacts.values()) {
    const address = selectActivePostalAddress(contact.addresses);
    if (!address) missingAddressCount++;
    const street = address?.street.split(/\r\n|\r|\n/) ?? [];
    records.push([
      contact.name, street[0] ?? "", street.slice(1).join("\n"),
      address?.city ?? "", address?.state ?? "", address?.postalCode ?? "",
      address ? String(address.isPrimary) : "", address?.deliverabilityStatus ?? "",
    ]);
  }
  return {
    csv: "\uFEFF" + records.map(record => record.map(csvCell).join(",")).join("\r\n") + "\r\n",
    recipientCount: contacts.size,
    missingAddressCount,
  };
}

/** Generate everything before the authorized, audited sent-state write.
 * The parent row lock makes concurrent downloads a single completion. There
 * are no provider calls. Offline comm records and participant links commit
 * atomically with the sent state, including repairs of older sent exports. */
export async function downloadMailCsv(storage: IStorage, messageId: string, userId?: string) {
  return runInTransaction(async () => {
    const bulk = await storage.bulkMessages.getByIdForUpdate(messageId);
    if (!bulk) throw new MailCsvError(404, "Bulk message not found");
    const data = bulk.data as { offline?: boolean } | null;
    if (data?.offline !== true || !bulk.medium.includes("postal")) {
      throw new MailCsvError(400, "Mail CSV downloads require an offline postal bulk message.");
    }
    const participantStorage = createBulkParticipantStorage();
    const rows = await participantStorage.getMailingContacts(messageId);
    const output = buildMailCsv(rows);
    if (!output.recipientCount) {
      throw new MailCsvError(400, "No postal recipients have been added. Add recipients before downloading.");
    }
    const content = Buffer.from(output.csv, "utf8");
    const contacts = mailingContacts(rows);
    const participants = await participantStorage.getByMessageId(messageId);
    const tagIds = await resolveTagIdsForMedium(storage, bulk.data, "postal");
    for (const participant of participants) {
      if (participant.medium !== "postal" || participant.commId) continue;
      const contact = contacts.get(participant.contactId);
      if (!contact) throw new Error("Mailing recipient is no longer available");
      const address = selectActivePostalAddress(contact.addresses);
      const street = address?.street.split(/\r\n|\r|\n/) ?? [];
      const result = await deliverPostal(storage, messageId, participant.contactId, [{
        name: BULK_PARTICIPANT_ROOT_NAME,
        entity: composeBulkParticipantEntity(participant),
      }], userId, tagIds, true, {
        // Comm uniqueness already includes medium + contact; the message key
        // remains stable even if a recipient is removed and re-added.
        sendKey: `bulk-postal-export:${messageId}`,
        fallbackDescription: bulk.name,
        toAddress: {
          name: contact.name,
          addressLine1: street[0] ?? "",
          addressLine2: street.slice(1).join("\n") || undefined,
          city: address?.city ?? "",
          state: address?.state ?? "",
          zip: address?.postalCode ?? "",
          country: address?.country ?? "US",
        },
      });
      // A spent key can return the original comm even if a prior participant
      // link was lost. Link it rather than creating a duplicate history row.
      if (!result.commId) throw new Error("Unable to record offline postal communication");
      const linked = await storage.bulkParticipants.update(participant.id, {
        commId: result.commId, status: "see_comm", message: null,
      });
      if (!linked) throw new Error("Unable to link offline postal communication");
    }
    if (bulk.status !== "sent") {
      const updated = await storage.bulkMessages.update(messageId, { status: "sent", sendDate: null });
      if (!updated) throw new Error("Bulk message completion failed");
    }
    return { ...output, content };
  });
}
