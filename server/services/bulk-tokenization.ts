import type { IStorage } from "../storage/database";
import { BULK_TOKEN_DICTIONARY, getTokenDictionary } from "../../shared/bulk-token-dictionary";

export interface TokenContext {
  contactId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  siriusId?: string | null;
  ssn?: string | null;
  address?: string | null;
  employers?: string | null;
  buildingRep?: string | null;
  bargainingUnit?: string | null;
  cardcheckType?: string | null;
  cardcheckStatus?: string | null;
  cardcheckSignedDate?: string | null;
}

export function getAvailableTokens() {
  return getTokenDictionary();
}

export function replaceTokens(content: string, context: TokenContext): string {
  let result = content;
  for (const tokenDef of BULK_TOKEN_DICTIONARY) {
    const value = context[tokenDef.key as keyof TokenContext] as string | null | undefined;
    result = result.replace(tokenDef.pattern, value || "");
  }
  return result;
}

function maskSSN(ssn: string | null | undefined): string | null {
  if (!ssn) return null;
  const digits = ssn.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `***-**-${digits.slice(-4)}`;
}

function formatAddress(addr: { street: string; city: string; state: string; postalCode: string }): string {
  return `${addr.street}, ${addr.city}, ${addr.state} ${addr.postalCode}`;
}

export async function resolveTokenContext(
  storage: IStorage,
  contactId: string,
): Promise<TokenContext> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact) {
    return { contactId };
  }

  let phone: string | null = null;
  const phones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
  const primary = phones.find(p => p.isPrimary && p.isActive);
  const active = phones.find(p => p.isActive);
  phone = (primary || active)?.phoneNumber || null;

  let address: string | null = null;
  try {
    const addresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
    const primaryAddr = addresses.find(a => a.isPrimary && a.isActive) || addresses.find(a => a.isActive);
    if (primaryAddr) {
      address = formatAddress(primaryAddr);
    }
  } catch {}

  let siriusId: string | null = null;
  let ssn: string | null = null;
  let employerNames: string | null = null;
  let buildingRep: string | null = null;
  let bargainingUnitName: string | null = null;
  let cardcheckType: string | null = null;
  let cardcheckStatus: string | null = null;
  let cardcheckSignedDate: string | null = null;

  try {
    const worker = await storage.workers.getWorkerByContactId(contactId);
    if (worker) {
      siriusId = worker.siriusId != null ? String(worker.siriusId) : null;
      ssn = maskSSN(worker.ssn);

      if (worker.bargainingUnitId) {
        try {
          const bu = await storage.bargainingUnits.getBargainingUnitById(worker.bargainingUnitId);
          bargainingUnitName = bu?.name || null;
        } catch {}
      }

      if (worker.denormEmployerIds && worker.denormEmployerIds.length > 0) {
        try {
          const names: string[] = [];
          for (const empId of worker.denormEmployerIds) {
            if (!empId) continue;
            const emp = await storage.employers.getEmployer(empId);
            if (emp?.name) names.push(emp.name);
          }
          employerNames = names.length > 0 ? names.join(", ") : null;
        } catch {}
      }

      try {
        const assignments = await storage.workerStewardAssignments.getAssignmentsByWorkerId(worker.id);
        if (assignments.length > 0) {
          const parts = assignments.map(a => {
            const empName = a.employer?.name || "";
            const buName = a.bargainingUnit?.name || "";
            return [empName, buName].filter(Boolean).join(" / ");
          });
          buildingRep = `Yes — ${parts.join("; ")}`;
        } else {
          buildingRep = "No";
        }
      } catch {
        buildingRep = null;
      }

      try {
        const cardchecks = await storage.cardchecks.getCardchecksByWorkerId(worker.id);
        if (cardchecks.length > 0) {
          const latest = cardchecks.sort((a, b) => {
            const da = a.signedDate ? new Date(a.signedDate).getTime() : 0;
            const db = b.signedDate ? new Date(b.signedDate).getTime() : 0;
            return db - da;
          })[0];

          cardcheckStatus = latest.status || null;

          if (latest.signedDate) {
            cardcheckSignedDate = new Date(latest.signedDate).toLocaleDateString("en-US");
          }

          if (latest.cardcheckDefinitionId) {
            try {
              const def = await storage.cardcheckDefinitions.getCardcheckDefinitionById(latest.cardcheckDefinitionId);
              cardcheckType = def?.name || null;
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}

  return {
    contactId,
    firstName: contact.given || null,
    lastName: contact.family || null,
    displayName: contact.displayName || null,
    email: contact.email || null,
    phone,
    siriusId,
    ssn,
    address,
    employers: employerNames,
    buildingRep,
    bargainingUnit: bargainingUnitName,
    cardcheckType,
    cardcheckStatus,
    cardcheckSignedDate,
  };
}

export async function resolveAndReplace(
  storage: IStorage,
  contactId: string,
  content: string,
): Promise<string> {
  const context = await resolveTokenContext(storage, contactId);
  return replaceTokens(content, context);
}
