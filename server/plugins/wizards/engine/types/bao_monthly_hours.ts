import { FeedConfig, FeedData, createMonthlyDateRange, getCurrentMonth, FeedField, ValidationError } from '../feed.js';
import { WizardStep } from '../base.js';
import { GbhetLegalWorkersWizard } from './gbhet_legal_workers.js';
import { storage } from '../../../../storage/index.js';
import { WITHHOLDING_CONSUMED } from '../../../../storage/sitespecific/bao/withholding-allocations.js';
import { logger } from '../../../../logger.js';
import { resolveBaoThreshold, lastDayOfMonthYmd } from '../../../trust/eligibility/plugins/bao-shared.js';
import { isStatusBilled } from '../../../ledger/charge/plugins/sitespecific-bao-hourly.js';
import { withChargeConfigCache } from '../../../../middleware/request-context.js';
import { withChargeBatchCollector } from '../../../ledger/charge/charge-batch.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** True when a YYYY-MM-DD string names a real calendar date (no rollover). */
export function isRealCalendarYmd(ymd: string): boolean {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(year, month, 0).getDate();
}

function normalizeStatus(value: string): string {
  return String(value).toLowerCase().replace(/\s+/g, '');
}

/** Day-of-month used for the (earlier) Active row when an FMLA month is split. */
export const FMLA_SPLIT_ACTIVE_DAY = 1;
/** Day-of-month used for the FMLA top-up row (later, so the timeline reads "went on FMLA"). */
export const FMLA_SPLIT_FMLA_DAY = 15;

export interface FmlaSplit {
  /** True when the month should be recorded as two rows (Active + FMLA top-up). */
  split: boolean;
  /** Hours recorded as Active (the reported amount when splitting). */
  activeHours: number;
  /** FMLA top-up hours (threshold − reported); 0 when not splitting. */
  fmlaHours: number;
}

/**
 * Pure FMLA split math: an FMLA-status month with reported hours > 0 is
 * split into Active (as reported) + FMLA (top-up to the worker's threshold)
 * ONLY when the threshold resolved and the reported hours fall short of it.
 * At/over threshold, unresolvable threshold, or non-positive hours → record
 * as reported (no split, never a negative top-up).
 */
export function computeFmlaSplit(reportedHours: number, threshold: number, thresholdResolved: boolean): FmlaSplit {
  if (!thresholdResolved || !isFinite(reportedHours) || reportedHours <= 0 || !isFinite(threshold) || threshold <= reportedHours) {
    return { split: false, activeHours: 0, fmlaHours: 0 };
  }
  return { split: true, activeHours: reportedHours, fmlaHours: threshold - reportedHours };
}

/** Parse a withholding value the way processing does ($ and commas stripped). */
export function parseWithholdingAmount(raw: unknown): number {
  return typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[$,]/g, ''));
}

export interface PreviewWorkerRow {
  rowIndex: number;
  ssnMasked: string;
  name: string | null;
  workerId: string | null;
  statusName: string;
  reportedHours: number;
  activeHours: number;
  fmlaHours: number;
  totalHours: number;
  fmlaSplit: boolean;
  threshold: number | null;
  billedAmount: string;
  withholdingAmount: string | null;
  notes: string[];
}

export interface PreviewResults {
  year: number;
  month: number;
  withholdingMapped: boolean;
  workers: PreviewWorkerRow[];
  totals: {
    workers: number;
    reportedHours: number;
    activeHours: number;
    fmlaHours: number;
    totalHours: number;
    billedAmount: string;
    withholdingTotal: string | null;
  };
  completedAt: string;
}

/**
 * BAO Monthly Hours Upload wizard engine.
 *
 * Extends the GBHET legal-workers feed engine (SSN normalization + warning
 * demotion, employment-status mapping, hours upsert, work-status sync,
 * contact-info processing) with BAO-specific behavior:
 *
 * - NO benefit-eligibility fields (no WMB creation — the parent's
 *   `processWorkerBenefits` is inherited but inert because `benefitConfig`
 *   is never populated for this wizard type).
 * - Address (line 1, city, state, postal code), phone number, and date of
 *   birth are REQUIRED for every row.
 * - Optional "Employee Withholding Amount" column: when mapped and non-zero,
 *   a stored withholding ALLOCATION is recorded per worker (the worker's EA
 *   on the BAO fund account — from the enabled `bao-hourly` charge plugin
 *   config — is ensured at upload time). No ledger money moves at upload;
 *   worker-side credits are created when an employer payment is posted with
 *   this upload selected as its allocation source (charge plugin
 *   `bao-er-report-to-ee-allocation`). Idempotent per upload+worker; blocked
 *   once the upload's allocations are consumed by a payment.
 * - New-worker creation is reviewed (optionally) in the Verify step:
 *   `canCreateWorker` blocks creation only for rows explicitly rejected in
 *   `wizard.data.newWorkerDecisions`; unreviewed rows are created with a
 *   warning attached to the row result.
 */
