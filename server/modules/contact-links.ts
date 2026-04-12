import { getClient } from "../storage/transaction-context";
import { workers, employers, employerContacts, trustProviders, trustProviderContacts, contacts } from "../../shared/schema";
import { eq, inArray, asc } from "drizzle-orm";

export interface ContactLink {
  type: "worker" | "employer_contact" | "trust_provider_contact";
  url: string;
  label: string;
  entityName: string;
}

export interface ContactLinksResult {
  contactId: string;
  links: ContactLink[];
  mainLink: ContactLink | null;
}

export async function resolveContactLinks(contactId: string): Promise<ContactLinksResult> {
  const db = getClient();
  const links: ContactLink[] = [];

  const workerRows = await db
    .select({
      id: workers.id,
      contactId: workers.contactId,
    })
    .from(workers)
    .where(eq(workers.contactId, contactId));

  for (const w of workerRows) {
    const contact = await db
      .select({ displayName: contacts.displayName })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    links.push({
      type: "worker",
      url: `/workers/${w.id}`,
      label: `Worker: ${contact[0]?.displayName || "Unknown"}`,
      entityName: contact[0]?.displayName || "",
    });
  }

  const ecRows = await db
    .select({
      id: employerContacts.id,
      employerId: employerContacts.employerId,
      employerName: employers.name,
    })
    .from(employerContacts)
    .innerJoin(employers, eq(employers.id, employerContacts.employerId))
    .where(eq(employerContacts.contactId, contactId))
    .orderBy(asc(employers.name));

  for (const ec of ecRows) {
    links.push({
      type: "employer_contact",
      url: `/employer-contacts/${ec.id}`,
      label: `Employer: ${ec.employerName}`,
      entityName: ec.employerName,
    });
  }

  const tpcRows = await db
    .select({
      id: trustProviderContacts.id,
      providerId: trustProviderContacts.providerId,
      providerName: trustProviders.name,
    })
    .from(trustProviderContacts)
    .innerJoin(trustProviders, eq(trustProviders.id, trustProviderContacts.providerId))
    .where(eq(trustProviderContacts.contactId, contactId))
    .orderBy(asc(trustProviders.name));

  for (const tpc of tpcRows) {
    links.push({
      type: "trust_provider_contact",
      url: `/trust-provider-contacts/${tpc.id}`,
      label: `Provider: ${tpc.providerName}`,
      entityName: tpc.providerName,
    });
  }

  const mainLink = pickMainLink(links);

  return { contactId, links, mainLink };
}

function pickMainLink(links: ContactLink[]): ContactLink | null {
  if (links.length === 0) return null;
  const byType = (t: ContactLink["type"]) => links.filter(l => l.type === t);
  const workerLinks = byType("worker");
  if (workerLinks.length > 0) return workerLinks[0];
  const providerLinks = byType("trust_provider_contact");
  if (providerLinks.length > 0) return providerLinks[0];
  const employerLinks = byType("employer_contact");
  if (employerLinks.length > 0) return employerLinks[0];
  return links[0];
}

export async function resolveContactLinksForMany(contactIds: string[]): Promise<Map<string, ContactLinksResult>> {
  if (contactIds.length === 0) return new Map();

  const db = getClient();
  const resultMap = new Map<string, ContactLinksResult>();

  for (const cid of contactIds) {
    resultMap.set(cid, { contactId: cid, links: [], mainLink: null });
  }

  const contactNames = await db
    .select({ id: contacts.id, displayName: contacts.displayName })
    .from(contacts)
    .where(inArray(contacts.id, contactIds));
  const nameMap = new Map(contactNames.map(c => [c.id, c.displayName]));

  const workerRows = await db
    .select({ id: workers.id, contactId: workers.contactId })
    .from(workers)
    .where(inArray(workers.contactId, contactIds));

  for (const w of workerRows) {
    const entry = resultMap.get(w.contactId)!;
    entry.links.push({
      type: "worker",
      url: `/workers/${w.id}`,
      label: `Worker: ${nameMap.get(w.contactId) || "Unknown"}`,
      entityName: nameMap.get(w.contactId) || "",
    });
  }

  const ecRows = await db
    .select({
      id: employerContacts.id,
      contactId: employerContacts.contactId,
      employerName: employers.name,
    })
    .from(employerContacts)
    .innerJoin(employers, eq(employers.id, employerContacts.employerId))
    .where(inArray(employerContacts.contactId, contactIds))
    .orderBy(asc(employers.name));

  for (const ec of ecRows) {
    const entry = resultMap.get(ec.contactId)!;
    entry.links.push({
      type: "employer_contact",
      url: `/employer-contacts/${ec.id}`,
      label: `Employer: ${ec.employerName}`,
      entityName: ec.employerName,
    });
  }

  const tpcRows = await db
    .select({
      id: trustProviderContacts.id,
      contactId: trustProviderContacts.contactId,
      providerName: trustProviders.name,
    })
    .from(trustProviderContacts)
    .innerJoin(trustProviders, eq(trustProviders.id, trustProviderContacts.providerId))
    .where(inArray(trustProviderContacts.contactId, contactIds))
    .orderBy(asc(trustProviders.name));

  for (const tpc of tpcRows) {
    const entry = resultMap.get(tpc.contactId)!;
    entry.links.push({
      type: "trust_provider_contact",
      url: `/trust-provider-contacts/${tpc.id}`,
      label: `Provider: ${tpc.providerName}`,
      entityName: tpc.providerName,
    });
  }

  for (const entry of resultMap.values()) {
    entry.mainLink = pickMainLink(entry.links);
  }

  return resultMap;
}
