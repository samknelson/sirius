/**
 * BAO COBRA auto-case service.
 *
 * Opens COBRA cases automatically when coverage ends for a qualifying
 * reason, and closes stale un-elected cases when coverage comes back.
 *
 * Three listeners:
 *
 * 1. TRUST_WMB_SCAN_WORKER_COMPLETED — when a benefit-continuation scan
 *    terminates (deletes) a medical/dental WMB row, and the failure
 *    reasons qualify per the COBRA trigger config (failure-to-pay-premium
 *    plugins are excluded by default), a case is opened for each covered
 *    person losing coverage: the subscriber and every dependent on their
 *    active election.
 *
 * 2. TRUST_ELECTION_SAVED — when a life-event enrollment (divorce/death)
 *    posts an election that removes dependents, a case is opened for each
 *    removed dependent who no longer has active medical/dental coverage.
 *
 * 3. WMB_SAVED — mutual exclusivity: when a person regains active
 *    medical/dental benefits, any active, un-elected COBRA case for them
 *    is closed automatically.
 *
 * All creates go through storage.baoCobraCases.createEnforcingInvariants;
 * ACTIVE_CASE_EXISTS / ACTIVE_BENEFITS_EXIST are treated as idempotent
 * skips, so event replays and rescans never create duplicates.
 */

import {
  eventBus,
  EventType,
  type TrustWmbScanWorkerCompletedPayload,
  type TrustElectionSavedPayload,
  type WmbSavedPayload,
} from "./event-bus";
import { storage } from "../storage";
import { logger } from "../logger";
import { isComponentEnabledSync, isCacheInitialized } from "./component-cache";
import { createUnifiedOptionsStorage } from "../storage/unified-options";
import { computeCobraDeadlines } from "../../shared/schema/sitespecific/bao/cobra";
import type { InsertBaoCobraCase, BaoCobraCaseSource } from "@shared/schema";
import {
  BAO_COBRA_TRIGGER_CONFIG_VARIABLE,
  baoCobraTriggerConfigSchema,
  resolveTriggerForPlugin,
  type BaoCobraTriggerConfig,
} from "../../shared/schema/sitespecific/bao/cobra-triggers";
import { eligibilityPluginRegistry } from "../plugins/trust/eligibility/registry";

const SERVICE_NAME = "bao-cobra-auto-case";
const COMPONENT_ID = "sitespecific.bao";

const handlerIds: string[] = [];

function componentActive(): boolean {
  return isCacheInitialized() && isComponentEnabledSync(COMPONENT_ID);
}

const unifiedOptions = createUnifiedOptionsStorage();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function loadTriggerConfig(): Promise<BaoCobraTriggerConfig | null> {
  const variable = await storage.variables.getByName(BAO_COBRA_TRIGGER_CONFIG_VARIABLE);
  if (!variable) return null;
  const parsed = baoCobraTriggerConfigSchema.safeParse(variable.value);
  if (!parsed.success) {
    logger.warn("Invalid COBRA trigger config variable; using defaults", {
      service: SERVICE_NAME,
    });
    return null;
  }
  return parsed.data;
}

interface StatusPair {
  openStatusId: string | null;
  closedStatusId: string | null;
}

/** First non-closed status = default open; first closed status = auto-close target. */
async function resolveStatuses(): Promise<StatusPair> {
  const statuses: Array<{ id: string; closed: boolean }> = await unifiedOptions.list(
    "bao-cobra-status",
  );
  const openStatusId = statuses.find((s) => !s.closed)?.id ?? null;
  const closedStatusId = statuses.find((s) => s.closed)?.id ?? null;
  return { openStatusId, closedStatusId };
}

/** Best-effort qualifying-event lookup by name substring (e.g. "divorce"). */
async function findQualifyingEventByName(needle: string): Promise<string | null> {
  const events: Array<{ id: string; name: string }> = await unifiedOptions.list(
    "bao-cobra-qualifying-event",
  );
  const lower = needle.toLowerCase();
  return events.find((e) => e.name?.toLowerCase().includes(lower))?.id ?? null;
}

interface AutoCaseInput {
  source: BaoCobraCaseSource;
  coveredPersonWorkerId: string;
  subscriberWorkerId: string;
  relationship: string | null;
  cobraEffectiveYmd: string;
  qualifyingEventId: string | null;
  medicalBenefitLostId: string | null;
  dentalBenefitLostId: string | null;
  statusId: string;
  provenance: Record<string, unknown>;
}

