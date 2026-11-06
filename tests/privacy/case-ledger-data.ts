/** Fictional identities only. Never import live database records into these fixtures. */
export const cobraFixture = {
  id: "cobra-fixture", coveredPersonWorkerId: "covered-worker", subscriberWorkerId: "subscriber-worker",
  coveredPersonName: "Casey Lancaster", subscriberName: "Morgan Lancaster",
  statusName: "Open", statusClosed: false, qualifyingEventName: "Termination",
  source: "manual", relationship: "Child", paymentStatus: "Unpaid",
};
export const entityFixtures = [
  { id: "worker", entityType: "worker", entityName: "Morgan Lancaster", entityId: "worker-original" },
  { id: "worker-peer", entityType: "worker", entityName: "Morgan Landerson", entityId: "peer-original" },
  { id: "employer", entityType: "employer", entityName: "Fictional Employer", entityId: "employer-original" },
  { id: "provider", entityType: "trust_provider", entityName: "Fictional Provider", entityId: "provider-original" },
  { id: "missing", entityType: "worker", entityName: null, entityId: "missing-original" },
  { id: "empty", entityType: "worker", entityName: "", entityId: "empty-original" },
  { id: "placeholder", entityType: "worker", entityName: "Unknown worker", entityId: "placeholder-original" },
];
export const narrative = "Morgan Lancaster: fictional narrative remains unchanged.";
export const caseFixtures = entityFixtures.map(entity => ({
  ...entity, assigneeName: "Staff", assigneeUserId: "staff", statusId: "open", statusName: "Open",
  statusClosed: false, caseTypeId: "general", caseTypeName: "General case",
  createdAt: "2026-10-01T12:00:00", deadlineYmd: "2026-12-01", workflowStep: null,
  notes: [{ id: "note", subject: narrative, body: narrative, timestamp: "2026-10-01T12:00:00", typeName: "Note" }],
  letters: [], grantedExemptions: null, denialReasonEligibilityPluginIds: [],
}));
export const participantFixtures = entityFixtures.map(entity => ({
  ...entity, eaId: entity.id, totalBalance: 200, entryCount: 1, firstEntryDate: null, lastEntryDate: null,
}));
export const transactionFixtures = entityFixtures.map(entity => ({
  ...entity, amount: "200.00", date: "2026-10-01T12:00:00", statementYmd: "2026-10-01",
  memo: narrative, eaId: entity.id, referenceType: null, referenceId: null, referenceName: null,
  eaAccountId: "account-fixture", eaAccountName: "Fictional Account", chargePlugin: null,
  chargePluginKey: null, chargePluginConfigId: null,
}));
