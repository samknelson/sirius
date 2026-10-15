import type { ContactPostal } from "../../../shared/schema";
import type { IStorage } from "../../storage";
import { createBulkParticipantStorage } from "../../storage/bulk/participants";
import { runInTransaction } from "../../storage/transaction-context";
import { selectActivePostalAddress } from "./postal-address";

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

export function buildMailCsv(rows: MailingContactRow[]) {
  const contacts = new Map<string, { name: string; addresses: ContactPostal[] }>();
  for (const row of rows) {
    let contact = contacts.get(row.contactId);
    if (!contact) {
      contact = { name: row.name ?? "", addresses: [] };
      contacts.set(row.contactId, contact);
    }
    if (row.address) contact.addresses.push(row.address);
  }
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
 * are deliberately no provider calls, comm rows, or participant send attempts. */
export async function downloadMailCsv(storage: IStorage, messageId: string) {
  return runInTransaction(async () => {
    const bulk = await storage.bulkMessages.getByIdForUpdate(messageId);
    if (!bulk) throw new MailCsvError(404, "Bulk message not found");
    const data = bulk.data as { offline?: boolean } | null;
    if (data?.offline !== true || !bulk.medium.includes("postal")) {
      throw new MailCsvError(400, "Mail CSV downloads require an offline postal bulk message.");
    }
    const rows = await createBulkParticipantStorage().getMailingContacts(messageId);
    const output = buildMailCsv(rows);
    if (!output.recipientCount) {
      throw new MailCsvError(400, "No postal recipients have been added. Add recipients before downloading.");
    }
    const content = Buffer.from(output.csv, "utf8");
    if (bulk.status !== "sent") {
      const updated = await storage.bulkMessages.update(messageId, { status: "sent", sendDate: null });
      if (!updated) throw new Error("Bulk message completion failed");
    }
    return { ...output, content };
  });
}
