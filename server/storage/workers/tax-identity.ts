import { eq, or, sql } from "drizzle-orm";
import { optionsWorkerIdType, type Worker } from "@shared/schema";
import { ALTERNATE_TAX_ID, ALTERNATE_TAX_NAME, classifyTaxIdentity, TaxIdentityReviewError } from "@shared/utils/worker-tax-identity";
import { getClient, runInTransaction, runWithTransaction } from "../transaction-context";
import { setTimeout } from "node:timers/promises";
import { validateSSN } from "@shared/utils/ssn";

/** Bounded waits: neither an import nor startup should hang behind a claimant. */
async function lockIdentity(key: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const result = await getClient().execute(sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`);
    if (result.rows[0]?.acquired) return;
    await setTimeout(100);
  }
  throw new TaxIdentityReviewError("Another import is using this identity. Wait briefly, then validate and retry.");
}

/** Provision under the startup bring-up lock; unique id/key handles other boots.
 * A same-name unrelated type is not silently adopted (values could mean anything).
 */
export async function ensureAlternateTaxIdType(): Promise<void> {
  await runInTransaction(async () => {
    const client = getClient();
    await lockIdentity("alternate-tax-type");
    const candidates = await client.select().from(optionsWorkerIdType).where(or(
      eq(optionsWorkerIdType.id, ALTERNATE_TAX_ID),
      eq(optionsWorkerIdType.siriusId, ALTERNATE_TAX_ID),
      sql`lower(trim(${optionsWorkerIdType.name})) = lower(${ALTERNATE_TAX_NAME})`,
    ));
    if (candidates.some(row => row.id !== ALTERNATE_TAX_ID || row.siriusId !== ALTERNATE_TAX_ID
      || row.name !== ALTERNATE_TAX_NAME || row.validator != null)) {
      throw new Error("Alternate Tax ID type conflicts with an existing definition. Resolve worker ID type configuration before startup.");
    }
    await client.insert(optionsWorkerIdType).values({
      id: ALTERNATE_TAX_ID, siriusId: ALTERNATE_TAX_ID, name: ALTERNATE_TAX_NAME, data: { showOnLists: false },
    }).onConflictDoNothing();
  });
}

export interface TaxIdentityReader {
  workers: { getWorkerBySSN(value: string): Promise<Worker | undefined>; getWorker(id: string): Promise<Worker | undefined> };
  workerIds: { getWorkerIdByTypeAndValue(typeId: string, value: string): Promise<{ workerId: string } | undefined> };
}

/** One read-only resolution for validation, preview, and execution. */
export async function resolveTaxIdentity(reader: TaxIdentityReader, input: unknown) {
  const identity = classifyTaxIdentity(input);
  if (identity.kind === "review") throw new TaxIdentityReviewError(identity.message);
  const worker = identity.kind === "ssn"
    ? await reader.workers.getWorkerBySSN(identity.value)
    : await (async () => {
      const id = await reader.workerIds.getWorkerIdByTypeAndValue(ALTERNATE_TAX_ID, identity.value);
      if (!id) return undefined;
      const worker = await reader.workers.getWorker(id.workerId);
      if (!worker) throw new TaxIdentityReviewError("The identifier refers to a missing worker. Ask staff to correct the worker ID.");
      return worker;
    })();
  return { identity, worker, key: `${identity.kind}:${identity.value}` };
}

/** Atomic contact + worker + identity. A savepoint owns rollback even when the
 * wizard already has an ambient transaction. Serialize same-key claims BEFORE
 * looking up, so a losing claim has no orphan contact and no aborted-tx reuse.
 */
export interface TaxIdentityWriter extends TaxIdentityReader {
  workers: TaxIdentityReader["workers"] & {
    createWorker(name: string): Promise<Worker>;
    updateWorkerSSN(id: string, ssn: string): Promise<Worker | undefined>;
  };
  workerIds: TaxIdentityReader["workerIds"] & {
    createWorkerId(data: { workerId: string; typeId: string; value: string }): Promise<unknown>;
  };
}

export async function claimTaxWorker(reader: TaxIdentityWriter, input: unknown, name: string, mode: "create" | "update",
  payroll?: { typeId: string; value: string }) {
  const hasTax = input != null && String(input).trim() !== "";
  const identity = hasTax || !payroll ? classifyTaxIdentity(input) : null;
  if (identity?.kind === "review") throw new TaxIdentityReviewError(identity.message);
  const keys = [
    ...(identity ? [`tax-worker:${identity.kind}:${identity.value}`] : []),
    ...(payroll ? [`payroll-worker:${payroll.typeId}:${payroll.value}`] : []),
  ].sort();
  try {
    return await runInTransaction(async () => getClient().transaction(async tx => runWithTransaction(tx, async () => {
      for (const key of keys) await lockIdentity(key);
      const resolved = identity ? await resolveTaxIdentity(reader, input) : null;
      const byPayroll = payroll && await reader.workerIds.getWorkerIdByTypeAndValue(payroll.typeId, payroll.value);
      if (resolved?.worker && byPayroll && resolved.worker.id !== byPayroll.workerId) {
        throw new TaxIdentityReviewError("Tax identifier and Person Number match different workers. Ask staff to correct the row.");
      }
      let worker = resolved?.worker || (byPayroll ? await reader.workers.getWorker(byPayroll.workerId) : undefined);
      if (worker && identity?.kind === "ssn" && worker.ssn && validateSSN(worker.ssn).parsed !== identity.value) {
        throw new TaxIdentityReviewError("Person Number and submitted SSN disagree. Ask staff to review the identity.");
      }
      let created = false;
      if (!worker) {
        if (mode === "update") throw new TaxIdentityReviewError("No worker matches this identifier. Correct the row or ask staff to review it.");
        if (!name.trim()) throw new TaxIdentityReviewError("A name is required to create a worker.");
        worker = await reader.workers.createWorker(name);
        created = true;
        if (identity?.kind === "ssn") {
          const updated = await reader.workers.updateWorkerSSN(worker.id, identity.value);
          if (!updated) throw new TaxIdentityReviewError("Worker identity could not be saved. Validate the upload again.");
          worker = updated;
        }
      }
      // An established payroll match can acquire a previously unclaimed alternate
      // ID, never an unrelated SSN and never another worker's alternate ID.
      if (identity?.kind === "alternate" && !resolved?.worker) {
        await reader.workerIds.createWorkerId({ workerId: worker.id, typeId: ALTERNATE_TAX_ID, value: identity.value });
      }
      if (payroll && !byPayroll) await reader.workerIds.createWorkerId({ workerId: worker.id, ...payroll });
      return { worker, created };
    })));
  } catch (error) {
    if (error instanceof TaxIdentityReviewError) throw error;
    // Database unique errors can contain the raw value in detail and SQL params.
    throw new TaxIdentityReviewError("Worker identity could not be saved. Review conflicting IDs, then validate and retry.");
  }
}

/** Resolve cross-row contradictions before processing any row, independent of
 * ordering. Names are NOT matching keys; inconsistent assertions on one key
 * merely require correction. Payroll numbers retain their exact spelling.
 */
export async function findTaxIdentityConflicts(reader: TaxIdentityReader, rows: Array<{
  ssn?: unknown; firstName?: unknown; lastName?: unknown; fullName?: unknown;
  dateOfBirth?: unknown; birthDate?: unknown; personNumber?: unknown;
}>, payrollTypeId?: string | null): Promise<Map<number, string>> {
  const errors = new Map<number, string>();
  const groups = new Map<string, Array<{ index: number; name: string; birth: string }>>();
  const payrollKeys = new Map<string, Set<string>>();
  const resolvedPayroll = new Map<string, string | null>();
  const taxPayroll = new Map<string, Array<{ index: number; target: string }>>();
  for (const [index, row] of rows.entries()) {
    try {
      // Local26 may identify by Person Number alone, but a supplied placeholder
      // may never silently fall back to payroll.
      const supplied = row.ssn != null && String(row.ssn).trim() !== "";
      const resolution = supplied ? await resolveTaxIdentity(reader, row.ssn) : null;
      if (!supplied && !payrollTypeId) throw new TaxIdentityReviewError("An identifier is required. Correct the SSN column and validate again.");
      const payroll = payrollTypeId && row.personNumber ? String(row.personNumber) : null;
      let payrollWorker: string | null = null;
      if (payroll && payrollTypeId) {
        if (!resolvedPayroll.has(payroll)) resolvedPayroll.set(payroll, (await reader.workerIds.getWorkerIdByTypeAndValue(payrollTypeId, payroll))?.workerId ?? null);
        payrollWorker = resolvedPayroll.get(payroll) ?? null;
        if (resolution?.worker && payrollWorker && resolution.worker.id !== payrollWorker) {
          throw new TaxIdentityReviewError("Tax identifier and Person Number match different workers. Ask staff to correct the row.");
        }
        if (resolution?.identity.kind === "ssn" && payrollWorker && !resolution.worker) {
          const worker = await reader.workers.getWorker(payrollWorker);
          if (worker?.ssn && validateSSN(worker.ssn).parsed !== resolution.identity.value) {
            throw new TaxIdentityReviewError("Person Number and submitted SSN disagree. Ask staff to review the identity.");
          }
        }
        const keys = payrollKeys.get(payroll) ?? new Set<string>();
        if (resolution) keys.add(resolution.key);
        payrollKeys.set(payroll, keys);
        if (resolution) {
          const claims = taxPayroll.get(resolution.key) ?? [];
          claims.push({ index, target: payrollWorker || `payroll:${payroll}` });
          taxPayroll.set(resolution.key, claims);
        }
      }
      const key = payrollWorker || resolution?.worker?.id || resolution?.key || (payroll ? `payroll:${payroll}` : null);
      if (!key) throw new TaxIdentityReviewError("Supply an SSN or Person Number before importing this worker.");
      const group = groups.get(key) ?? [];
      group.push({ index, name: String(row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ")).trim().toLowerCase().replace(/\s+/g, " "),
        birth: String(row.dateOfBirth || row.birthDate || "").trim() });
      groups.set(key, group);
    } catch (error) {
      errors.set(index, error instanceof TaxIdentityReviewError ? error.message : "Identity lookup failed. Retry validation before processing.");
    }
  }
  for (const group of groups.values()) {
    if (new Set(group.map(row => row.name).filter(Boolean)).size > 1 || new Set(group.map(row => row.birth).filter(Boolean)).size > 1) {
      for (const row of group) errors.set(row.index, "Rows sharing an identifier disagree on name or birth date. Correct them and validate again.");
    }
  }
  for (const [payroll, keys] of payrollKeys) if (keys.size > 1) {
    rows.forEach((row, index) => { if (String(row.personNumber) === payroll) errors.set(index, "Rows sharing a Person Number disagree on tax identity. Correct them and validate again."); });
  }
  for (const claims of taxPayroll.values()) if (new Set(claims.map(claim => claim.target)).size > 1) {
    for (const claim of claims) errors.set(claim.index, "Rows sharing a tax identifier disagree on Person Number. Correct them before processing.");
  }
  return errors;
}
