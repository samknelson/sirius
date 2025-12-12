import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';

export class ReportGbhetLegalCompliance extends WizardReport {
  name = 'report_gbhet_legal_compliance';
  displayName = 'GBHET Legal Compliance Check';
  description = 'Identifies workers with 80+ hours in a work month who are missing the legal benefit after the 3-month lag (e.g., January work → April benefit)';
  category = 'Compliance';

  getPrimaryKeyField(): string {
    return 'recordKey';
  }

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'siriusId',
        header: 'Sirius ID',
        type: 'number',
        width: 100
      },
      {
        id: 'displayName',
        header: 'Worker Name',
        type: 'string',
        width: 200
      },
      {
        id: 'workMonth',
        header: 'Work Month',
        type: 'string',
        width: 120
      },
      {
        id: 'totalHours',
        header: 'Hours',
        type: 'number',
        width: 80
      },
      {
        id: 'expectedBenefitMonth',
        header: 'Expected Benefit Month',
        type: 'string',
        width: 160
      },
      {
        id: 'employerName',
        header: 'Employer',
        type: 'string',
        width: 200
      },
      {
        id: 'benefitName',
        header: 'Missing Benefit',
        type: 'string',
        width: 180
      }
    ];
  }

  async fetchRecords(
    config: ReportConfig,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const { db } = await import('../../db.js');
    const { 
      workerHours, 
      workers, 
      contacts, 
      employers, 
      trustWmb, 
      trustBenefits,
      chargePluginConfigs 
    } = await import('@shared/schema');
    const { eq, sql, and, or, isNull, inArray } = await import('drizzle-orm');

    const allPluginConfigs = await db
      .select()
      .from(chargePluginConfigs)
      .where(
        and(
          eq(chargePluginConfigs.pluginId, 'gbhet-legal-benefit'),
          eq(chargePluginConfigs.enabled, true)
        )
      );

    if (allPluginConfigs.length === 0) {
      return [];
    }

    const globalConfig = allPluginConfigs.find(c => c.scope === 'global');
    const employerConfigs = allPluginConfigs.filter(c => c.scope === 'employer' && c.employerId);

    const employerConfigMap = new Map<string, typeof allPluginConfigs[0]>();
    for (const cfg of employerConfigs) {
      if (cfg.employerId) {
        employerConfigMap.set(cfg.employerId, cfg);
      }
    }

    const getConfigForEmployer = (employerId: string) => {
      return employerConfigMap.get(employerId) ?? globalConfig;
    };

    const benefitIds = new Set<string>();
    for (const cfg of allPluginConfigs) {
      const settings = cfg.settings as { benefitId?: string };
      if (settings?.benefitId) {
        benefitIds.add(settings.benefitId);
      }
    }

    if (benefitIds.size === 0) {
      return [];
    }

    const benefits = await db
      .select({ id: trustBenefits.id, name: trustBenefits.name })
      .from(trustBenefits)
      .where(inArray(trustBenefits.id, Array.from(benefitIds)));

    const benefitNameMap = new Map<string, string>();
    for (const b of benefits) {
      benefitNameMap.set(b.id, b.name);
    }

    const workerMonthlyHours = await db
      .select({
        workerId: workerHours.workerId,
        employerId: workerHours.employerId,
        year: workerHours.year,
        month: workerHours.month,
        totalHours: sql<number>`SUM(${workerHours.hours})`.as('totalHours')
      })
      .from(workerHours)
      .groupBy(
        workerHours.workerId,
        workerHours.employerId,
        workerHours.year,
        workerHours.month
      )
      .having(sql`SUM(${workerHours.hours}) >= 80`);

    if (workerMonthlyHours.length === 0) {
      if (onProgress) {
        onProgress({ processed: 0, total: 0 });
      }
      return [];
    }

    const workerIds = Array.from(new Set(workerMonthlyHours.map(e => e.workerId)));
    const employerIds = Array.from(new Set(workerMonthlyHours.map(e => e.employerId)));

    const workersData = await db
      .select({
        id: workers.id,
        siriusId: workers.siriusId,
        displayName: contacts.displayName
      })
      .from(workers)
      .innerJoin(contacts, eq(workers.contactId, contacts.id))
      .where(inArray(workers.id, workerIds));

    const workerMap = new Map<string, { siriusId: number; displayName: string | null }>();
    for (const w of workersData) {
      workerMap.set(w.id, { siriusId: w.siriusId, displayName: w.displayName });
    }

    const employersData = await db
      .select({ id: employers.id, name: employers.name })
      .from(employers)
      .where(inArray(employers.id, employerIds));

    const employerMap = new Map<string, string>();
    for (const e of employersData) {
      employerMap.set(e.id, e.name);
    }

    const allWmbs = await db
      .select({
        workerId: trustWmb.workerId,
        employerId: trustWmb.employerId,
        benefitId: trustWmb.benefitId,
        year: trustWmb.year,
        month: trustWmb.month
      })
      .from(trustWmb)
      .where(inArray(trustWmb.benefitId, Array.from(benefitIds)));

    const wmbSet = new Set<string>();
    for (const wmb of allWmbs) {
      const key = `${wmb.workerId}-${wmb.employerId}-${wmb.benefitId}-${wmb.year}-${wmb.month}`;
      wmbSet.add(key);
    }

    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const records: ReportRecord[] = [];
    const total = workerMonthlyHours.length;

    for (let i = 0; i < total; i++) {
      const entry = workerMonthlyHours[i];
      
      const cfg = getConfigForEmployer(entry.employerId);
      if (!cfg) {
        continue;
      }

      const settings = cfg.settings as { benefitId?: string; billingOffsetMonths?: number };
      const benefitId = settings?.benefitId;
      const billingOffsetMonths = settings?.billingOffsetMonths ?? -3;
      const benefitLagMonths = Math.abs(billingOffsetMonths);

      if (!benefitId) {
        continue;
      }

      let benefitMonth = entry.month + benefitLagMonths;
      let benefitYear = entry.year;
      
      while (benefitMonth > 12) {
        benefitMonth -= 12;
        benefitYear += 1;
      }

      const wmbKey = `${entry.workerId}-${entry.employerId}-${benefitId}-${benefitYear}-${benefitMonth}`;
      
      if (!wmbSet.has(wmbKey)) {
        const workerInfo = workerMap.get(entry.workerId);
        const employerName = employerMap.get(entry.employerId) ?? 'Unknown';
        const benefitName = benefitNameMap.get(benefitId) ?? 'Legal Benefit';

        records.push({
          recordKey: `${entry.workerId}-${entry.employerId}-${entry.year}-${entry.month}`,
          workerId: entry.workerId,
          siriusId: workerInfo?.siriusId ?? null,
          displayName: workerInfo?.displayName ?? 'Unknown',
          workMonth: `${monthNames[entry.month]} ${entry.year}`,
          totalHours: Number(entry.totalHours),
          expectedBenefitMonth: `${monthNames[benefitMonth]} ${benefitYear}`,
          employerName: employerName,
          benefitName: benefitName
        });
      }

      if (onProgress && (i + 1) % 50 === 0) {
        onProgress({ processed: i + 1, total });
      }
    }

    if (onProgress) {
      onProgress({ processed: total, total });
    }

    return records;
  }
}
