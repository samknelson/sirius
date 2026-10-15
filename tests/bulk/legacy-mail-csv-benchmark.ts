// Captured orchestration of the pre-batching export, for before/after database
// benchmarks. Uses the actual single-recipient sender and storage methods.
import type { IStorage } from "../../server/storage";
import { createBulkParticipantStorage } from "../../server/storage/bulk/participants";
import { deliverPostal } from "../../server/modules/bulk/deliver-postal";
import { resolveTagIdsForMedium } from "../../server/modules/bulk/deliver";
import { buildMailCsv } from "../../server/modules/bulk/mail-csv";
import { selectActivePostalAddress } from "../../server/modules/bulk/postal-address";
import { composeBulkParticipantEntity, BULK_PARTICIPANT_ROOT_NAME } from "../../server/plugins/tokens/plugins/bulk-participant";

export async function legacyMailCsv(storage: IStorage, messageId: string, userId: string) {
  const bulk = (await storage.bulkMessages.getByIdForUpdate(messageId))!;
  const raw = createBulkParticipantStorage();
  const rows = await raw.getMailingContacts(messageId);
  const output = buildMailCsv(rows);
  const content = Buffer.from(output.csv, "utf8");
  const byContact = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byContact.get(row.contactId) ?? [];
    group.push(row);
    byContact.set(row.contactId, group);
  }
  const participants = await raw.getByMessageId(messageId);
  const tagIds = await resolveTagIdsForMedium(storage, bulk.data, "postal");
  for (const participant of participants) {
    if (participant.medium !== "postal" || participant.commId) continue;
    const contactRows = byContact.get(participant.contactId) ?? [];
    const address = selectActivePostalAddress(contactRows.flatMap(row => row.address ? [row.address] : []));
    const street = address?.street.split(/\r\n|\r|\n/) ?? [];
    const result = await deliverPostal(storage, messageId, participant.contactId, [{
      name: BULK_PARTICIPANT_ROOT_NAME, entity: composeBulkParticipantEntity(participant),
    }], userId, tagIds, true, {
      sendKey: `bulk-postal-export:${messageId}`, fallbackDescription: bulk.name,
      toAddress: { name: contactRows[0]?.name ?? "", addressLine1: street[0] ?? "",
        addressLine2: street.slice(1).join("\n") || undefined, city: address?.city ?? "",
        state: address?.state ?? "", zip: address?.postalCode ?? "", country: address?.country ?? "US" },
    });
    if (!result.commId) throw new Error("Unable to record offline postal communication");
    const linked = await storage.bulkParticipants.update(participant.id, { commId: result.commId, status: "see_comm", message: null });
    if (!linked) throw new Error("Unable to link offline postal communication");
  }
  if (bulk.status !== "sent") await storage.bulkMessages.update(messageId, { status: "sent", sendDate: null });
  return { ...output, content };
}
