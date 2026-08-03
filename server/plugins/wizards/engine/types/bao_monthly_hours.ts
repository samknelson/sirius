import { FeedConfig, FeedData, createMonthlyDateRange, getCurrentMonth, FeedField } from '../feed.js';
import { WizardStep } from '../base.js';
import { GbhetLegalWorkersWizard } from './gbhet_legal_workers.js';
import { storage } from '../../../../storage/index.js';
import { WITHHOLDING_CONSUMED } from '../../../../storage/sitespecific/bao/withholding-allocations.js';
import { logger } from '../../../../logger.js';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
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
      { id: 'process', name: 'Process', description: 'Process and transform data' },
      { id: 'review', name: 'Review', description: 'Review results' },
    ];
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

    // Fund account: taken from the enabled BAO hourly charge-plugin config.
    // Prefer a config scoped to THIS employer; fall back to a global config.
    // Ambiguity (multiple candidates at the winning scope) is an explicit
    // error rather than a silent first-match pick.
    const employerId = wizard.entityId;
    if (!employerId) {
      throw new Error('Wizard is not linked to an employer');
    }
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
    const accountId = (candidates[0].subsidiary as ChargeSub)!.account as string;

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
