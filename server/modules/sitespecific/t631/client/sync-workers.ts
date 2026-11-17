import { storage, createCommSmsOptinStorage } from "../../../../storage";
import { schedulePhoneRevalidation } from "../../../../services/comm/validators/phone";
import { logger, storageLogger } from "../../../../logger";
import { getOptionsType } from "../../../options-registry";
import { runInTransaction } from "../../../../storage/transaction-context";
import { t631IdentityValues } from "@shared/t631-identity";
import { getTodayYmd } from "@shared/utils/date";
import { isMaintenanceModeError } from "../../../../services/maintenance-flag";

interface T631WorkerRow {
  worker_id?: unknown;
  worker_ein?: unknown;
  worker_name?: unknown;
  worker_phone?: unknown;
  worker_ms?: unknown;
  [key: string]: unknown;
}

const MS_TO_SYNC_VARIABLE = "sitespecific.t631.ms_to_sync";

const smsOptinStorage = createCommSmsOptinStorage();

/**
 * Reduce a loosely formatted phone number ("(702) 555-1234", "+17025551234",
 * "702.555.1234") to its comparable digits: strip non-digits and drop a
 * leading US country code "1" when 11 digits. Returns null when the result
 * is not a plausible 10-digit US number.
 */
export function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

/**
 * Parse a remote "Family, Given" name (e.g. "Aery, Lina") into name parts.
 * Falls back to treating the whole string as the family name when no comma
 * is present. Returns null for blank input.
 */
export function parseRemoteWorkerName(raw: string): { given: string | null; family: string | null; displayName: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx === -1) {
    return { given: null, family: trimmed, displayName: trimmed };
  }
  const family = trimmed.slice(0, commaIdx).trim();
  const given = trimmed.slice(commaIdx + 1).trim();
  const displayName = [given, family].filter(Boolean).join(" ") || trimmed;
  return { given: given || null, family: family || null, displayName };
}

interface T631WorkerListResponse {
  success: boolean;
  data?: { workers?: unknown };
  [key: string]: unknown;
}

export interface WorkerEinSyncResult {
  rowCounts: { received: number; changed: number; unchanged: number };
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  skipped: number;
  errors: number;
  workersCreated: number;
  phonesCreated: number;
  phonesDeleted: number;
  phonesUnchanged: number;
  optins: number;
  statusesSet: number;
  edlsActivated: number;
  edlsDeactivated: number;
  details: Array<{ workerId?: string; remoteWorkerId: string; action: string; error?: string }>;
}

interface SyncedMsOption {
  id: string;
  industryId: string;
  name: string;
}

interface MemberStatusSyncContext {
  /** remote worker_ms code (sirius_id, trimmed) → local option selected for sync */
  syncedBySirius: Map<string, SyncedMsOption>;
  /** every distinct sirius_id present locally (synced or not), for unmatched detection */
  knownSiriusIds: Set<string>;
  /** option IDs selected for sync (resolved against existing options) */
  syncedMsIds: string[];
  /** local workers matched to any row in the incoming list (excluded from EDLS deactivation) */
  seenWorkerIds: Set<string>;
}

/**
 * Load the `sitespecific.t631.ms_to_sync` selection and resolve it against
 * the local member-status options (matched to remote codes via sirius_id).
 */
async function buildMemberStatusSyncContext(): Promise<MemberStatusSyncContext> {
  const ctx: MemberStatusSyncContext = {
    syncedBySirius: new Map(),
    knownSiriusIds: new Set(),
    syncedMsIds: [],
    seenWorkerIds: new Set(),
  };

  const variable = await storage.variables.getByName(MS_TO_SYNC_VARIABLE);
  const raw = variable?.value;
  const selectedIds = new Set(
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [],
  );

  const allMs = (await getOptionsType("worker-ms")!.getAll()) as Array<{
    id: string;
    name: string;
    siriusId: string | null;
    industryId: string;
  }>;

  for (const ms of allMs) {
    const sirius = (ms.siriusId ?? "").trim();
    if (!sirius) continue;
    ctx.knownSiriusIds.add(sirius);
    if (selectedIds.has(ms.id)) {
      ctx.syncedBySirius.set(sirius, { id: ms.id, industryId: ms.industryId, name: ms.name });
      ctx.syncedMsIds.push(ms.id);
    }
  }

  return ctx;
}

