import { storage, createCommSmsOptinStorage } from "../../../../storage";
import { logger, storageLogger } from "../../../../logger";
import { getOptionsType } from "../../../options-registry";

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
  created: number;
  updated: number;
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
    const today = new Date().toISOString().slice(0, 10);
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
): Promise<void> {
  if (ctx.syncedMsIds.length === 0) return;
  const holders = await storage.workerMsh.getWorkerIdsWithCurrentMs(ctx.syncedMsIds);
  const candidateIds = new Set(
    holders.map((h) => h.workerId).filter((id) => !ctx.seenWorkerIds.has(id)),
  );
  for (const workerId of candidateIds) {
    try {
      const edls = await storage.workerEdls.getByWorker(workerId);
      if (!edls?.active) continue; // already inactive
      if (dryRun) {
        result.edlsDeactivated++;
        result.details.push({ workerId, remoteWorkerId: "(absent)", action: "would_edls_deactivate", error: "holds a synced status but is not in the incoming remote list" });
      } else {
        await storage.workerEdls.setActive(workerId, false);
        result.edlsDeactivated++;
        result.details.push({ workerId, remoteWorkerId: "(absent)", action: "edls_deactivated", error: "holds a synced status but is not in the incoming remote list" });
      }
    } catch (error) {
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

  const localNumbers = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
  const remoteTrimmed = remotePhoneRaw.trim();

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

  const remoteDigits = normalizePhoneDigits(remoteTrimmed);
  if (!remoteDigits) {
    detail("phone_invalid", `remote phone "${remoteTrimmed}" is not a valid 10-digit US number; phone left untouched`);
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

export async function syncWorkerEins(
  responseData: T631WorkerListResponse,
  dryRun: boolean,
): Promise<WorkerEinSyncResult> {
  const result: WorkerEinSyncResult = {
    created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0, workersCreated: 0,
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

  const msCtx = await buildMemberStatusSyncContext();

  for (const row of rows) {
    const remoteWorkerId = row.worker_id !== undefined && row.worker_id !== null ? String(row.worker_id).trim() : "";
    const rawEin = row.worker_ein !== undefined && row.worker_ein !== null ? String(row.worker_ein).trim() : "";
    const remotePhoneRaw = row.worker_phone !== undefined && row.worker_phone !== null ? String(row.worker_phone) : "";
    const remoteMsRaw = row.worker_ms !== undefined && row.worker_ms !== null ? String(row.worker_ms) : "";

    if (!remoteWorkerId) {
      result.skipped++;
      result.details.push({ remoteWorkerId: "(empty)", action: "skipped", error: "Missing worker_id" });
      continue;
    }
    // When the remote row has no EIN, fall back to using the remote worker ID
    // as the EIN value rather than skipping the row.
    const ein = rawEin || remoteWorkerId;

    try {
      const firstClaimant = seenEins.get(ein);
      if (firstClaimant !== undefined) {
        result.skipped++;
        result.details.push({
          remoteWorkerId,
          action: "skipped",
          error: `duplicate_ein: EIN ${ein} already appeared on remote worker_id=${firstClaimant}`,
        });
        continue;
      }

      const t631Row = await storage.workerIds.getWorkerIdByTypeAndValue(t631TypeId, remoteWorkerId);
      if (!t631Row) {
        // No local worker with this t631 ID — create one from the remote name.
        const rawName = row.worker_name !== undefined && row.worker_name !== null ? String(row.worker_name) : "";
        const nameParts = parseRemoteWorkerName(rawName);
        if (!nameParts) {
          result.skipped++;
          result.details.push({ remoteWorkerId, action: "skipped", error: `worker_not_found_no_name: no local worker (t631=${remoteWorkerId}) and worker_name is blank; cannot create` });
          continue;
        }

        // Don't create a worker if the EIN is already held by an existing worker.
        const conflictHolder = await storage.workerIds.getWorkerIdByTypeAndValue(einTypeId, ein);
        if (conflictHolder) {
          result.skipped++;
          result.details.push({ remoteWorkerId, action: "skipped", error: `ein_conflict: EIN ${ein} already held by another worker (workerId=${conflictHolder.workerId}); worker not created` });
          continue;
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
            result.details.push({ remoteWorkerId, action: "would_set_status", error: `${wouldSync.name} (${remoteMsRaw.trim()})` });
            result.details.push({ remoteWorkerId, action: "would_edls_activate" });
          } else if (remoteMsRaw.trim() && !msCtx.knownSiriusIds.has(remoteMsRaw.trim())) {
            result.details.push({ remoteWorkerId, action: "ms_unmatched", error: `remote worker_ms "${remoteMsRaw.trim()}" does not match any local member status sirius_id; status and EDLS untouched` });
          }
          continue;
        }

        const newWorker = await storage.workers.createWorkerWithNameParts(nameParts);
        await storage.workerIds.createWorkerId({ workerId: newWorker.id, typeId: t631TypeId, value: remoteWorkerId });
        await storage.workerIds.createWorkerId({ workerId: newWorker.id, typeId: einTypeId, value: ein });
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
        continue;
      }
      const localWorkerId = t631Row.workerId;
      // Present in the incoming list → never a deactivation candidate,
      // regardless of whether the remote code maps to a synced status
      // (non-synced/unmatched codes must leave EDLS untouched) and even
      // when the EIN portion is skipped below.
      msCtx.seenWorkerIds.add(localWorkerId);
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
        continue;
      }

      seenEins.set(ein, remoteWorkerId);

      // Does this worker already have a freeman_ein row?
      const allIds = await storage.workerIds.getWorkerIdsByWorkerId(localWorkerId);
      const einRows = allIds.filter((w) => w.typeId === einTypeId);

      if (einRows.length > 1) {
        result.skipped++;
        result.details.push(wd("skipped", `multiple_ein_rows: worker has ${einRows.length} freeman_ein rows; resolve manually`));
        continue;
      }

      const existing = einRows[0];
      if (existing) {
        if (existing.value === ein) {
          result.unchanged++;
          result.details.push(wd(dryRun ? "would_be_unchanged" : "unchanged"));
        } else if (dryRun) {
          result.updated++;
          result.details.push(wd("would_update", `value ${existing.value} -> ${ein}`));
        } else {
          await storage.workerIds.updateWorkerId(existing.id, { value: ein });
          result.updated++;
          result.details.push(wd("updated", `value ${existing.value} -> ${ein}`));
        }
      } else if (dryRun) {
        result.created++;
        result.details.push(wd("would_create"));
      } else {
        await storage.workerIds.createWorkerId({
          workerId: localWorkerId,
          typeId: einTypeId,
          value: ein,
        });
        result.created++;
        result.details.push(wd("created"));
      }

      // Mirror the remote phone onto the (existing) worker's contact.
      const localWorker = await storage.workers.getWorker(localWorkerId);
      if (localWorker) {
        await mirrorWorkerPhone({
          contactId: localWorker.contactId,
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
    } catch (error) {
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
  await deactivateMissingWorkers(msCtx, dryRun, result);

  return result;
}
