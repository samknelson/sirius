import type { IStorage } from "../../storage";
import type { BulkParticipant, BulkMessagesPostal } from "@shared/schema/bulk/schema";
import type { PostalAddress } from "../../services/comm/providers/postal";
import type { OfflinePostalRecord } from "../../storage/bulk/offline-postal";
import { createTokenEvalContext, renderTokens } from "../../plugins/tokens";
import { BULK_PARTICIPANT_ROOT_NAME, composeBulkParticipantEntity } from "../../plugins/tokens/plugins/bulk-participant";
import { mediumField, tokenCleanerFor } from "../../delivery/shape";

/** Only the history description is rendered for an address-list export.
 * Catalog-wide vendor merge expansion belongs to actual vendor delivery.
 * Authored postal settings and explicit merge variables remain in history. */
export async function prepareOfflinePostalRecord(
  storage: IStorage, participant: BulkParticipant, name: string, address: PostalAddress,
  content: BulkMessagesPostal | undefined, fallbackDescription: string,
): Promise<OfflinePostalRecord> {
  const description = content?.description || fallbackDescription;
  const ctx = createTokenEvalContext(storage, participant.contactId, { seeds: [{
    name: BULK_PARTICIPANT_ROOT_NAME, entity: composeBulkParticipantEntity(participant),
  }] });
  const renderedDescription = description ? (await renderTokens(description, ctx, {
    strictUnknown: true, clean: tokenCleanerFor(mediumField("postal", "description")) ?? undefined,
  })).output : undefined;
  const hasReturnAddress = !!content?.fromAddressLine1;
  return {
    participantId: participant.id, contactId: participant.contactId, name,
    postal: {
      toName: address.name || null, toCompany: address.company || null,
      toAddressLine1: address.addressLine1, toAddressLine2: address.addressLine2 || null,
      toCity: address.city, toState: address.state, toZip: address.zip, toCountry: address.country,
      fromName: hasReturnAddress ? content?.fromName || null : null,
      fromCompany: hasReturnAddress ? content?.fromCompany || null : null,
      fromAddressLine1: hasReturnAddress ? content?.fromAddressLine1 || null : null,
      fromAddressLine2: hasReturnAddress ? content?.fromAddressLine2 || null : null,
      fromCity: hasReturnAddress ? content?.fromCity || null : null,
      fromState: hasReturnAddress ? content?.fromState || null : null,
      fromZip: hasReturnAddress ? content?.fromZip || null : null,
      fromCountry: hasReturnAddress ? content?.fromCountry || "US" : null,
      description: renderedDescription || null, body: content?.fileUrl || null,
      mailType: content?.mailType === "usps_standard" ? "usps_standard" : "usps_first_class",
      color: content?.color || false, doubleSided: content?.doubleSided || false,
      data: { ...(content?.templateId ? { templateId: content.templateId } : {}),
        mergeVariables: (content?.mergeVariables as Record<string, string>) || {} },
    },
  };
}