/**
 * Apply the remote worker_ms code to a local worker: when the code maps to a
 * status selected for sync, record the status via the normal history
 * methodology (new worker_msh entry dated today; same-day same-industry entry
 * is updated instead, honoring the (date, worker, industry) uniqueness) and
 * ensure the worker is EDLS-active. Unmatched codes are reported; codes that
 * map to a non-synced status leave status and EDLS untouched.
 */
async function syncMemberStatus(opts: {
  ctx: MemberStatusSyncContext;
  workerId: string;
  remoteWorkerId: string;
  remoteMsRaw: string;
  dryRun: boolean;
  result: WorkerEinSyncResult;
}): Promise<void> {
  const { ctx, workerId, remoteWorkerId, remoteMsRaw, dryRun, result } = opts;
  const detail = (action: string, error?: string) => {
    result.details.push({ workerId, remoteWorkerId, action, ...(error ? { error } : {}) });
  };

  const code = remoteMsRaw.trim();
  if (!code) return;

  const synced = ctx.syncedBySirius.get(code);
  if (!synced) {
    if (!ctx.knownSiriusIds.has(code)) {
      detail("ms_unmatched", `remote worker_ms "${code}" does not match any local member status sirius_id; status and EDLS untouched`);
    }
    return; // known but not selected for sync → leave status and EDLS alone
  }

  ctx.seenWorkerIds.add(workerId);

  // Status: skip when the worker already currently holds it.
  const currentIds = await storage.workerMsh.getCurrentMemberStatusIds(workerId);
  if (currentIds.includes(synced.id)) {
    detail(dryRun ? "would_keep_status" : "kept_status", `already current: ${synced.name}`);
  } else {
    const today = getTodayYmd();
    if (dryRun) {
      result.statusesSet++;
      detail("would_set_status", `${synced.name} (${code}) dated ${today}`);
    } else {
      // Same-day entry for this industry? Update it instead of violating the
      // (date, worker, industry) uniqueness.
      const history = await storage.workerMsh.getWorkerMsh(workerId);
      const sameDay = history.find(
        (h: { date: string; industryId: string }) => h.date === today && h.industryId === synced.industryId,
      );
      if (sameDay) {
        await storage.workerMsh.updateWorkerMsh(sameDay.id, { msId: synced.id });
      } else {
        await storage.workerMsh.createWorkerMsh({
          workerId,
          date: today,
          msId: synced.id,
          industryId: synced.industryId,
          data: { source: "t631-sync" },
        });
      }
      result.statusesSet++;
      detail("set_status", `${synced.name} (${code}) dated ${today}`);
    }
  }

  // EDLS: ensure active.
  const edls = await storage.workerEdls.getByWorker(workerId);
  if (!edls?.active) {
    if (dryRun) {
      result.edlsActivated++;
      detail("would_edls_activate");
    } else {
      await storage.workerEdls.setActive(workerId, true);
      result.edlsActivated++;
      detail("edls_activated");
    }
  }
}

/**
 * Deactivation pass: for each status selected for sync, any local worker
 * currently holding that status who was NOT in the incoming remote list is
 * marked not active in EDLS (workers already inactive are left alone).
 */
