import type { IStorage } from "../../storage";
import { getClient } from "../../storage/transaction-context";
import { workers, employers, employerContacts } from "../../../shared/schema";
import { eq, inArray } from "drizzle-orm";
import type { TokenContext } from "../../../shared/bulk-tokens";

function splitName(displayName: string | null | undefined, given?: string | null, family?: string | null): { first: string; last: string; full: string } {
  const full = (displayName || `${given || ""} ${family || ""}`.trim() || "").trim();
  if (given || family) {
    return { first: given || "", last: family || "", full };
  }
  if (!full) return { first: "", last: "", full: "" };
  const parts = full.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "", full };
  return { first: parts[0], last: parts.slice(1).join(" "), full };
}

export async function buildRecipientContext(storage: IStorage, contactId: string): Promise<TokenContext> {
  const ctx: TokenContext = {};
  const now = new Date();
  ctx["system.year"] = String(now.getFullYear());
  ctx["system.dateToday"] = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  const contact = await storage.contacts.getContact(contactId);
  if (!contact) return ctx;

  const names = splitName(contact.displayName, contact.given, contact.family);
  ctx["contact.firstName"] = names.first;
  ctx["contact.lastName"] = names.last;
  ctx["contact.fullName"] = names.full;
  ctx["contact.email"] = contact.email || "";

  const db = getClient();
  const workerRows = await db
    .select({
      id: workers.id,
      siriusId: workers.siriusId,
      jobTitle: workers.denormJobTitle,
      homeEmployerId: workers.denormHomeEmployerId,
      employerIds: workers.denormEmployerIds,
    })
    .from(workers)
    .where(eq(workers.contactId, contactId))
    .limit(1);

  if (workerRows.length > 0) {
    const w = workerRows[0];
    ctx["worker.firstName"] = names.first;
    ctx["worker.lastName"] = names.last;
    ctx["worker.fullName"] = names.full;
    ctx["worker.jobTitle"] = w.jobTitle || "";
    ctx["worker.siriusId"] = w.siriusId != null ? String(w.siriusId) : "";

    const employerId = w.homeEmployerId || (w.employerIds && w.employerIds[0]) || null;
    if (employerId) {
      const emp = await db
        .select({ name: employers.name })
        .from(employers)
        .where(eq(employers.id, employerId))
        .limit(1);
      if (emp.length > 0) {
        ctx["employer.name"] = emp[0].name;
      }
    }
  }

  // If we still don't have an employer name, try the contact's
  // employer-contact links so that employer-contact recipients get
  // a populated {{employer.name}}.
  if (!ctx["employer.name"]) {
    const ecRows = await db
      .select({ employerName: employers.name })
      .from(employerContacts)
      .innerJoin(employers, eq(employers.id, employerContacts.employerId))
      .where(eq(employerContacts.contactId, contactId))
      .limit(1);
    if (ecRows.length > 0) {
      ctx["employer.name"] = ecRows[0].employerName;
    }
  }

  return ctx;
}

/**
 * Inspect each contactId and report which token scopes apply to the
 * audience. `contact` and `system` always apply. `worker` applies if
 * any contact is a worker; `employer` applies if any contact resolves
 * to an employer (via worker or employer-contact link).
 */
export async function detectAudienceScopes(contactIds: string[]): Promise<Set<"contact" | "worker" | "employer" | "system">> {
  const scopes = new Set<"contact" | "worker" | "employer" | "system">(["contact", "system"]);
  if (contactIds.length === 0) return scopes;
  const db = getClient();

  const workerRows = await db
    .select({ id: workers.id, homeEmployerId: workers.denormHomeEmployerId, employerIds: workers.denormEmployerIds })
    .from(workers)
    .where(inArray(workers.contactId, contactIds));
  if (workerRows.length > 0) {
    scopes.add("worker");
    if (workerRows.some((w) => w.homeEmployerId || (w.employerIds && w.employerIds.length > 0))) {
      scopes.add("employer");
    }
  }

  if (!scopes.has("employer")) {
    const ecRows = await db
      .select({ id: employerContacts.id })
      .from(employerContacts)
      .where(inArray(employerContacts.contactId, contactIds))
      .limit(1);
    if (ecRows.length > 0) scopes.add("employer");
  }

  return scopes;
}


