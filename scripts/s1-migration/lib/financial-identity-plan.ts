/**
 * Pure S1 financial identity policy. A contact is a participant/payer, NOT a
 * transaction reference. Never infer a worker from destination cardinality.
 */
export interface FinancialEntity {
  entityType: "worker" | "contact" | "employer";
  entityId: string;
  via: "worker" | "contact-worker" | "shell-worker" | "contact" | "employer";
}
export interface IdentityEvidence {
  nid: number;
  sourceWorkers: Array<{ nid: number; contactNids: number[] }>;
  directWorker?: string;
  shell?: string;
  contact?: string;
  employer?: string;
  workerMappings: Array<{ nid: number; id: string | null; retired?: boolean }>;
  destinationWorkers: Array<{ id: string; contactId: string }>;
  contactExists: boolean;
  employerExists: boolean;
  retired: boolean;
}
export type IdentityDecision =
  | { ok: true; entity: FinancialEntity; reason: string }
  | { ok: false; reason: string };

export function planFinancialIdentity(e: IdentityEvidence): IdentityDecision {
  const refuse = (reason: string): IdentityDecision => ({ ok: false, reason });
  if (e.retired) return refuse("retired_mapping");
  if (e.employer) {
    if (e.directWorker || e.shell || e.contact || e.sourceWorkers.length) return refuse("competing_entity_kinds");
    return e.employerExists
      ? { ok: true, entity: { entityType: "employer", entityId: e.employer, via: "employer" }, reason: "employer" }
      : refuse("employer_missing");
  }
  if (e.sourceWorkers.length > 1) return refuse("ambiguous_source_workers");
  const source = e.sourceWorkers[0];
  let workerId = e.directWorker;
  if (source) {
    if (source.contactNids.length !== 1) return refuse("ambiguous_source_contact");
    const mapping = e.workerMappings.find((m) => m.nid === source.nid);
    if (!mapping?.id || mapping.retired) return refuse("source_worker_unmapped");
    if (workerId && workerId !== mapping.id) return refuse("competing_worker_mappings");
    workerId = mapping.id;
  }
  if (workerId && e.shell && workerId !== e.shell) return refuse("competing_shell_mapping");
  workerId ??= e.shell;
  if (workerId) {
    const worker = e.destinationWorkers.find((w) => w.id === workerId);
    if (!worker) return refuse("worker_missing");
    if (source || e.contact) {
      if (!e.contact || !e.contactExists) return refuse("contact_unmapped_or_missing");
      if (worker.contactId !== e.contact) return refuse("worker_contact_disagreement");
      if (e.destinationWorkers.some((w) => w.contactId === e.contact && w.id !== workerId)) {
        return refuse("competing_destination_worker");
      }
    }
    return { ok: true, entity: {
      entityType: "worker", entityId: workerId,
      via: source ? "contact-worker" : e.directWorker ? "worker" : "shell-worker",
    }, reason: source ? "proven_contact_worker" : "mapped_worker" };
  }
  if (e.contact) {
    if (!e.contactExists) return refuse("contact_missing");
    if (e.destinationWorkers.some((w) => w.contactId === e.contact)) return refuse("unproven_destination_worker");
    return { ok: true, entity: { entityType: "contact", entityId: e.contact, via: "contact" }, reason: "standalone_contact" };
  }
  return refuse("unmapped");
}

export function sameFinancialCoordinate(
  expected: Pick<FinancialEntity, "entityType" | "entityId">,
  accountId: string,
  actual?: { entityType: string; entityId: string; accountId: string },
): boolean {
  return !!actual && actual.entityType === expected.entityType &&
    actual.entityId === expected.entityId && actual.accountId === accountId;
}