async function deactivateMissingWorkers(
  ctx: MemberStatusSyncContext,
  dryRun: boolean,
  result: WorkerEinSyncResult,
  runUnit: SyncUnit,
): Promise<void> {
  if (ctx.syncedMsIds.length === 0) return;
  const holders = await storage.workerMsh.getWorkerIdsWithCurrentMs(ctx.syncedMsIds, true);
  const candidateIds = new Set(
    holders.map((h) => h.workerId).filter((id) => !ctx.seenWorkerIds.has(id)),
  );
  for (const workerId of candidateIds) {
    const before = { ...result };
    const detailCount = result.details.length;
    try {
      await runUnit(async () => {
        const edls = await storage.workerEdls.getByWorker(workerId);
        if (!edls?.active) return; // already inactive
        const currentIds = await storage.workerMsh.getCurrentMemberStatusIds(workerId);
        if (!currentIds.some(id => ctx.syncedMsIds.includes(id))) return;
        if (dryRun) {
          result.edlsDeactivated++;
          result.details.push({ workerId, remoteWorkerId: "(absent)", action: "would_edls_deactivate", error: "holds a synced status but is not in the incoming remote list" });
        } else {
          await storage.workerEdls.setActive(workerId, false);
          result.edlsDeactivated++;
          result.details.push({ workerId, remoteWorkerId: "(absent)", action: "edls_deactivated", error: "holds a synced status but is not in the incoming remote list" });
        }
      });
    } catch (error) {
      if (error instanceof SyncInterrupted || error instanceof SyncRunRefusal || isMaintenanceModeError(error)) throw error;
      if (runUnit !== unguardedUnit) { Object.assign(result, before); result.details.length = detailCount; }
      result.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      result.details.push({ workerId, remoteWorkerId: "(absent)", action: "error", error: errMsg });
    }
  }
}

const OPTIN_SYNC_NOTE = "opted in via sync from Teamsters 631";

/**
 * Mirror the single remote worker_phone onto the worker's contact:
 * - blank remote phone → delete every local phone number;
 * - present remote phone → keep an active local number whose digits match,
 *   delete every other number, create the number (as +1E164, primary) when
 *   no match exists;
 * - ensure the synced number's SMS opt-in record is opted in (general optin
 *   only — allowlist untouched), overriding a prior opt-out, with the
 *   audit-trail note recorded via the storage logger.
 * All mutations go through the logged storage methods.
 */
async function mirrorWorkerPhone(opts: {
  contactId: string;
  remotePhoneRaw: string;
  workerId: string;
  remoteWorkerId: string;
  dryRun: boolean;
  result: WorkerEinSyncResult;
}): Promise<void> {
  const { contactId, remotePhoneRaw, workerId, remoteWorkerId, dryRun, result } = opts;
  const detail = (action: string, error?: string) => {
    result.details.push({ workerId, remoteWorkerId, action, ...(error ? { error } : {}) });
  };

  const remoteTrimmed = remotePhoneRaw.trim();
  const remoteDigits = normalizePhoneDigits(remoteTrimmed);
  if (remoteTrimmed && !remoteDigits) {
    detail("phone_invalid", `remote phone "${remoteTrimmed}" is not a valid 10-digit US number; phone left untouched`);
    return;
  }
  const localNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);

  // Blank remote phone → mirror by deleting everything local.
  if (!remoteTrimmed) {
    for (const local of localNumbers) {
      if (dryRun) {
        result.phonesDeleted++;
        detail("would_delete_phone", `remote phone blank; would delete ${local.phoneNumber}`);
      } else {
        await storage.contacts.phoneNumbers.deletePhoneNumber(local.id);
        result.phonesDeleted++;
        detail("deleted_phone", `remote phone blank; deleted ${local.phoneNumber}`);
      }
    }
    return;
  }

  const e164 = `+1${remoteDigits}`;

  // Keep the first ACTIVE local number whose digits match; purge all others.
  const match = localNumbers.find(
    (p) => p.isActive && normalizePhoneDigits(p.phoneNumber) === remoteDigits,
  );

  for (const local of localNumbers) {
    if (match && local.id === match.id) continue;
    if (dryRun) {
      result.phonesDeleted++;
      detail("would_delete_phone", `would delete ${local.phoneNumber} (does not match remote ${e164})`);
    } else {
      await storage.contacts.phoneNumbers.deletePhoneNumber(local.id);
      result.phonesDeleted++;
      detail("deleted_phone", `deleted ${local.phoneNumber} (does not match remote ${e164})`);
    }
  }

  if (match) {
    result.phonesUnchanged++;
    detail(dryRun ? "would_keep_phone" : "kept_phone", `matches remote ${e164}`);
  } else if (dryRun) {
    result.phonesCreated++;
    detail("would_create_phone", `would create ${e164}`);
  } else {
    await storage.contacts.phoneNumbers.createPhoneNumber({
      contactId,
      phoneNumber: e164,
      isPrimary: true,
      isActive: true,
    });
    // Validate the new number once, off the sync's critical path.
    schedulePhoneRevalidation(e164);
    result.phonesCreated++;
    detail("created_phone", `created ${e164}`);
  }

  // Force SMS opt-in (general optin only, never allowlist), overriding a
  // prior explicit opt-out. The audit note lives in the log trail only.
  const existingOptin = await smsOptinStorage.getSmsOptinByPhoneNumber(e164);
  if (existingOptin?.optin) {
    return; // already opted in — nothing to do, no note
  }
  if (dryRun) {
    result.optins++;
    detail("would_optin", `${e164} would be marked SMS opted-in`);
    return;
  }
  let optinId: string;
  if (existingOptin) {
    const updated = await smsOptinStorage.updateSmsOptin(existingOptin.id, {
      optin: true,
      optinDate: new Date(),
      optinUser: null,
      optinIp: null,
    });
    optinId = updated?.id ?? existingOptin.id;
  } else {
    const created = await smsOptinStorage.createSmsOptin({
      phoneNumber: e164,
      optin: true,
      optinDate: new Date(),
      allowlist: false,
    });
    optinId = created.id;
  }
  result.optins++;
  detail("opted_in", `${e164} marked SMS opted-in`);
  setImmediate(() => {
    storageLogger.info(`Storage operation: comm.smsOptin.syncOptin`, {
      module: "comm.smsOptin",
      operation: "syncOptin",
      entity_id: optinId,
      host_entity_id: contactId,
      description: `${e164}: ${OPTIN_SYNC_NOTE}`,
      meta: { phoneNumber: e164, remoteWorkerId, workerId, previousOptin: existingOptin?.optin ?? null },
    });
  });
}

