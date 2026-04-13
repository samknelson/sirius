import type { IStorage } from "../../storage";
import { sendPostal, type SendPostalResult } from "../../services/postal-sender";
import type { PostalAddress } from "../../services/providers/postal";
import type { DeliverContactResult } from "./deliver";
import { resolveAndReplace } from "../../services/bulk-tokenization";

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
  userId?: string,
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
  let resolvedDescription = postalContent.description || undefined;
  if (resolvedDescription) {
    resolvedDescription = await resolveAndReplace(storage, contactId, resolvedDescription);
  }

  let resolvedMergeVars = (postalContent.mergeVariables as Record<string, string>) || undefined;
  if (resolvedMergeVars) {
    const resolved: Record<string, string> = {};
    for (const [key, val] of Object.entries(resolvedMergeVars)) {
      resolved[key] = await resolveAndReplace(storage, contactId, val);
    }
    resolvedMergeVars = resolved;
  }

  const result: SendPostalResult = await sendPostal({
    contactId,
    toAddress: addr,
    fromAddress,
    description: resolvedDescription,
    file: postalContent.fileUrl || undefined,
    templateId: postalContent.templateId || undefined,
    mergeVariables: resolvedMergeVars,
    mailType: postalContent.mailType === "usps_standard" ? "usps_standard" : "usps_first_class",
    color: postalContent.color || undefined,
    doubleSided: postalContent.doubleSided || undefined,
    userId,
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
