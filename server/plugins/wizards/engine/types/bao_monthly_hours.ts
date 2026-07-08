import { FeedConfig, FeedData, createMonthlyDateRange, getCurrentMonth, FeedField } from '../feed.js';
import { WizardStep } from '../base.js';
import { GbhetLegalWorkersWizard } from './gbhet_legal_workers.js';
import { storage } from '../../../../storage/index.js';
import { createUnifiedOptionsStorage } from '../../../../storage/unified-options.js';
import { triggerPaymentChargePlugins } from '../../../../modules/ledger/payments.js';
import { logger } from '../../../../logger.js';

const unifiedOptionsStorage = createUnifiedOptionsStorage();

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
 *   an allocated ledger payment is recorded on the worker's behalf against
 *   the BAO fund account (from the enabled `bao-hourly` charge plugin
 *   config), with `statementYmd` anchored to the work month. Idempotent on
 *   re-upload via a `baoWithholding` marker in the payment's details.
 * - New-worker creation is gated by the Verify step: `canCreateWorker` only
 *   allows creation of an unknown-SSN worker when the row was explicitly
 *   confirmed in `wizard.data.newWorkerDecisions`.
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
   * Feed-processing hook (duck-typed from `processFeedData`): veto creation
   * of a worker whose SSN is unknown unless the Verify step explicitly
   * confirmed it. Decisions are keyed by the SSN's digits.
   */
  protected async canCreateWorker(ssn: string, _row: Record<string, any>, wizard: any): Promise<void> {
    const digits = String(ssn || '').replace(/\D/g, '');
    const decisions = ((wizard.data as any)?.newWorkerDecisions || {}) as Record<string, string>;
    const decision = decisions[digits];
    if (decision === 'confirm') return;
    if (decision === 'reject') {
      throw new Error('Worker creation was rejected in the Verify New Workers step');
    }
    throw new Error(
      'Worker with this SSN was not confirmed in the Verify New Workers step; re-run Verify and confirm or reject the row',
    );
  }

  /**
   * Feed-processing hook (duck-typed from `processFeedData`): record the
   * optional Employee Withholding Amount as an allocated ledger payment on
   * the worker's behalf. Idempotent on re-upload: one payment per
   * worker-EA + work month, updated in place when the amount changes.
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
    if (amount === 0) return;
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

    // Payment type: the ledger-payment-type option whose name mentions
    // "withholding". Explicit error when missing — no silent fallback.
    const paymentTypes = await unifiedOptionsStorage.list('ledger-payment-type');
    const withholdingType = paymentTypes.find((t: { id: string; name: string }) =>
      String(t.name || '').toLowerCase().includes('withholding'),
    );
    if (!withholdingType) {
      throw new Error(
        'No ledger payment type containing "withholding" is configured; add one under ledger payment types',
      );
    }

    const ea = await storage.ledger.ea.getOrCreate('worker', workerId, accountId);
    const amountStr = amount.toFixed(2);
    const details = {
      baoWithholding: { ym, workerId, wizardId: wizard.id },
      proposedAllocation: [{ eaId: ea.id, amount: amountStr, statementYmd }],
    };
    const memo = `BAO employee withholding for ${ym} (hours upload)`;

    const existingPayments = await storage.ledger.payments.getByLedgerEaId(ea.id);
    const existing = existingPayments.find(
      (p) => ((p.details as any) || {}).baoWithholding?.ym === ym,
    );

    if (existing) {
      if (existing.amount === amountStr) {
        // Same amount already recorded for this month — nothing to do.
        return;
      }
      const updated = await storage.ledger.payments.update(existing.id, {
        amount: amountStr,
        details,
        memo,
      });
      if (updated) {
        await triggerPaymentChargePlugins(updated);
      }
      logger.info('BAO withholding payment updated', {
        service: 'wizard-bao-monthly-hours',
        paymentId: existing.id,
        workerId,
        ym,
        amount: amountStr,
      });
      return;
    }

    const payment = await storage.ledger.payments.create({
      status: 'cleared',
      amount: amountStr,
      paymentType: withholdingType.id,
      ledgerEaId: ea.id,
      details,
      dateReceived: new Date(),
      dateCleared: new Date(),
      memo,
    });
    await triggerPaymentChargePlugins(payment);
    logger.info('BAO withholding payment created', {
      service: 'wizard-bao-monthly-hours',
      paymentId: payment.id,
      workerId,
      ym,
      amount: amountStr,
    });
  }
}

export const baoMonthlyHours = new BaoMonthlyHoursWizard();
