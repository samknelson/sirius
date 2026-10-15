import { describe, expect, it } from "vitest";
import { planFinancialIdentity, sameFinancialCoordinate, type IdentityEvidence } from "../../scripts/s1-migration/lib/financial-identity-plan";

const proof = (patch: Partial<IdentityEvidence> = {}): IdentityEvidence => ({
  nid: 11, sourceWorkers: [{ nid: 101, contactNids: [11] }],
  contact: "c1", workerMappings: [{ nid: 101, id: "w1" }],
  destinationWorkers: [{ id: "w1", contactId: "c1" }],
  contactExists: true, employerExists: false, retired: false, ...patch,
});
describe("S1 contact-shaped financial identity", () => {
  it("resolves CONTACT NID through the exact SOURCE worker mapping", () => {
    expect(planFinancialIdentity(proof())).toMatchObject({
      ok: true, entity: { entityType: "worker", entityId: "w1", via: "contact-worker" },
    });
  });
  it("never substitutes the one destination worker for a missing source mapping", () => {
    expect(planFinancialIdentity(proof({ workerMappings: [] }))).toEqual({ ok: false, reason: "source_worker_unmapped" });
    expect(planFinancialIdentity(proof({ workerMappings: [{ nid: 999, id: "w1" }] }))).toMatchObject({ ok: false });
  });
  it.each([
    ["ambiguous_source_workers", { sourceWorkers: [{ nid: 101, contactNids: [11] }, { nid: 102, contactNids: [11] }] }],
    ["ambiguous_source_contact", { sourceWorkers: [{ nid: 101, contactNids: [11, 12] }] }],
    ["worker_missing", { workerMappings: [{ nid: 101, id: "vanished" }] }],
    ["source_worker_unmapped", { workerMappings: [{ nid: 101, id: "w1", retired: true }] }],
    ["worker_contact_disagreement", { destinationWorkers: [{ id: "w1", contactId: "c2" }] }],
    ["competing_destination_worker", { destinationWorkers: [{ id: "w1", contactId: "c1" }, { id: "w2", contactId: "c1" }] }],
    ["competing_shell_mapping", { shell: "other" }],
    ["competing_worker_mappings", { directWorker: "other" }],
    ["contact_unmapped_or_missing", { contact: undefined }],
    ["contact_unmapped_or_missing", { contactExists: false }],
    ["retired_mapping", { retired: true }],
    ["competing_entity_kinds", { employer: "e1", employerExists: true }],
  ] as Array<[string, Partial<IdentityEvidence>]>)("refuses %s rather than falling back to a contact", (reason, patch) => {
    expect(planFinancialIdentity(proof(patch))).toEqual({ ok: false, reason });
  });
  it("preserves distinct employer payers and legitimate standalone contacts", () => {
    expect(planFinancialIdentity(proof({
      sourceWorkers: [], contact: undefined, employer: "e1", employerExists: true,
    }))).toMatchObject({ ok: true, entity: { entityType: "employer", entityId: "e1" } });
    expect(planFinancialIdentity(proof({
      sourceWorkers: [], workerMappings: [], destinationWorkers: [],
    }))).toMatchObject({ ok: true, reason: "standalone_contact" });
    expect(planFinancialIdentity(proof({ sourceWorkers: [] }))).toEqual({ ok: false, reason: "unproven_destination_worker" });
  });
  it("keeps valid direct-worker and shell-only mappings without inventing identities", () => {
    expect(planFinancialIdentity(proof({ directWorker: "w1" }))).toMatchObject({ ok: true, entity: { entityId: "w1" } });
    expect(planFinancialIdentity(proof({
      sourceWorkers: [], workerMappings: [], contact: undefined, shell: "w1",
    }))).toMatchObject({ ok: true, entity: { entityType: "worker", entityId: "w1", via: "shell-worker" } });
  });
  it("detects a wrong worker or account even when the fund total is identical", () => {
    const expected = { entityType: "worker" as const, entityId: "w1" };
    expect(sameFinancialCoordinate(expected, "fund", { entityType: "worker", entityId: "w2", accountId: "fund" })).toBe(false);
    expect(sameFinancialCoordinate(expected, "fund", { ...expected, accountId: "other" })).toBe(false);
    expect(sameFinancialCoordinate(expected, "fund", { ...expected, accountId: "fund" })).toBe(true);
  });
});
