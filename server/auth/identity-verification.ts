import { z } from "zod";
import { storage } from "../storage";
import { parseSSN } from "@shared/utils/ssn";

/**
 * Worker identity verification for self-registration.
 *
 * This module is the ONLY place in the auth path that handles the raw SSN
 * from the request body. It deliberately performs no logging: callers log
 * only the non-sensitive fields of the returned result (worker id, match
 * booleans). Never add a logger call here and never return the SSN.
 */

const verifyWorkerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  ssn: z.string().min(1, "SSN is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
});

export type IdentityVerificationResult =
  | { status: "invalid_input"; errors: string[] }
  | { status: "invalid_ssn" }
  | { status: "no_match" }
  | { status: "no_contact"; workerId: string; contactId: string }
  | {
      status: "field_mismatch";
      workerId: string;
      fnMatch: boolean;
      lnMatch: boolean;
      dobMatch: boolean;
    }
  | {
      status: "verified";
      workerId: string;
      contactId: string;
      workerName: string;
      contactEmail: string;
    };

export async function verifyWorkerIdentity(
  body: unknown
): Promise<IdentityVerificationResult> {
  const validation = verifyWorkerSchema.safeParse(body);
  if (!validation.success) {
    return {
      status: "invalid_input",
      errors: validation.error.errors.map((e) => e.message),
    };
  }

  const { firstName, lastName, ssn, dateOfBirth } = validation.data;

  let normalizedSSN: string;
  try {
    normalizedSSN = parseSSN(ssn);
  } catch {
    return { status: "invalid_ssn" };
  }

  const worker = await storage.workers.getWorkerBySSN(normalizedSSN);
  if (!worker) {
    return { status: "no_match" };
  }

  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) {
    return { status: "no_contact", workerId: worker.id, contactId: worker.contactId };
  }

  const fnMatch =
    (contact.given || "").toLowerCase().trim() === firstName.toLowerCase().trim();
  const lnMatch =
    (contact.family || "").toLowerCase().trim() === lastName.toLowerCase().trim();
  const dobMatch = contact.birthDate === dateOfBirth;

  if (!fnMatch || !lnMatch || !dobMatch) {
    return { status: "field_mismatch", workerId: worker.id, fnMatch, lnMatch, dobMatch };
  }

  return {
    status: "verified",
    workerId: worker.id,
    contactId: worker.contactId,
    workerName: `${contact.given || ""} ${contact.family || ""}`.trim(),
    contactEmail: contact.email || "",
  };
}
