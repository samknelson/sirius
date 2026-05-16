import { storage } from "../storage";

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
  const map = await resolveContactLinksForMany([contactId]);
  return map.get(contactId) ?? { contactId, links: [], mainLink: null };
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

  const resultMap = new Map<string, ContactLinksResult>();
  for (const cid of contactIds) {
    resultMap.set(cid, { contactId: cid, links: [], mainLink: null });
  }

  const [contactNames, workerRows, ecRows, tpcRows] = await Promise.all([
    storage.contactLinks.getContactNames(contactIds),
    storage.contactLinks.getWorkersByContactIds(contactIds),
    storage.contactLinks.getEmployerContactsByContactIds(contactIds),
    storage.contactLinks.getTrustProviderContactsByContactIds(contactIds),
  ]);

  const nameMap = new Map(contactNames.map(c => [c.id, c.displayName]));

  for (const w of workerRows) {
    const entry = resultMap.get(w.contactId)!;
    entry.links.push({
      type: "worker",
      url: `/workers/${w.id}`,
      label: `Worker: ${nameMap.get(w.contactId) || "Unknown"}`,
      entityName: nameMap.get(w.contactId) || "",
    });
  }

  for (const ec of ecRows) {
    const entry = resultMap.get(ec.contactId)!;
    entry.links.push({
      type: "employer_contact",
      url: `/employer-contacts/${ec.id}`,
      label: `Employer: ${ec.employerName}`,
      entityName: ec.employerName,
    });
  }

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
