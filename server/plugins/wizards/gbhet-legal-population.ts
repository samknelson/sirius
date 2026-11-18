import { storage } from "../../storage";
import { resolveTaxIdentity, findTaxIdentityConflicts } from "../../storage/workers/tax-identity";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { LegalPopulation } from "@shared/legal-payment";
import { legalBenefitMonth } from "./gbhet-legal-forecast";
import type { Wizard } from "@shared/schema";

const text = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const phone = (v: unknown) => {
  const value = String(v ?? "").trim();
  return parsePhoneNumberFromString(value, "US")?.number ?? value.replace(/\D/g, "");
};
const address = (v: unknown) => text(v).replace(/[.,#]/g, "");
export function suppliedDifference(supplied: unknown, saved: unknown, normalize = text) {
  return text(supplied) !== "" && normalize(supplied) !== normalize(saved);
}

/** Run-local only. Never persist raw identities, contact values, or lookup keys.
 * Use the importer's resolver/conflict rules, then actual execution observations.
 * An unmatched key is NOT a created worker and is never counted as one. */
export async function measureLegalPopulation(wizard: Wizard, rows: Record<string, any>[]) {
  const data = wizard.data as any;
  const conflicts = await findTaxIdentityConflicts(storage, rows);
  const rowWorkers = new Map<number, string>();
  const rowsByWorker = new Map<string, Record<string, any>[]>();
  const contacts = new Map<string, string>();
  for (const [index, row] of rows.entries()) {
    if (conflicts.has(index)) continue;
    const { worker } = await resolveTaxIdentity(storage, row.ssn);
    if (!worker) continue;
    rowWorkers.set(index, worker.id);
    contacts.set(worker.id, worker.contactId);
    const grouped = rowsByWorker.get(worker.id) ?? [];
    grouped.push(row);
    rowsByWorker.set(worker.id, grouped);
  }
  const changes = { email: new Set<string>(), phone: new Set<string>(), address: new Set<string>() };
  const beforeGrants = new Set<string>();
  const period = legalBenefitMonth(Number(data.launchArguments.year), Number(data.launchArguments.month));
  const benefits = [...new Set<string>(data.benefitConfig.map((b: any) => b.benefitId))];
  for (const [workerId, workerRows] of rowsByWorker) {
    const contactId = contacts.get(workerId)!;
    const [contact, phones, addresses] = await Promise.all([
      storage.contacts.getContact(contactId),
      storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId),
      storage.contacts.addresses.getContactPostalByContact(contactId),
    ]);
    if (!contact) throw new Error("Saved contact information could not be measured.");
    const savedPhone = phones.find(p => p.isPrimary) ?? phones[0];
    const savedAddress = addresses.find(a => a.isPrimary && a.isActive);
    for (const row of workerRows) {
      if (suppliedDifference(row.email, contact.email)) changes.email.add(workerId);
      if (suppliedDifference(row.phoneNumber, savedPhone?.phoneNumber, phone)) changes.phone.add(workerId);
      const fields = [
        ["addressLine1", "street"], ["addressLine2", "street2"],
        ["city", "city"], ["state", "state"], ["postalCode", "postalCode"],
      ];
      if (fields.some(([incoming, saved]) => suppliedDifference(row[incoming], (savedAddress as any)?.[saved], address))) changes.address.add(workerId);
    }
    for (const benefitId of benefits) {
      if (await storage.trust.wmb.workerBenefitExists(workerId, benefitId, period.month, period.year)) beforeGrants.add(`${workerId}:${benefitId}`);
    }
  }
  return {
    async finish(successRows: Set<number>, actualWorkers: Map<number, string>, contactFailures: Set<string>,
      benefitFailures: Set<string>, createdWorkers: Set<string>): Promise<LegalPopulation> {
      // Do not infer outcome membership by looking up identifiers after mutation.
      // Include known failed workers in the represented population, not benefit
      // negatives. Only successful row observations establish confirmed workers.
      const represented = new Map(rowWorkers);
      for (const [index, id] of actualWorkers) if (!conflicts.has(index)) represented.set(index, id);
      const distinct = new Set(represented.values());
      const confirmed = new Set([...successRows].flatMap(index => {
        const id = actualWorkers.get(index);
        return id && !conflicts.has(index) ? [id] : [];
      }));
      const withAny = new Set<string>(), withoutAny = new Set<string>(), readFailed = new Set<string>();
      const benefitCounts: LegalPopulation["benefits"] = [];
      let existingGrants = 0;
      for (const benefitId of benefits) {
        let withBenefit = 0, withoutBenefit = 0, unresolvedWorkers = 0;
        for (const workerId of confirmed) {
          try {
            const exists = await storage.trust.wmb.workerBenefitExists(workerId, benefitId, period.month, period.year);
            if (exists) {
              withBenefit++; withAny.add(workerId);
              if (beforeGrants.has(`${workerId}:${benefitId}`)) existingGrants++;
            } else if (benefitFailures.has(workerId)) {
              unresolvedWorkers++; readFailed.add(workerId);
            } else { withoutBenefit++; withoutAny.add(workerId); }
          } catch { unresolvedWorkers++; readFailed.add(workerId); }
        }
        benefitCounts.push({ benefitId, ...period, withBenefit, withoutBenefit, unresolvedWorkers });
      }
      // A concurrent claim can create a worker after our baseline. Initial
      // contact values for workers actually created by THIS run are not changes.
      const changed = (set: Set<string>) => new Set([...set].filter(id => !createdWorkers.has(id)));
      const email = changed(changes.email), phones = changed(changes.phone), addresses = changed(changes.address);
      const changedWorkers = new Set([...email, ...phones, ...addresses]);
      return {
        totalRows: rows.length, distinctWorkers: distinct.size,
        unresolvedRows: rows.length - successRows.size,
        unresolvedIdentityRows: rows.length - represented.size,
        unconfirmedWorkers: [...distinct].filter(id => !confirmed.has(id)).length,
        confirmedWorkers: confirmed.size,
        workersWithBenefits: withAny.size,
        workersWithoutBenefits: [...withoutAny].filter(id => !withAny.has(id) && !readFailed.has(id)).length,
        benefitReadFailures: readFailed.size, existingGrants,
        contactDifferences: {
          workers: changedWorkers.size, email: email.size, phone: phones.size, address: addresses.size,
          failedWorkers: [...changedWorkers].filter(id => contactFailures.has(id)).length,
          unconfirmedWorkers: [...changedWorkers].filter(id => !confirmed.has(id) && !contactFailures.has(id)).length,
        },
        benefits: benefitCounts,
      };
    },
  };
}