export class BaoMonthlyHoursWizard extends GbhetLegalWorkersWizard {
  name = 'bao_monthly_hours';
  displayName = 'BAO Monthly Hours Upload';
  description = 'Monthly hours upload for a BAO employer';
  isMonthly = true;

  getFields(): FeedField[] {
    const parentFields = super.getFields();
    const dropped = new Set(['benefit_1', 'benefit_2', 'benefit_3', 'benefit_4', 'benefit_5']);
    const requiredOverrides = new Set([
      'dateOfBirth',
      'phoneNumber',
      'addressLine1',
      'city',
      'state',
      'postalCode',
    ]);

    const fields = parentFields
      .filter((f) => !dropped.has(f.id))
      .map((f) => {
        if (requiredOverrides.has(f.id)) {
          return {
            ...f,
            required: true,
            description: (f.description || f.name).replace(/\s*\(optional\)\s*$/i, ''),
          };
        }
        return f;
      });

    fields.push({
      id: 'withholdingAmount',
      name: 'Employee Withholding Amount',
      type: 'number',
      required: false,
      description:
        'Optional dollar amount withheld from the employee, recorded as a payment allocated on the worker\u2019s behalf for the work month',
      displayOrder: 16,
    });

    return fields;
  }

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload data file' },
      { id: 'map', name: 'Map', description: 'Map fields to schema' },
      { id: 'validate', name: 'Validate', description: 'Validate data integrity' },
      { id: 'verify', name: 'Verify New Workers', description: 'Confirm or reject creation of unknown-SSN workers' },
      { id: 'preview', name: 'Preview', description: 'Preview per-worker hours, billing, and withholding before processing' },
      { id: 'process', name: 'Process', description: 'Process and transform data' },
      { id: 'review', name: 'Review', description: 'Review results' },
    ];
  }

  /**
   * Stricter validation: fully parse date and amount fields that would
   * otherwise only fail during the Process step, so a run that passes
   * Validate does not die mid-processing on data-format issues.
   */
  async validateRow(row: Record<string, any>, rowIndex: number, mode: 'create' | 'update'): Promise<ValidationError[]> {
    const errors = await super.validateRow(row, rowIndex, mode);

    // Date of birth must actually PARSE (the parent only checks presence).
    const rawDob = row.dateOfBirth;
    if (rawDob !== undefined && rawDob !== null && String(rawDob).trim() !== '') {
      try {
        const ymd = this.parseDate(rawDob);
        // parseDate is lenient (JS Date rolls 2/30 → 3/2 and passes
        // YYYY-MM-DD through untouched); require a REAL calendar date whose
        // components round-trip exactly so a rolled-over date can't be
        // silently persisted as a different valid date.
        if (ymd !== null) {
          if (!isRealCalendarYmd(ymd)) {
            throw new Error(`Invalid calendar date: ${rawDob}`);
          }
          // Extract the ORIGINAL components for every textual format the
          // parser accepts (M/D/YYYY, M-D-YYYY, YYYY/MM/DD, YYYY-MM-DD) and
          // require them to match the normalized output exactly.
          const s = String(rawDob).trim();
          let y: number | null = null, mo = 0, d = 0;
          let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (m) { y = parseInt(m[3], 10); mo = parseInt(m[1], 10); d = parseInt(m[2], 10); }
          else if ((m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/))) {
            y = parseInt(m[1], 10); mo = parseInt(m[2], 10); d = parseInt(m[3], 10);
          }
          if (y !== null && `${y}-${pad2(mo)}-${pad2(d)}` !== ymd) {
            throw new Error(`Invalid calendar date: ${rawDob}`);
          }
        }
      } catch (err) {
        errors.push({
          rowIndex,
          field: 'dateOfBirth',
          message: err instanceof Error ? err.message : 'Invalid date format',
          value: rawDob,
        });
      }
    }

    // Withholding amount must parse the same way processing parses it
    // ($ and commas allowed) and cannot be negative. Remove any parent
    // "must be a number" error for values processing would accept.
    const rawWh = row.withholdingAmount;
    if (rawWh !== undefined && rawWh !== null && String(rawWh).trim() !== '') {
      const amount = parseWithholdingAmount(rawWh);
      for (let i = errors.length - 1; i >= 0; i--) {
        if (errors[i].field === 'withholdingAmount' && isFinite(amount) && amount >= 0) {
          errors.splice(i, 1);
        }
      }
      if (!isFinite(amount)) {
        errors.push({
          rowIndex,
          field: 'withholdingAmount',
          message: `Invalid withholding amount: ${rawWh}`,
          value: rawWh,
        });
      } else if (amount < 0) {
        errors.push({
          rowIndex,
          field: 'withholdingAmount',
          message: `Withholding amount cannot be negative: ${rawWh}`,
          value: rawWh,
        });
      }
    }

    // Hours must be a finite number (blank was already coerced to 0 by the
    // parent) and cannot be negative.
    const rawHours = row.numberOfHours;
    if (rawHours !== undefined && rawHours !== null && String(rawHours).trim() !== '') {
      const hours = typeof rawHours === 'number' ? rawHours : parseFloat(String(rawHours));
      if (isFinite(hours) && hours < 0) {
        errors.push({
          rowIndex,
          field: 'numberOfHours',
          message: `Number of Hours cannot be negative: ${rawHours}`,
          value: rawHours,
        });
      }
    }

    return errors;
  }

  /** True when this employment-status option is the FMLA status. */
  private isFmlaOption(option: { name: string; code: string }): boolean {
    return normalizeStatus(option.name) === 'fmla' || normalizeStatus(option.code || '') === 'fmla';
  }

  /** Find the "Active" employment-status option (by name, falling back to code `default`). */
  private async findActiveOption(): Promise<{ id: string; name: string; code: string; employed: boolean } | undefined> {
    const options = await this.getEmploymentStatusOptions();
    return (
      options.find((o) => normalizeStatus(o.name) === 'active') ||
      options.find((o) => normalizeStatus(o.code || '') === 'active') ||
      options.find((o) => normalizeStatus(o.code || '') === 'default')
    );
  }

  /**
   * Resolve the FMLA split for a worker-month: threshold as-of the last day
   * of the reporting month via the shared BAO threshold resolution
   * (employer → industry → member status). Unresolvable threshold → no split.
   */
  private async resolveFmlaSplit(
    workerId: string,
    employerId: string,
    year: number,
    month: number,
    reportedHours: number,
  ): Promise<FmlaSplit & { threshold: number | null }> {
    const asOfYmd = lastDayOfMonthYmd(year, month);
    const { threshold, resolved } = await resolveBaoThreshold(workerId, employerId, asOfYmd, 0);
    const split = computeFmlaSplit(reportedHours, threshold, resolved);
    return { ...split, threshold: resolved ? threshold : null };
  }

  /**
   * Per-wizardId cache of existing (employer, year, month) hours rows,
   * pre-fetched once before the processing loop begins. The `dirty` set
   * tracks workers that have already had reconcile+upsert run during this
   * pass; a duplicate SSN whose worker is dirty gets a fresh targeted query
   * so it sees rows written by its first occurrence. Keyed by wizardId so
   * concurrent uploads don't collide. Cleared in `processFeedData` finally.
   */
  private readonly _monthHoursRunCache = new Map<
    string,
    {
      rows: Map<string, Array<{ id: string; day: number }>>;
      dirty: Set<string>;
    }
  >();

  /**
   * Mark a worker as having been fully processed (reconcile + upsert done)
   * within the current run so its next reconcile re-queries actual DB state.
   */
  private _markWorkerDirty(wizardId: string | undefined, workerId: string): void {
    if (wizardId) {
      this._monthHoursRunCache.get(wizardId)?.dirty.add(workerId);
    }
  }

  /**
   * Reconcile the full worker/employer/month row set: delete every existing
   * hours row whose day is not in `keepDays` (stale FMLA top-ups, legacy
   * multi-day/manual rows) BEFORE the upserts write the intended rows, so the
   * month never carries duplicate hours. `deleteWorkerHours` executes the
   * charge plugins with hours:0 for each removed row, reversing its charges.
   *
   * Cache usage during a run:
   * - First occurrence of a worker: O(1) lookup in the pre-fetch cache.
   * - Duplicate SSN (worker already dirty): issues a targeted
   *   `getWorkerHoursForMonth` query so it sees rows written by the earlier
   *   occurrence — far cheaper than the original full scan but correct.
   * - No cache (called outside a run): targeted query as fallback.
   * - New worker (absent from cache, not dirty): treated as having no prior
   *   rows — correct since none exist yet.
   */
  private async reconcileMonthRows(
    workerId: string,
    employerId: string,
    year: number,
    month: number,
    keepDays: number[],
    wizardId?: string,
  ): Promise<void> {
    const keep = new Set(keepDays);

    const runCache = wizardId ? this._monthHoursRunCache.get(wizardId) : undefined;
    let existingRows: Array<{ id: string; day: number }>;

    if (runCache) {
      if (runCache.dirty.has(workerId)) {
        // Duplicate SSN: re-query to see rows written by the earlier
        // occurrence and refresh the cache entry for subsequent deletes.
        existingRows = await storage.workerHours.getWorkerHoursForMonth(workerId, employerId, year, month);
        runCache.rows.set(workerId, existingRows.slice());
      } else {
        // First occurrence: use the O(1) pre-fetch snapshot.
        existingRows = runCache.rows.get(workerId) ?? [];
      }
    } else {
      // No run cache (outside processFeedData): targeted query, never the
      // expensive all-employers/all-months full scan.
      existingRows = await storage.workerHours.getWorkerHoursForMonth(workerId, employerId, year, month);
    }

    const stale = existingRows.filter((r) => !keep.has(r.day ?? 1));
    for (const r of stale) {
      await storage.workerHours.deleteWorkerHours(r.id);
      // Keep the in-memory cache coherent within this reconcile call.
      if (runCache) {
        const workerRows = runCache.rows.get(workerId);
        if (workerRows) {
          const idx = workerRows.findIndex((x) => x.id === r.id);
          if (idx >= 0) workerRows.splice(idx, 1);
        }
      }
    }
  }

  /**
   * FMLA split: a row whose status resolves to FMLA with reported hours > 0
   * becomes TWO hours rows — the reported amount as Active (dated day 1) plus
   * an FMLA row topping up to the worker's threshold (dated day 15) — so
   * billing can distinguish Active vs FMLA hours per fund. When the reported
   * hours already meet/exceed the threshold, the threshold can't be resolved,
   * or no Active status option exists, the month is recorded as reported
   * (single row, parent behavior) and any stale top-up row is removed.
   */
  protected async processWorkerHours(workerId: string, row: Record<string, any>, wizard: any): Promise<void> {
    const employerId = wizard.entityId;
    const wizardData = (wizard.data as any) || {};
    const launchArguments = wizardData.launchArguments || {};
    const year = typeof launchArguments.year === 'number' ? launchArguments.year : parseInt(String(launchArguments.year), 10);
    const month = typeof launchArguments.month === 'number' ? launchArguments.month : parseInt(String(launchArguments.month), 10);

    const rawHours = row.numberOfHours;
    const isBlankHours = rawHours === undefined || rawHours === null || rawHours === '';
    const hours = isBlankHours ? 0 : typeof rawHours === 'number' ? rawHours : parseFloat(String(rawHours));

    // Decide whether the FMLA split applies; anything unusual falls back to
    // the parent's single-row behavior (which re-validates everything).
    let splitPlan:
      | { activeOption: { id: string }; fmlaOption: { id: string; name: string; code: string; employed: boolean }; activeHours: number; fmlaHours: number }
      | null = null;
    if (
      employerId &&
      isFinite(year) &&
      isFinite(month) &&
      isFinite(hours) &&
      hours > 0 &&
      row.employmentStatus
    ) {
      const option = await this.resolveEmploymentStatusOption(row.employmentStatus);
      if (option && this.isFmlaOption(option)) {
        const split = await this.resolveFmlaSplit(workerId, employerId, year, month, hours);
        if (split.split) {
          const activeOption = await this.findActiveOption();
          if (activeOption) {
            splitPlan = { activeOption, fmlaOption: option, activeHours: split.activeHours, fmlaHours: split.fmlaHours };
          } else {
            logger.warn('BAO FMLA split skipped: no Active employment-status option found', {
              service: 'wizard-bao-monthly-hours',
              wizardId: wizard.id,
              workerId,
            });
          }
        }
      }
    }

    // Mark dirty in a finally so that even a partial write (upserts completed
    // but syncWorkStatusFromEmployment or another later step throws) leaves
    // the worker marked dirty. Any subsequent duplicate-SSN row then
    // re-queries current DB state rather than reading the stale pre-fetch
    // snapshot, preventing leftover FMLA top-up rows.
    try {
      if (!splitPlan) {
        // Record as reported (single day-1 row) and remove every other row in
        // the month (e.g. a stale FMLA top-up from a prior split upload).
        if (employerId && isFinite(year) && isFinite(month)) {
          await this.reconcileMonthRows(workerId, employerId, year, month, [FMLA_SPLIT_ACTIVE_DAY], wizard.id);
        }
        await super.processWorkerHours(workerId, row, wizard);
        return;
      }

      const jobTitle = row.jobTitle?.toString().trim() || null;

      // Only the day-1 Active and day-15 FMLA rows may survive for the month.
      await this.reconcileMonthRows(workerId, employerId, year, month, [FMLA_SPLIT_ACTIVE_DAY, FMLA_SPLIT_FMLA_DAY], wizard.id);

      // Active row (reported hours), dated earlier in the month.
      // skipHomeEmployerEvent: FMLA splits never set the `home` flag, so the
      // 2 × deriveHomeEmployerId queries per upsert are always a no-op.
      await storage.workerHours.upsertWorkerHours({
        workerId,
        employerId,
        employmentStatusId: splitPlan.activeOption.id,
        year,
        month,
        day: FMLA_SPLIT_ACTIVE_DAY,
        hours: splitPlan.activeHours,
        jobTitle,
      }, { skipHomeEmployerEvent: true });

      // FMLA top-up row, dated later so the timeline shows the FMLA transition.
      await storage.workerHours.upsertWorkerHours({
        workerId,
        employerId,
        employmentStatusId: splitPlan.fmlaOption.id,
        year,
        month,
        day: FMLA_SPLIT_FMLA_DAY,
        hours: splitPlan.fmlaHours,
        jobTitle,
      }, { skipHomeEmployerEvent: true });

      logger.info('BAO FMLA split recorded', {
        service: 'wizard-bao-monthly-hours',
        wizardId: wizard.id,
        workerId,
        year,
        month,
        activeHours: splitPlan.activeHours,
        fmlaHours: splitPlan.fmlaHours,
      });

      // Work status syncs from the REPORTED (FMLA) status.
      await this.syncWorkStatusFromEmployment(workerId, splitPlan.fmlaOption, year, month);
    } finally {
      // Always mark dirty after any reconcile/write attempt, successful or
      // not, so duplicate-SSN rows always re-read current DB state.
      this._markWorkerDirty(wizard.id, workerId);
    }
  }

  /**
   * Read-only Preview computation: per-worker hour totals with the
   * Active/FMLA breakout after the FMLA bump, the amount that WOULD be
   * billed (effective employer rates × billed-status rules of the enabled
   * `bao-hourly` charge configs), and the expected employee withholding when
   * that column is mapped. Persists nothing.
   */
  async computePreview(wizardId: string): Promise<PreviewResults> {
    const { wizard, wizardData, mappedRows } = await this.loadMappedRows(wizardId);
    const employerId = wizard.entityId;
    if (!employerId) {
      throw new Error('Wizard is not linked to an employer');
    }
    const launchArguments = (wizardData || {}).launchArguments || {};
    const year = typeof launchArguments.year === 'number' ? launchArguments.year : parseInt(String(launchArguments.year), 10);
    const month = typeof launchArguments.month === 'number' ? launchArguments.month : parseInt(String(launchArguments.month), 10);
    if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) {
      throw new Error('Year and month are required in wizard launch arguments');
    }

    const columnMapping = (wizardData?.columnMapping || {}) as Record<string, string>;
    const withholdingMapped =
      Object.values(columnMapping).includes('withholdingAmount') ||
      Object.keys(columnMapping).includes('withholdingAmount');

    // Billing configs: enabled bao-hourly configs with an account; employer
    // configs override globals targeting the same account (matches the charge
    // executor's merge).
    type ChargeSub = { account?: string | null; employerId?: string | null } | null;
    const allConfigs = await storage.pluginConfigs.search('charge', { pluginId: 'bao-hourly', enabled: true });
    const withAccount = allConfigs.filter((c) => (c.subsidiary as ChargeSub)?.account);
    const employerConfigs = withAccount.filter((c) => (c.subsidiary as ChargeSub)?.employerId === employerId);
    const globalConfigs = withAccount.filter((c) => !(c.subsidiary as ChargeSub)?.employerId);
    const overriddenAccounts = new Set(employerConfigs.map((c) => (c.subsidiary as ChargeSub)!.account));
    const billingConfigs = [
      ...employerConfigs,
      ...globalConfigs.filter((c) => !overriddenAccounts.has((c.subsidiary as ChargeSub)!.account)),
    ].map((c) => ({
      account: (c.subsidiary as ChargeSub)!.account as string,
      settings: ((c.config as any).data ?? {}) as { billedEmploymentStatusIds?: string[]; nonBilledEmploymentStatusIds?: string[] },
    }));

    // Effective-rate cache keyed by account + as-of date.
    const rateCache = new Map<string, number>();
    const getRate = async (account: string, asOfYmd: string): Promise<number> => {
      const key = `${account}|${asOfYmd}`;
      if (rateCache.has(key)) return rateCache.get(key)!;
      const rateRow = await storage.baoEmployerRates.getEffectiveRate(employerId, account, asOfYmd);
      const rate = rateRow ? parseFloat(rateRow.rate) : 0;
      const value = Number.isFinite(rate) ? rate : 0;
      rateCache.set(key, value);
      return value;
    };

    const billFor = async (statusId: string, hours: number, day: number): Promise<number> => {
      if (!hours) return 0;
      const asOfYmd = `${year}-${pad2(month)}-${pad2(day)}`;
      let total = 0;
      for (const cfg of billingConfigs) {
        if (!isStatusBilled(cfg.settings, statusId)) continue;
        total += hours * (await getRate(cfg.account, asOfYmd));
      }
      return total;
    };

    // Bulk-resolve every SSN in the file in ONE query (previously one
    // worker lookup per row).
    const allSsns = mappedRows
      .map((r) => r.ssn?.toString().trim())
      .filter((s): s is string => !!s);
    const workersBySsn = await storage.workers.getWorkersBySSNs(allSsns);

    return this.runWithEmployerStatusContext(employerId, async () => {
      const bySsn = new Map<string, PreviewWorkerRow>();

      for (let i = 0; i < mappedRows.length; i++) {
        const row = mappedRows[i];
        const rawSsn = row.ssn?.toString().trim();
        const digits = (rawSsn || '').replace(/\D/g, '');
        const padded = digits.length > 0 && digits.length <= 9 ? digits.padStart(9, '0') : null;
        const key = padded ?? `row-${i}`;

        const notes: string[] = [];
        if (bySsn.has(key)) {
          notes.push('Duplicate SSN in file — later row replaces earlier one (matches processing behavior)');
        }

        const name = [row.firstName, row.lastName].map((v) => v?.toString().trim()).filter(Boolean).join(' ') || null;
        const ssnMasked = padded ? `***-**-${padded.slice(-4)}` : '(invalid SSN)';

        const rawHours = row.numberOfHours;
        const isBlankHours = rawHours === undefined || rawHours === null || rawHours === '';
        const reportedHours = isBlankHours ? 0 : typeof rawHours === 'number' ? rawHours : parseFloat(String(rawHours));
        const hours = isFinite(reportedHours) ? reportedHours : 0;

        const option = row.employmentStatus ? await this.resolveEmploymentStatusOption(row.employmentStatus) : undefined;
        const statusName = option?.name ?? String(row.employmentStatus ?? '');
        if (!option) {
          notes.push(`Employment status "${row.employmentStatus}" could not be resolved`);
        }

        const worker = padded ? workersBySsn.get(padded) : undefined;
        const workerId = worker?.id ?? null;
        if (!worker) {
          notes.push('New worker (will be created during processing)');
        }

        // FMLA split (mirrors processing exactly).
        let activeHours = 0;
        let fmlaHours = 0;
        let fmlaSplit = false;
        let threshold: number | null = null;
        let billedAmount = 0;

        if (option && this.isFmlaOption(option) && hours > 0) {
          if (worker) {
            const split = await this.resolveFmlaSplit(worker.id, employerId, year, month, hours);
            threshold = split.threshold;
            if (split.split && (await this.findActiveOption())) {
              fmlaSplit = true;
              activeHours = split.activeHours;
              fmlaHours = split.fmlaHours;
            }
          }
          if (!fmlaSplit) {
            if (threshold === null) {
              // A brand-new worker is created by processing with NO
              // member-status history, so resolveBaoThreshold cannot resolve
              // and processing deterministically records hours as reported —
              // this preview matches that exactly.
              notes.push(
                worker
                  ? 'FMLA threshold could not be resolved — hours will be recorded as reported'
                  : 'New worker has no member-status history, so no FMLA threshold can resolve — hours will be recorded as reported (no split)',
              );
            } else {
              notes.push('Reported FMLA hours meet or exceed the threshold — recorded as reported');
            }
          }
        }

        if (fmlaSplit && option) {
          const activeOption = (await this.findActiveOption())!;
          billedAmount =
            (await billFor(activeOption.id, activeHours, FMLA_SPLIT_ACTIVE_DAY)) +
            (await billFor(option.id, fmlaHours, FMLA_SPLIT_FMLA_DAY));
        } else if (option) {
          billedAmount = await billFor(option.id, hours, 1);
        }

        // Withholding (only when the column is mapped and the value parses).
        let withholdingAmount: string | null = null;
        if (withholdingMapped) {
          const rawWh = row.withholdingAmount;
          if (rawWh !== undefined && rawWh !== null && String(rawWh).trim() !== '') {
            const amount = parseWithholdingAmount(rawWh);
            if (isFinite(amount) && amount >= 0) {
              withholdingAmount = amount.toFixed(2);
            } else {
              notes.push(`Invalid withholding amount: ${rawWh}`);
            }
          }
        }

        const totalHours = fmlaSplit ? activeHours + fmlaHours : hours;
        bySsn.set(key, {
          rowIndex: i,
          ssnMasked,
          name,
          workerId,
          statusName,
          reportedHours: hours,
          activeHours: fmlaSplit ? activeHours : hours,
          fmlaHours,
          totalHours,
          fmlaSplit,
          threshold,
          billedAmount: billedAmount.toFixed(2),
          withholdingAmount,
          notes,
        });
      }

      const workers = Array.from(bySsn.values()).sort((a, b) => a.rowIndex - b.rowIndex);
      const sum = (fn: (w: PreviewWorkerRow) => number) => workers.reduce((acc, w) => acc + fn(w), 0);
      const withholdingTotal = withholdingMapped
        ? sum((w) => (w.withholdingAmount ? parseFloat(w.withholdingAmount) : 0)).toFixed(2)
        : null;

      return {
        year,
        month,
        withholdingMapped,
        workers,
        totals: {
          workers: workers.length,
          reportedHours: sum((w) => w.reportedHours),
          activeHours: sum((w) => w.activeHours),
          fmlaHours: sum((w) => w.fmlaHours),
          totalHours: sum((w) => w.totalHours),
          billedAmount: sum((w) => parseFloat(w.billedAmount)).toFixed(2),
          withholdingTotal,
        },
        completedAt: new Date().toISOString(),
      };
    });
  }

  async generateFeed(config: FeedConfig, data: any): Promise<FeedData> {
    const launchArgs = data.launchArguments || {};
    const { year, month } =
      launchArgs.year && launchArgs.month
        ? { year: launchArgs.year, month: launchArgs.month }
        : data.period || getCurrentMonth();

    const dateRange = createMonthlyDateRange(year, month);
    const recordCount = await this.getRecordCount({ dateRange });

    return {
      recordCount,
      generatedAt: new Date(),
      filters: { year, month },
      outputPath: this.formatOutputFilename(`bao_monthly_hours_${year}_${month}`, config.outputFormat || 'csv'),
    };
  }

  async generateRecords(_year: number, _month: number): Promise<any[]> {
    return [];
  }

  /**
   * Override to bulk-pre-fetch existing hours for the upload's
   * (employer, year, month) before the row loop begins, so every
   * `reconcileMonthRows` call during the loop reads from the in-memory cache
   * rather than issuing an individual DB query per worker. The cache is
   * stored in `_monthHoursRunCache` keyed by wizardId and cleared in a
   * finally block once the run finishes, even on errors.
   *
   * Why this is safe: the pre-fetch snapshot is taken before any writes;
   * the cache is updated as stale rows are deleted (so a duplicate SSN in
   * the file sees an already-reconciled state on its second pass). New
   * workers simply have no cache entry — correct, since they have no prior
   * rows to remove.
   */
  async processFeedData(
    wizardId: string,
    batchSize: number = 100,
    onProgress?: (progress: {
      processed: number;
      total: number;
      createdCount: number;
      updatedCount: number;
      successCount: number;
      failureCount: number;
      currentRow?: { index: number; status: 'success' | 'error'; error?: string };
      phase?: string;
      phaseMessage?: string;
    }) => void,
  ): Promise<import('../feed.js').ProcessResults> {
    // Pull enough wizard state to pre-fetch.
    const wizard = await storage.wizards.getById(wizardId);
    const employerId = wizard?.entityId;
    if (employerId) {
      const launchArguments = ((wizard?.data as any) || {}).launchArguments || {};
      const year =
        typeof launchArguments.year === 'number'
          ? launchArguments.year
          : parseInt(String(launchArguments.year), 10);
      const month =
        typeof launchArguments.month === 'number'
          ? launchArguments.month
          : parseInt(String(launchArguments.month), 10);
      if (isFinite(year) && isFinite(month) && month >= 1 && month <= 12) {
        // One query for all workers in this (employer, year, month) — replaces
        // the 500 individual getWorkerHours(workerId) full-scans that the old
        // reconcileMonthRows called per row.
        const bulk = await storage.workerHours.getWorkerHoursForEmployerMonth(employerId, year, month);
        this._monthHoursRunCache.set(wizardId, { rows: bulk, dirty: new Set() });
      }
    }
    try {
      // withChargeBatchCollector defers all ledger entry INSERTs produced by
      // executeChargePlugins during the loop into a single bulk INSERT at the
      // end, replacing N per-row writes with one statement. withChargeConfigCache
      // is already installed by gbhet_legal_workers.processFeedData (the parent
      // override) when this BAO subclass override delegates to super, but we
      // also install it here so the BAO-only path (when called directly) is
      // equally optimized.
      return await withChargeConfigCache(() =>
        withChargeBatchCollector(() => super.processFeedData(wizardId, batchSize, onProgress)),
      );
    } finally {
      this._monthHoursRunCache.delete(wizardId);
    }
  }

  /**
   * Feed-processing hook (duck-typed from `processFeedData`): gate creation
   * of a worker whose SSN is unknown. Decisions are keyed by the SSN's
   * digits. An explicit "reject" in the Verify step still blocks creation
   * (throw = row fails); an unreviewed row is created anyway but carries a
   * warning (returned string) so the operator can see it in the results —
   * especially when Verify surfaced possible existing-worker matches.
   */
  protected async canCreateWorker(ssn: string, _row: Record<string, any>, wizard: any): Promise<string | void> {
    const digits = String(ssn || '').replace(/\D/g, '');
    const data = (wizard.data as any) || {};
    const decisions = (data.newWorkerDecisions || {}) as Record<string, string>;
    const decision = decisions[digits];
    if (decision === 'confirm') return;
    if (decision === 'reject') {
      throw new Error('Worker creation was rejected in the Verify New Workers step');
    }
    // Not reviewed: create anyway, but warn — and call out near-match
    // candidates from the Verify scan when we have them.
    const verifyRows = (data.verifyNewWorkers?.rows || []) as Array<{
      ssnDigits?: string;
      candidates?: Array<{ displayName?: string | null; siriusId?: number | null }>;
    }>;
    const verifyRow = verifyRows.find((r) => r.ssnDigits === digits);
    const candidates = verifyRow?.candidates || [];
    if (candidates.length > 0) {
      const names = candidates
        .slice(0, 3)
        .map((c) => c.displayName || (c.siriusId != null ? `#${c.siriusId}` : 'unknown'))
        .join(', ');
      return `warning: new worker created without review — possible existing match(es): ${names}`;
    }
    return 'warning: new worker created without review in the Verify New Workers step';
  }

  /**
   * Per-wizard-run memo of the withholding fund-account resolution (the
   * wizard object identity is stable for the duration of one processFeedData
   * run). Stores the settled promise so a resolution error re-throws
   * identically for every row.
   */
  private withholdingAccountMemo = new WeakMap<object, Promise<string>>();

  /**
   * Fund account: taken from the enabled BAO hourly charge-plugin config.
   * Prefer a config scoped to THIS employer; fall back to a global config.
   * Ambiguity (multiple candidates at the winning scope) is an explicit
   * error rather than a silent first-match pick.
   */
  private resolveWithholdingAccountId(wizard: object, employerId: string): Promise<string> {
    const memo = this.withholdingAccountMemo.get(wizard);
    if (memo) return memo;
    const promise = (async () => {
      const configs = await storage.pluginConfigs.search('charge', {
        pluginId: 'bao-hourly',
        enabled: true,
      });
      type ChargeSub = { account?: string | null; scope?: string | null; employerId?: string | null } | null;
      const withAccount = configs.filter((c) => (c.subsidiary as ChargeSub)?.account);
      const employerScoped = withAccount.filter(
        (c) => (c.subsidiary as ChargeSub)?.employerId === employerId,
      );
      const globalScoped = withAccount.filter(
        (c) => !(c.subsidiary as ChargeSub)?.employerId,
      );
      const candidates = employerScoped.length > 0 ? employerScoped : globalScoped;
      if (candidates.length === 0) {
        throw new Error(
          'No enabled BAO Hourly charge plugin config with a ledger account applies to this employer; configure one before uploading withholding amounts',
        );
      }
      if (candidates.length > 1) {
        throw new Error(
          'Multiple enabled BAO Hourly charge plugin configs with ledger accounts apply to this employer; disambiguate the configs before uploading withholding amounts',
        );
      }
      return (candidates[0].subsidiary as ChargeSub)!.account as string;
    })();
    // Avoid an unhandled-rejection warning when a row is never processed
    // after a failed resolution.
    promise.catch(() => {});
    this.withholdingAccountMemo.set(wizard, promise);
    return promise;
  }

  /**
   * Feed-processing hook (duck-typed from `processFeedData`): record the
   * optional Employee Withholding Amount as a stored withholding ALLOCATION
   * (upload/worker/month/worker-EA/amount). The worker's EA is ensured at
   * upload time; no ledger payment or entry is created here. Idempotent per
   * upload+worker; once a payment has consumed this upload's allocations,
   * any change is rejected with a clear per-row error.
   */
  protected async processWorkerPayments(workerId: string, row: Record<string, any>, wizard: any): Promise<void> {
    const raw = row.withholdingAmount;
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return;
    }

    const amount = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[$,]/g, ''));
    if (!isFinite(amount)) {
      throw new Error(`Invalid withholding amount: ${raw}`);
    }
    if (amount < 0) {
      throw new Error(`Withholding amount cannot be negative: ${raw}`);
    }

    const launchArguments = ((wizard.data as any) || {}).launchArguments || {};
    const year = typeof launchArguments.year === 'number' ? launchArguments.year : parseInt(String(launchArguments.year), 10);
    const month = typeof launchArguments.month === 'number' ? launchArguments.month : parseInt(String(launchArguments.month), 10);
    if (!isFinite(year) || !isFinite(month) || month < 1 || month > 12) {
      throw new Error('Year and month are required in wizard launch arguments for withholding processing');
    }

    const ym = `${year}-${pad2(month)}`;
    const statementYmd = `${ym}-01`;

    const employerId = wizard.entityId;
    if (!employerId) {
      throw new Error('Wizard is not linked to an employer');
    }
    // The fund-account resolution is invariant across a processing run, so
    // it is memoized per wizard object (one config search per run instead of
    // one per row with a withholding value). A resolution failure is cached
    // as a rejected promise so every row fails with the SAME error the
    // per-row search used to throw.
    const accountId = await this.resolveWithholdingAccountId(wizard, employerId);

    try {
      if (amount === 0) {
        // Withholding dropped to zero on re-upload: remove any stored
        // allocation (blocked when already consumed by a payment).
        await storage.baoWithholdingAllocations.removeForWizardWorker(wizard.id, workerId);
        return;
      }

      // Ensure the worker's EA exists at upload time, then upsert the stored
      // allocation. No ledger payment/entry is created here — money is only
      // recognized when an employer payment consumes this upload.
      const ea = await storage.ledger.ea.getOrCreate('worker', workerId, accountId);
      const amountStr = amount.toFixed(2);
      await storage.baoWithholdingAllocations.upsert({
        wizardId: wizard.id,
        employerId,
        year,
        month,
        workerId,
        workerEaId: ea.id,
        amount: amountStr,
        data: { ym, statementYmd },
      });
      logger.info('BAO withholding allocation stored', {
        service: 'wizard-bao-monthly-hours',
        wizardId: wizard.id,
        workerId,
        ym,
        amount: amountStr,
      });
    } catch (err) {
      if (err instanceof Error && err.message === WITHHOLDING_CONSUMED) {
        throw new Error(
          `This upload's withholding for ${ym} has already been consumed by a payment; ` +
            'void that payment before changing withholding amounts',
        );
      }
      throw err;
    }
  }
}

export const baoMonthlyHours = new BaoMonthlyHoursWizard();
