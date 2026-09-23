import type { IStorage } from "../../storage";
import { sendPostal, type SendPostalResult } from "../../services/comm/senders/postal";
import type { PostalAddress } from "../../services/comm/providers/postal";
import type { DeliverContactResult } from "./deliver";
import {
  renderTokens,
  createTokenEvalContext,
  evaluateChain,
  buildTokenPickerEntries,
} from "../../plugins/tokens";
import type { TokenRootSeed } from "../../plugins/tokens/types";
import { BULK_POSTAL_MERGE_ROOT_NAMES } from "./token-roots";
import { parseTokenChain } from "@shared/tokens";
import {
  mediumField,
  shapeRenderedValue,
  prepareAuthoredValue,
  tokenCleanerFor,
} from "../../delivery/shape";
import { recordBulkUndeliverable } from "./undeliverable";

// By key, never by position — see `deliver-email.ts`. Bulk postal
// authors a canonical HTML body and an optional description. Legacy
// vendor template/file records remain valid, but are mutually exclusive
// with an authored body.
const BODY_HTML_SPEC = mediumField("postal", "bodyHtml");
const DESCRIPTION_SPEC = mediumField("postal", "description");

export async function resolvePostalAddress(storage: IStorage, contactId: string): Promise<PostalAddress | null> {
  const addresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
  const primary = addresses.find(a => a.isPrimary && a.isActive);
  const active = addresses.find(a => a.isActive);
  const addr = primary || active;
  if (!addr) return null;
  const contact = await storage.contacts.getContact(contactId);
  return {
    name: contact?.displayName || undefined,
    addressLine1: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.postalCode,
    country: addr.country || "US",
  };
}

export async function deliverPostal(
  storage: IStorage,
  messageId: string,
  contactId: string,
  seeds: TokenRootSeed[],
  userId?: string,
  tagIds?: string[],
  offline?: boolean,
): Promise<DeliverContactResult> {
  const postalContent = await storage.bulkMessagesPostal.getByBulkId(messageId);
  if (!postalContent) {
    return { success: false, error: "No postal content configured for this message", errorCode: "NO_CONTENT" };
  }
  const addr = await resolvePostalAddress(storage, contactId);
  if (!addr) {
    return { success: false, error: "Contact has no postal address", errorCode: "NO_ADDRESS" };
  }
  const fromAddress: PostalAddress | undefined = postalContent.fromAddressLine1 ? {
    name: postalContent.fromName || undefined,
    company: postalContent.fromCompany || undefined,
    addressLine1: postalContent.fromAddressLine1,
    addressLine2: postalContent.fromAddressLine2 || undefined,
    city: postalContent.fromCity || "",
    state: postalContent.fromState || "",
    zip: postalContent.fromZip || "",
    country: postalContent.fromCountry || "US",
  } : undefined;
  const ctx = createTokenEvalContext(storage, contactId, { seeds });
  const contentSources = [
    postalContent.bodyHtml?.trim(),
    postalContent.fileUrl?.trim(),
    postalContent.templateId?.trim(),
  ].filter(Boolean);
  if (contentSources.length === 0) {
    return { success: false, error: "No postal letter content configured for this message", errorCode: "NO_CONTENT" };
  }
  if (contentSources.length > 1) {
    return {
      success: false,
      error: "Choose only one postal content source: a composed letter body, a file, or a Lob template.",
      errorCode: "VALIDATION_ERROR",
    };
  }
  const renderedBody = postalContent.bodyHtml
    ? shapeRenderedValue(
        BODY_HTML_SPEC,
        (
          await renderTokens(prepareAuthoredValue(BODY_HTML_SPEC, postalContent.bodyHtml), ctx, {
            strictUnknown: true,
            clean: tokenCleanerFor(BODY_HTML_SPEC) ?? undefined,
          })
        ).output,
      )
    : undefined;
  if (postalContent.bodyHtml && !renderedBody) {
    return recordBulkUndeliverable("postal", messageId, contactId, ["bodyHtml"], tagIds);
  }
  const renderedDescription = postalContent.description
    ? shapeRenderedValue(
        DESCRIPTION_SPEC,
        (
          await renderTokens(postalContent.description, ctx, {
            strictUnknown: true,
            clean: tokenCleanerFor(DESCRIPTION_SPEC) ?? undefined,
          })
        ).output,
      )
    : undefined;
  const baseMerge = (postalContent.mergeVariables as Record<string, string>) || {};
  // Expose the catalog tokens as Lob merge variables, keyed by their
  // canonical chain ids, so a postal template can reference any of them.
  // The roots here are BULK_POSTAL_MERGE_ROOT_NAMES, not the editor's
  // list: a Lob template is authored outside this app, so a key that
  // stops being supplied is a hole in a letter nobody can see coming.
  const tokenMerge: Record<string, string> = {};
  for (const entry of buildTokenPickerEntries(BULK_POSTAL_MERGE_ROOT_NAMES)) {
    const parsed = parseTokenChain(entry.id);
    if (!parsed.ok) continue;
    const result = await evaluateChain(parsed.segments, ctx);
    tokenMerge[entry.id] =
      result.status === "ok" && result.value !== ""
        ? result.value
        : entry.defaultValue;
  }
  const mergedVariables = { ...tokenMerge, ...baseMerge };
  const result: SendPostalResult = await sendPostal({
    contactId,
    toAddress: addr,
    fromAddress,
    description: renderedDescription,
    // sendPostal accepts a composed HTML body through `file`; it applies
    // the shared sanitizer and canonical letter-page wrapper exactly once.
    file: renderedBody || postalContent.fileUrl || undefined,
    templateId: postalContent.templateId || undefined,
    mergeVariables: mergedVariables,
    mailType: postalContent.mailType === "usps_standard" ? "usps_standard" : "usps_first_class",
    color: postalContent.color || undefined,
    doubleSided: postalContent.doubleSided || undefined,
    userId,
    tagIds,
    sendOffline: offline,
  });
  const addrStr = [addr.name, addr.addressLine1, addr.city, addr.state, addr.zip].filter(Boolean).join(", ");
  return {
    success: result.success,
    commId: result.comm?.id,
    comm: result.comm,
    error: result.error,
    errorCode: result.errorCode,
    resolvedAddress: addrStr,
  };
}