/** Create a case, treating invariant violations as idempotent skips. */
async function createCaseIdempotent(input: AutoCaseInput): Promise<void> {
  const deadlines = computeCobraDeadlines(input.source, input.cobraEffectiveYmd, null);
  const entry: InsertBaoCobraCase = {
    source: input.source,
    statusId: input.statusId,
    qualifyingEventId: input.qualifyingEventId,
    coveredPersonWorkerId: input.coveredPersonWorkerId,
    subscriberWorkerId: input.subscriberWorkerId,
    relationship: input.relationship,
    cobraEffectiveYmd: input.cobraEffectiveYmd,
    offerYmd: deadlines.offerYmd,
    lastDayToElectYmd: deadlines.lastDayToElectYmd,
    electionMadeYmd: null,
    initialPaymentDeadlineYmd: deadlines.initialPaymentDeadlineYmd,
    paymentStatus: null,
    medicalBenefitLostId: input.medicalBenefitLostId,
    dentalBenefitLostId: input.dentalBenefitLostId,
    maxPeriodYmd: deadlines.maxPeriodYmd,
    data: { auto: true, ...input.provenance },
  };
  try {
    const created = await storage.baoCobraCases.createEnforcingInvariants(entry, false);
    logger.info("Auto-created COBRA case", {
      service: SERVICE_NAME,
      caseId: created.id,
      source: input.source,
      coveredPersonWorkerId: input.coveredPersonWorkerId,
      subscriberWorkerId: input.subscriberWorkerId,
      cobraEffectiveYmd: input.cobraEffectiveYmd,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "ACTIVE_CASE_EXISTS" || msg === "ACTIVE_BENEFITS_EXIST") {
      logger.info("Skipped auto COBRA case (invariant)", {
        service: SERVICE_NAME,
        reason: msg,
        source: input.source,
        coveredPersonWorkerId: input.coveredPersonWorkerId,
      });
      return;
    }
    throw err;
  }
}

/** relationId → { dependent workerId, relation type label } for a subscriber. */
async function mapRelationsToDependents(
  subscriberWorkerId: string,
  relationIds: string[],
): Promise<Array<{ relationId: string; workerId: string; relationship: string | null }>> {
  if (relationIds.length === 0) return [];
  const wanted = new Set(relationIds);
  const relations = await storage.workerRelations.searchWorkerRelations({
    workerId: subscriberWorkerId,
  });
  const out: Array<{ relationId: string; workerId: string; relationship: string | null }> = [];
  for (const rel of relations) {
    if (!wanted.has(rel.id)) continue;
    if (!rel.otherWorker?.id) continue;
    out.push({
      relationId: rel.id,
      workerId: rel.otherWorker.id,
      relationship: rel.relationTypeName ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. WMB terminate listener
// ---------------------------------------------------------------------------

async function handleWmbScanWorkerCompleted(
  payload: TrustWmbScanWorkerCompletedPayload,
): Promise<void> {
  if (!componentActive()) return;

  // Terminations executed by the "continue" scan (benefit rows deleted).
  const terminations = payload.actions.filter(
    (a) => a.scanType === "continue" && a.action === "delete" && a.executed !== false,
  );
  if (terminations.length === 0) return;

  const config = await loadTriggerConfig();

  for (const action of terminations) {
    try {
      const kind = await storage.baoCobraCases.classifyMedicalDentalBenefit(action.benefitId);
      if (!kind) continue; // COBRA only applies to medical/dental coverage.

      // Failed plugins are the termination reasons. Qualification: at least
      // one failed plugin is configured (or defaults) to trigger COBRA.
      const failed = action.pluginResults.filter((r) => !r.eligible);
      const triggering = failed.filter((r) => {
        const name = eligibilityPluginRegistry.get(r.pluginKey)?.metadata.name;
        return resolveTriggerForPlugin(config, r.pluginKey, name).trigger;
      });
      if (triggering.length === 0) {
        logger.info("WMB termination did not qualify for COBRA", {
          service: SERVICE_NAME,
          workerId: payload.workerId,
          benefitId: action.benefitId,
          failedPlugins: failed.map((r) => r.pluginKey),
        });
        continue;
      }

      const { openStatusId } = await resolveStatuses();
      if (!openStatusId) {
        logger.warn("No open COBRA status configured; cannot auto-create case", {
          service: SERVICE_NAME,
        });
        return;
      }

      // Qualifying event: the first triggering plugin with a mapped event.
      let qualifyingEventId: string | null = null;
      for (const r of triggering) {
        const name = eligibilityPluginRegistry.get(r.pluginKey)?.metadata.name;
        const resolved = resolveTriggerForPlugin(config, r.pluginKey, name);
        if (resolved.qualifyingEventId) {
          qualifyingEventId = resolved.qualifyingEventId;
          break;
        }
      }

      const cobraEffectiveYmd = `${payload.year}-${String(payload.month).padStart(2, "0")}-01`;
      const provenance = {
        trigger: "wmb_scan",
        benefitId: action.benefitId,
        benefitName: action.benefitName,
        month: payload.month,
        year: payload.year,
        failedPlugins: failed.map((r) => ({ pluginKey: r.pluginKey, reason: r.reason ?? null })),
      };

      // Subscriber's own case.
      await createCaseIdempotent({
        source: "wmb_event",
        coveredPersonWorkerId: payload.workerId,
        subscriberWorkerId: payload.workerId,
        relationship: "self",
        cobraEffectiveYmd,
        qualifyingEventId,
        medicalBenefitLostId: kind === "medical" ? action.benefitId : null,
        dentalBenefitLostId: kind === "dental" ? action.benefitId : null,
        statusId: openStatusId,
        provenance,
      });

      // One case per covered dependent on the election that was active when
      // coverage ended — as of the last day before the termination month, so
      // replays/backfills target the dependents actually covered at the time.
      const effectiveDate = new Date(Date.UTC(payload.year, payload.month - 1, 1));
      effectiveDate.setUTCDate(0); // last day of the previous month
      const asOfYmd = effectiveDate.toISOString().slice(0, 10);
      const election = await storage.workerTrustElections.getActiveByWorkerAsOf(
        payload.workerId,
        asOfYmd,
      );
      const relationIds = election?.relationshipIds ?? [];
      const dependents = await mapRelationsToDependents(payload.workerId, relationIds);
      for (const dep of dependents) {
        await createCaseIdempotent({
          source: "wmb_event",
          coveredPersonWorkerId: dep.workerId,
          subscriberWorkerId: payload.workerId,
          relationship: dep.relationship,
          cobraEffectiveYmd,
          qualifyingEventId,
          medicalBenefitLostId: kind === "medical" ? action.benefitId : null,
          dentalBenefitLostId: kind === "dental" ? action.benefitId : null,
          statusId: openStatusId,
          provenance: { ...provenance, relationId: dep.relationId },
        });
      }
    } catch (err) {
      logger.error("COBRA auto-case from WMB termination failed", {
        service: SERVICE_NAME,
        workerId: payload.workerId,
        benefitId: action.benefitId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Life-event election listener
// ---------------------------------------------------------------------------

const QUALIFYING_LIFE_EVENTS = new Set(["divorce", "death"]);

async function handleElectionSaved(payload: TrustElectionSavedPayload): Promise<void> {
  if (!componentActive()) return;
  if (payload.operation !== "created" || payload.enrollmentType !== "life_event") return;

  try {
    const election = await storage.workerTrustElections.getById(payload.electionId);
    if (!election) return;
    const data = (election.data ?? {}) as Record<string, unknown>;
    const eventType = typeof data.eventType === "string" ? data.eventType : null;
    if (!eventType || !QUALIFYING_LIFE_EVENTS.has(eventType)) return;

    const sourceElectionId =
      typeof data.sourceElectionId === "string" ? data.sourceElectionId : null;
    if (!sourceElectionId) return;
    const sourceElection = await storage.workerTrustElections.getById(sourceElectionId);
    if (!sourceElection) return;

    const newIds = new Set(election.relationshipIds ?? []);
    const removedRelationIds = (sourceElection.relationshipIds ?? []).filter(
      (id) => !newIds.has(id),
    );
    if (removedRelationIds.length === 0) return;

    const { openStatusId } = await resolveStatuses();
    if (!openStatusId) {
      logger.warn("No open COBRA status configured; cannot auto-create case", {
        service: SERVICE_NAME,
      });
      return;
    }
    const qualifyingEventId = await findQualifyingEventByName(eventType);

    // Medical/dental benefits the dependents were covered under.
    let medicalBenefitLostId: string | null = null;
    let dentalBenefitLostId: string | null = null;
    for (const benefitId of sourceElection.benefitIds ?? []) {
      const kind = await storage.baoCobraCases.classifyMedicalDentalBenefit(benefitId);
      if (kind === "medical" && !medicalBenefitLostId) medicalBenefitLostId = benefitId;
      if (kind === "dental" && !dentalBenefitLostId) dentalBenefitLostId = benefitId;
    }
    if (!medicalBenefitLostId && !dentalBenefitLostId) return; // no med/dental coverage lost

    const dependents = await mapRelationsToDependents(
      payload.workerId,
      removedRelationIds,
    );
    for (const dep of dependents) {
      await createCaseIdempotent({
        source: "life_event",
        coveredPersonWorkerId: dep.workerId,
        subscriberWorkerId: payload.workerId,
        relationship: dep.relationship,
        cobraEffectiveYmd: payload.startYmd,
        qualifyingEventId,
        medicalBenefitLostId,
        dentalBenefitLostId,
        statusId: openStatusId,
        provenance: {
          trigger: "life_event",
          eventType,
          electionId: payload.electionId,
          sourceElectionId,
          relationId: dep.relationId,
        },
      });
    }
  } catch (err) {
    logger.error("COBRA auto-case from life event failed", {
      service: SERVICE_NAME,
      electionId: payload.electionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Mutual exclusivity: close un-elected cases when coverage returns
// ---------------------------------------------------------------------------

async function handleWmbSaved(payload: WmbSavedPayload): Promise<void> {
  if (!componentActive()) return;
  if (payload.isDeleted) return;

  try {
    const openCases = await storage.baoCobraCases.listActiveUnelectedCasesForCoveredPerson(
      payload.workerId,
    );
    if (openCases.length === 0) return;
    if (!(await storage.baoCobraCases.hasActiveMedicalOrDentalBenefits(payload.workerId))) {
      return;
    }
    const { closedStatusId } = await resolveStatuses();
    if (!closedStatusId) {
      logger.warn("No closed COBRA status configured; cannot auto-close case", {
        service: SERVICE_NAME,
      });
      return;
    }
    for (const openCase of openCases) {
      await storage.baoCobraCases.updateEnforcingInvariants(
        openCase.id,
        {
          statusId: closedStatusId,
          data: {
            ...((openCase.data as Record<string, unknown> | null) ?? {}),
            autoClosed: {
              reason: "active_benefits_restored",
              wmbId: payload.wmbId,
              at: new Date().toISOString(),
            },
          },
        },
        openCase.coveredPersonWorkerId,
        true,
      );
      logger.info("Auto-closed un-elected COBRA case (benefits restored)", {
        service: SERVICE_NAME,
        caseId: openCase.id,
        coveredPersonWorkerId: payload.workerId,
      });
    }
  } catch (err) {
    logger.error("COBRA auto-close failed", {
      service: SERVICE_NAME,
      workerId: payload.workerId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Init / shutdown
// ---------------------------------------------------------------------------

export function initBaoCobraAutoCase(): void {
  if (handlerIds.length > 0) {
    logger.warn("BAO COBRA auto-case already initialized", { service: SERVICE_NAME });
    return;
  }
  handlerIds.push(
    eventBus.on({
      name: "bao-cobra-auto-case-wmb-terminate",
      description:
        "Opens COBRA cases when a WMB scan terminates a medical/dental benefit for a qualifying (configured) reason.",
      event: EventType.TRUST_WMB_SCAN_WORKER_COMPLETED,
      handler: handleWmbScanWorkerCompleted,
    }),
    eventBus.on({
      name: "bao-cobra-auto-case-life-event",
      description:
        "Opens COBRA cases for dependents removed by a divorce/death life-event enrollment.",
      event: EventType.TRUST_ELECTION_SAVED,
      handler: handleElectionSaved,
    }),
    eventBus.on({
      name: "bao-cobra-auto-close",
      description:
        "Closes active un-elected COBRA cases when the person regains active medical/dental benefits.",
      event: EventType.WMB_SAVED,
      handler: handleWmbSaved,
    }),
  );
  logger.info("BAO COBRA auto-case initialized", { service: SERVICE_NAME });
}

export function shutdownBaoCobraAutoCase(): void {
  for (const id of handlerIds) {
    eventBus.off(id);
  }
  handlerIds.length = 0;
}