export class SyncInterrupted extends Error {}
export class SyncRunRefusal extends Error {}
export type SyncUnit = (work: () => Promise<void>) => Promise<void>;
const unguardedUnit: SyncUnit = (work) => work();

export async function syncWorkerEins(
  responseData: T631WorkerListResponse,
  dryRun: boolean,
  runUnit: SyncUnit = unguardedUnit,
): Promise<WorkerEinSyncResult> {
  const result: WorkerEinSyncResult = {
    rowCounts: { received: 0, changed: 0, unchanged: 0 },
    created: 0, updated: 0, deleted: 0, unchanged: 0, skipped: 0, errors: 0, workersCreated: 0,
    phonesCreated: 0, phonesDeleted: 0, phonesUnchanged: 0, optins: 0,
    statusesSet: 0, edlsActivated: 0, edlsDeactivated: 0, details: [],
  };

  if (!responseData.success || !responseData.data) {
    logger.warn("T631 worker list returned unsuccessful or empty data", {
      service: "t631-sync-workers",
      success: responseData.success,
    });
    return result;
  }

  const rawWorkers = responseData.data.workers;
  let rows: T631WorkerRow[];
  if (Array.isArray(rawWorkers)) {
    rows = rawWorkers as T631WorkerRow[];
  } else if (rawWorkers && typeof rawWorkers === "object") {
    rows = Object.values(rawWorkers) as T631WorkerRow[];
  } else {
    const msg = "T631 worker list payload data.workers must be an array or object of worker rows";
    logger.error(msg, { service: "t631-sync-workers" });
    result.errors++;
    result.details.push({ remoteWorkerId: "(payload)", action: "error", error: msg });
    return result;
  }

  result.rowCounts.received = rows.length;
  const t631TypeId = await storage.workerIds.getTypeIdBySiriusId("t631");
  if (!t631TypeId) {
    const msg = "Cannot sync T631 worker EINs: no options_worker_id_type row with sirius_id='t631'";
    logger.error(msg, { service: "t631-sync-workers" });
    result.errors++;
    result.details.push({ remoteWorkerId: "(config)", action: "error", error: msg });
    return result;
  }

  const einTypeId = await storage.workerIds.getTypeIdBySiriusId("freeman_ein");
  if (!einTypeId) {
    const msg = "Cannot sync T631 worker EINs: no options_worker_id_type row with sirius_id='freeman_ein'";
    logger.error(msg, { service: "t631-sync-workers" });
    result.errors++;
    result.details.push({ remoteWorkerId: "(config)", action: "error", error: msg });
    return result;
  }

  // Track EINs seen this run so a duplicate remote EIN is reported, not double-written.
  const seenEins = new Map<string, string>(); // ein -> remoteWorkerId that claimed it
  const plannedLinks = new Map<string, string>(); // worker -> proposed T631 ID (dry-run only)

  const msCtx = await buildMemberStatusSyncContext();

  // Validate the whole source before any writes; never let arrival order decide identity.
  const sourceEins = new Map<string, Set<string>>();
  const einClaimants = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      result.errors++;
      result.details.push({ remoteWorkerId: "(payload)", action: "error", error: "Invalid worker row; sync refused" });
      return result;
    }
    const id = String(row.worker_id ?? "").trim();
    if (!id) continue;
    const key = t631IdentityValues(id).sort()[0];
    const values = sourceEins.get(key) ?? new Set<string>();
    values.add(String(row.worker_ein ?? "").trim());
    sourceEins.set(key, values);
    const incomingEin = String(row.worker_ein ?? "").trim();
    if (incomingEin) {
      const claimants = einClaimants.get(incomingEin) ?? new Set<string>();
      claimants.add(key);
      einClaimants.set(incomingEin, claimants);
    }
  }

  for (const row of rows) {
    const before = { ...result };
    const detailCount = result.details.length;
    const remoteWorkerId = row.worker_id !== undefined && row.worker_id !== null ? String(row.worker_id).trim() : "";
    const rawEin = row.worker_ein !== undefined && row.worker_ein !== null ? String(row.worker_ein).trim() : "";
    const remotePhoneRaw = row.worker_phone !== undefined && row.worker_phone !== null ? String(row.worker_phone) : "";
    const remoteMsRaw = row.worker_ms !== undefined && row.worker_ms !== null ? String(row.worker_ms) : "";

    if (!remoteWorkerId) {
      result.skipped++;
      result.details.push({ remoteWorkerId: "(empty)", action: "skipped", error: "Missing worker_id" });
      continue;
    }
    try {
      await runUnit(async () => {
      const reconcile = async () => {
      // When the remote row has no EIN, fall back to using the remote worker ID
      // as the EIN value rather than skipping the row.
      const ein = rawEin || remoteWorkerId;

      const matches = await storage.workerIds.getByTypeAndValues(t631TypeId, t631IdentityValues(remoteWorkerId));
      // Present in the incoming list → never a deactivation candidate,
      // regardless of whether the remote code maps to a synced status
      // (non-synced/unmatched codes must leave EDLS untouched) and even
      // when the row is skipped below (duplicate EIN, conflicts, etc.).
      for (const match of matches) msCtx.seenWorkerIds.add(match.workerId);
      if (rawEin && (einClaimants.get(rawEin)?.size ?? 0) > 1) {
        result.skipped++;
        result.details.push({ remoteWorkerId, action: "skipped", error: "conflicting_source_t631_ids: EIN claimed by multiple T631 identities; no identity changes made" });
        return;
      }
      if (sourceEins.get(t631IdentityValues(remoteWorkerId).sort()[0])!.size > 1) {
        result.skipped++;
        result.details.push({ remoteWorkerId, action: "skipped", error: "conflicting_source_eins: repeated worker_id has different EINs" });
        return;
      }
      if (matches.length && !rawEin) {
        result.skipped++;
        result.details.push({ remoteWorkerId, action: "skipped", error: "blank_ein: existing worker IDs left untouched" });
        return;
      }

      const firstClaimant = seenEins.get(ein);
      if (firstClaimant !== undefined) {
        result.skipped++;
        result.details.push({
          remoteWorkerId,
          action: "skipped",
          error: `duplicate_ein: EIN ${ein} already appeared on remote worker_id=${firstClaimant}`,
        });
        return;
      }

      let t631Row;
      try {
        t631Row = await storage.workerIds.resolveT631Identity(t631TypeId, remoteWorkerId, einTypeId, rawEin, dryRun);
        if (t631Row && plannedLinks.has(t631Row.workerId) &&
            !t631IdentityValues(remoteWorkerId).includes(plannedLinks.get(t631Row.workerId)!)) {
          throw new Error("t631_conflict: EIN-matched worker already has a proposed T631 ID");
        }
      } catch (error) {
        if (error instanceof Error && /^(ambiguous_t631_identity|ein_conflict|t631_conflict):/.test(error.message)) {
          result.skipped++;
          result.details.push({ remoteWorkerId, action: "skipped", error: error.message });
          return;
        }
        throw error;
      }
      if (t631Row) {
        msCtx.seenWorkerIds.add(t631Row.workerId);
        if (t631Row.linked) {
          if (dryRun) plannedLinks.set(t631Row.workerId, remoteWorkerId);
          result.details.push({ workerId: t631Row.workerId, remoteWorkerId, action: dryRun ? "would_link_t631" : "linked_t631" });
        }
      }
      if (!t631Row) {
        // No local worker with this t631 ID — create one from the remote name.
        const rawName = row.worker_name !== undefined && row.worker_name !== null ? String(row.worker_name) : "";
        const nameParts = parseRemoteWorkerName(rawName);
        if (!nameParts) {
          result.skipped++;
          result.details.push({ remoteWorkerId, action: "skipped", error: `worker_not_found_no_name: no local worker (t631=${remoteWorkerId}) and worker_name is blank; cannot create` });
          return;
        }

        // Don't create a worker if the EIN is already held by an existing worker.
        const conflictHolder = await storage.workerIds.getWorkerIdByTypeAndValue(einTypeId, ein);
        if (conflictHolder) {
          result.skipped++;
          result.details.push({ remoteWorkerId, action: "skipped", error: `ein_conflict: EIN ${ein} already held by another worker (workerId=${conflictHolder.workerId}); worker not created` });
          return;
        }

        seenEins.set(ein, remoteWorkerId);

        if (dryRun) {
          result.workersCreated++;
          result.created++;
          result.details.push({ remoteWorkerId, action: "would_create_worker" });
          // No local contact exists yet — report the phone actions a live run would take.
          const remoteTrimmed = remotePhoneRaw.trim();
          if (remoteTrimmed) {
            const digits = normalizePhoneDigits(remoteTrimmed);
            if (digits) {
              result.phonesCreated++;
              result.optins++;
              result.details.push({ remoteWorkerId, action: "would_create_phone", error: `would create +1${digits}` });
              result.details.push({ remoteWorkerId, action: "would_optin", error: `+1${digits} would be marked SMS opted-in` });
            } else {
              result.details.push({ remoteWorkerId, action: "phone_invalid", error: `remote phone "${remoteTrimmed}" is not a valid 10-digit US number` });
            }
          }
          // No local worker yet — report the status/EDLS actions a live run would take.
          const wouldSync = msCtx.syncedBySirius.get(remoteMsRaw.trim());
          if (wouldSync) {
            result.statusesSet++;
            result.edlsActivated++;
            result.details.push({ remoteWorkerId, action: "would_set_status", error: `${wouldSync.name} (${remoteMsRaw.trim()}) dated ${getTodayYmd()}` });
            result.details.push({ remoteWorkerId, action: "would_edls_activate" });
          } else if (remoteMsRaw.trim() && !msCtx.knownSiriusIds.has(remoteMsRaw.trim())) {
            result.details.push({ remoteWorkerId, action: "ms_unmatched", error: `remote worker_ms "${remoteMsRaw.trim()}" does not match any local member status sirius_id; status and EDLS untouched` });
          }
          return;
        }

        const newWorker = await runInTransaction(async () => {
          const worker = await storage.workers.createWorkerWithNameParts(nameParts);
          await storage.workerIds.createWorkerId({ workerId: worker.id, typeId: t631TypeId, value: remoteWorkerId });
          await storage.workerIds.createWorkerId({ workerId: worker.id, typeId: einTypeId, value: ein });
          return worker;
        });
        result.workersCreated++;
        result.created++;
        result.details.push({ workerId: newWorker.id, remoteWorkerId, action: "created_worker" });
        await mirrorWorkerPhone({
          contactId: newWorker.contactId,
          remotePhoneRaw,
          workerId: newWorker.id,
          remoteWorkerId,
          dryRun,
          result,
        });
        await syncMemberStatus({ ctx: msCtx, workerId: newWorker.id, remoteWorkerId, remoteMsRaw, dryRun, result });
        return;
      }
      const localWorkerId = t631Row.workerId;
      const wd = (action: string, error?: string) => ({
        workerId: localWorkerId,
        remoteWorkerId,
        action,
        ...(error ? { error } : {}),
      });

      // Conflict: EIN already held by a different local worker.
      const existingHolder = await storage.workerIds.getWorkerIdByTypeAndValue(einTypeId, ein);
      if (existingHolder && existingHolder.workerId !== localWorkerId) {
        result.skipped++;
        result.details.push(wd("skipped", `ein_conflict: EIN ${ein} already held by another worker (workerId=${existingHolder.workerId})`));
        return;
      }

      seenEins.set(ein, remoteWorkerId);

      // A preview-only link has no persisted source ID yet. Its EIN already
      // matched exactly; do not weaken reconciliation's source-identity guard.
      const repaired = dryRun && t631Row.linked ? { deleted: 0, created: 0 } :
        await storage.workerIds.reconcileWorkerId(
          localWorkerId, einTypeId, ein, dryRun, { typeId: t631TypeId, value: t631Row.value },
        );
      result.deleted += repaired.deleted;
      result.created += repaired.created;
      if (repaired.deleted) result.updated++;
      if (!repaired.deleted && !repaired.created) result.unchanged++;
      result.details.push(wd(dryRun ? "would_reconcile_ein" : "reconciled_ein",
        `${repaired.deleted} deleted, ${repaired.created} created; exactly one matching EIN retained`));

      // Mirror the remote phone onto the (existing) worker's contact.
      const contactId = await storage.workers.getWorkerContactId(localWorkerId);
      if (contactId) {
        await mirrorWorkerPhone({
          contactId,
          remotePhoneRaw,
          workerId: localWorkerId,
          remoteWorkerId,
          dryRun,
          result,
        });
      } else {
        result.details.push(wd("phone_skipped", "local worker row not found for phone mirroring"));
      }

      // Member status + EDLS-active from the remote worker_ms code.
      await syncMemberStatus({ ctx: msCtx, workerId: localWorkerId, remoteWorkerId, remoteMsRaw, dryRun, result });
      };
      // Preview reads remain fresh: without a write lock, memoizing them would
      // hide concurrent edits. Live reads are reusable only inside this unit.
      if (dryRun) await reconcile();
      else await storage.workerIds.withLockedIdentityReads(reconcile);
      });
      if (result.skipped === before.skipped) {
        const changed = (["created", "deleted", "workersCreated", "phonesCreated", "phonesDeleted",
          "optins", "statusesSet", "edlsActivated"] as const).some(key => result[key] !== before[key]) ||
          result.details.slice(detailCount).some(d => d.action === "linked_t631" || d.action === "would_link_t631");
        if (changed) result.rowCounts.changed++;
        else result.rowCounts.unchanged++;
      }
    } catch (error) {
      if (error instanceof SyncInterrupted || error instanceof SyncRunRefusal || isMaintenanceModeError(error)) throw error;
      if (!dryRun || runUnit !== unguardedUnit) { Object.assign(result, before); result.details.length = detailCount; }
      result.errors++;
      const errMsg = error instanceof Error ? error.message : String(error);
      result.details.push({ remoteWorkerId, action: "error", error: errMsg });
      logger.error(`Failed to sync T631 worker EIN for worker_id=${remoteWorkerId}`, {
        service: "t631-sync-workers",
        error: errMsg,
      });
    }
  }

  // Deactivation pass: synced-status holders absent from the incoming list.
  await deactivateMissingWorkers(msCtx, dryRun, result, runUnit);

  return result;
}
