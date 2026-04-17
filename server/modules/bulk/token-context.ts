import type { IStorage } from "../../storage";
import { getClient } from "../../storage/transaction-context";
import { workers, employers } from "../../../shared/schema";
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

  return ctx;
}
