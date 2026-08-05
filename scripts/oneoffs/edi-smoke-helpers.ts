/**
 * Shared fixture helpers for the CSV EDI plugin smoke tests (Hinge, MLK,
 * Dentwell, Carelon). Each smoke test creates a small family — subscriber
 * with SSN/email/address/phone, a spouse dependent, and a QMSCO child
 * dependent without an address — against the dev DB under a unique TAG,
 * runs the plugin end-to-end (getPrimaryKeys → processBatch →
 * assembleEdiFileLines), then deletes everything.
 *
 * NOTE: import `server/storage/database` BEFORE these helpers' consumers
 * import any plugin module (boot-order circular-import convention).
 */
import { db } from "../../server/storage/db";
import { eq, inArray } from "drizzle-orm";
import {
  contacts,
  workers,
  employers,
  trustBenefits,
  trustWmb,
  workerRelations,
  optionsWorkerRelationType,
  optionsGender,
  contactPostal,
  phoneNumbers,
} from "@shared/schema";
import type { TrustProviderEdiContext } from "../../server/plugins/trust/provider-edi/registry";
import { storage } from "../../server/storage/database";

export let failures = 0;
export function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failures++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}${extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`,
  );
}

export interface Created {
  contactIds: string[];
  workerIds: string[];
  employerIds: string[];
  benefitIds: string[];
  wmbIds: string[];
  relationIds: string[];
  postalIds: string[];
  phoneIds: string[];
}

export function newCreated(): Created {
  return {
    contactIds: [],
    workerIds: [],
    employerIds: [],
    benefitIds: [],
    wmbIds: [],
    relationIds: [],
    postalIds: [],
    phoneIds: [],
  };
}

export async function genderId(code: "M" | "F"): Promise<string | null> {
  const [g] = await db
    .select()
    .from(optionsGender)
    .where(eq(optionsGender.code, code));
  return g?.id ?? null;
}

export async function relationTypeId(tag: string, siriusId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(optionsWorkerRelationType)
    .where(eq(optionsWorkerRelationType.siriusId, siriusId));
  if (existing) return existing.id;
  const [row] = await db
    .insert(optionsWorkerRelationType)
    .values({ siriusId, name: `${tag} ${siriusId}` })
    .returning();
  return row.id;
}

export interface PersonSpec {
  given: string;
  family: string;
  middle?: string;
  ssn?: string;
  email?: string;
  birthDate?: string;
  gender?: "M" | "F";
  address?: { street: string; city: string; state: string; postalCode: string };
  phone?: string;
}

export async function makePerson(
  created: Created,
  spec: PersonSpec,
): Promise<{ workerId: string; contactId: string; siriusId: number }> {
  const [c] = await db
    .insert(contacts)
    .values({
      given: spec.given,
      family: spec.family,
      middle: spec.middle,
      displayName: `${spec.given} ${spec.family}`,
      email: spec.email,
      birthDate: spec.birthDate,
      gender: spec.gender ? await genderId(spec.gender) : null,
    })
    .returning();
  created.contactIds.push(c.id);
  const [w] = await db
    .insert(workers)
    .values({ contactId: c.id, ssn: spec.ssn })
    .returning();
  created.workerIds.push(w.id);
  if (spec.address) {
    const [p] = await db
      .insert(contactPostal)
      .values({
        contactId: c.id,
        ...spec.address,
        country: "US",
        isPrimary: true,
        isActive: true,
      })
      .returning();
    created.postalIds.push(p.id);
  }
  if (spec.phone) {
    const [p] = await db
      .insert(phoneNumbers)
      .values({
        contactId: c.id,
        phoneNumber: spec.phone,
        isPrimary: true,
        isActive: true,
      })
      .returning();
    created.phoneIds.push(p.id);
  }
  return { workerId: w.id, contactId: c.id, siriusId: w.siriusId };
}

export async function makeEmployer(created: Created, tag: string) {
  const [emp] = await db
    .insert(employers)
    .values({ siriusId: `${tag}-EMP`, name: `${tag} Employer` })
    .returning();
  created.employerIds.push(emp.id);
  return emp;
}

export async function makeBenefit(
  created: Created,
  siriusId: string,
  name: string,
  benefitType?: string | null,
) {
  const [b] = await db
    .insert(trustBenefits)
    .values({ siriusId, name, benefitType: benefitType ?? null })
    .returning();
  created.benefitIds.push(b.id);
  return b;
}

export async function makeWmb(
  created: Created,
  args: {
    workerId: string;
    employerId: string;
    benefitId: string;
    year: number;
    month: number;
    sourceRelationId?: string | null;
  },
) {
  const [row] = await db
    .insert(trustWmb)
    .values({ ...args, sourceRelationId: args.sourceRelationId ?? null })
    .returning();
  created.wmbIds.push(row.id);
  return row;
}

export async function makeRelation(
  created: Created,
  worker1: string,
  worker2: string,
  relationType: string,
) {
  const [rel] = await db
    .insert(workerRelations)
    .values({ worker1, worker2, relationType, startYmd: "2020-01-01" })
    .returning();
  created.relationIds.push(rel.id);
  return rel;
}

export function makeCtx(
  configData: Record<string, unknown>,
  asOfDate: string,
): TrustProviderEdiContext {
  return {
    configId: "smoke",
    configData,
    providerId: null,
    sftpClientId: null,
    input: { asOfDate },
    storage,
  };
}

export async function cleanup(created: Created) {
  if (created.wmbIds.length)
    await db.delete(trustWmb).where(inArray(trustWmb.id, created.wmbIds));
  if (created.relationIds.length)
    await db
      .delete(workerRelations)
      .where(inArray(workerRelations.id, created.relationIds));
  if (created.phoneIds.length)
    await db
      .delete(phoneNumbers)
      .where(inArray(phoneNumbers.id, created.phoneIds));
  if (created.postalIds.length)
    await db
      .delete(contactPostal)
      .where(inArray(contactPostal.id, created.postalIds));
  if (created.workerIds.length)
    await db.delete(workers).where(inArray(workers.id, created.workerIds));
  if (created.contactIds.length)
    await db.delete(contacts).where(inArray(contacts.id, created.contactIds));
  if (created.benefitIds.length)
    await db
      .delete(trustBenefits)
      .where(inArray(trustBenefits.id, created.benefitIds));
  if (created.employerIds.length)
    await db.delete(employers).where(inArray(employers.id, created.employerIds));
}

export function finish() {
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}
