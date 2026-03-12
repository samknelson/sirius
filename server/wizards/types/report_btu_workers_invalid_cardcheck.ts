import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../storage';
import { workers, contacts, cardchecks, employers, bargainingUnits } from '@shared/schema';
import { eq, and, inArray } from 'drizzle-orm';

interface BTUWorkersInvalidCardcheckConfig extends ReportConfig {
  filters?: {
    cardcheckDefinitionId?: string;
    employerId?: string;
  };
}

export class ReportBTUWorkersInvalidCardcheck extends WizardReport {
  name = 'report_btu_workers_invalid_cardcheck';
  displayName = 'BTU Workers Without Valid Cardchecks';
  description = 'Find workers who either have no signed cardcheck of the specified type, or have a signed cardcheck with a bargaining unit that differs from their current bargaining unit';
  category = 'BTU';
  requiredComponent = 'sitespecific.btu';

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
        id: 'employerName',
        header: 'Home Employer',
        type: 'string',
        width: 200
      },
      {
        id: 'workerBargainingUnit',
        header: 'Worker Bargaining Unit',
        type: 'string',
        width: 180
      },
      {
        id: 'cardcheckBargainingUnit',
        header: 'Cardcheck Bargaining Unit',
        type: 'string',
        width: 180
      },
      {
        id: 'issueType',
        header: 'Issue',
        type: 'string',
        width: 150
      }
    ];
  }

  async fetchRecords(
    config: BTUWorkersInvalidCardcheckConfig,
    batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const cardcheckDefinitionId = config.filters?.cardcheckDefinitionId;
    const employerId = config.filters?.employerId;

    if (!cardcheckDefinitionId) {
      return [];
    }

    return storage.readOnly.query(async (db) => {
      const records: ReportRecord[] = [];

      const baseQuery = db
        .select({
          workerId: workers.id,
          siriusId: workers.siriusId,
          displayName: contacts.displayName,
          workerBargainingUnitId: workers.bargainingUnitId,
          homeEmployerId: workers.denormHomeEmployerId,
          employerName: employers.name,
          cardcheckId: cardchecks.id,
          cardcheckBargainingUnitId: cardchecks.bargainingUnitId,
          cardcheckStatus: cardchecks.status
        })
        .from(workers)
        .innerJoin(contacts, eq(workers.contactId, contacts.id))
        .leftJoin(employers, eq(workers.denormHomeEmployerId, employers.id))
        .leftJoin(
          cardchecks,
          and(
            eq(cardchecks.workerId, workers.id),
            eq(cardchecks.cardcheckDefinitionId, cardcheckDefinitionId),
            eq(cardchecks.status, 'signed')
          )
        );

      let results;
      if (employerId) {
        results = await baseQuery.where(eq(workers.denormHomeEmployerId, employerId));
      } else {
        results = await baseQuery;
      }

      const bargainingUnitIds = new Set<string>();
      for (const row of results) {
        if (row.workerBargainingUnitId) bargainingUnitIds.add(row.workerBargainingUnitId);
        if (row.cardcheckBargainingUnitId) bargainingUnitIds.add(row.cardcheckBargainingUnitId);
      }

      const buMap = new Map<string, string>();
      if (bargainingUnitIds.size > 0) {
        const buList = await db
          .select({ id: bargainingUnits.id, name: bargainingUnits.name })
          .from(bargainingUnits)
          .where(inArray(bargainingUnits.id, Array.from(bargainingUnitIds)));
        for (const bu of buList) {
          buMap.set(bu.id, bu.name);
        }
      }

      for (const row of results) {
        const hasSignedCardcheck = row.cardcheckId !== null;
        const workerBU = row.workerBargainingUnitId;
        const cardcheckBU = row.cardcheckBargainingUnitId;

        let issueType: string | null = null;

        if (!hasSignedCardcheck) {
          issueType = 'No Signed Cardcheck';
        } else if (workerBU !== cardcheckBU) {
          issueType = 'Bargaining Unit Mismatch';
        }

        if (issueType) {
          records.push({
            workerId: row.workerId,
            siriusId: row.siriusId,
            displayName: row.displayName || '',
            employerName: row.employerName || 'No Home Employer',
            workerBargainingUnit: workerBU ? (buMap.get(workerBU) || 'Unknown') : 'None',
            cardcheckBargainingUnit: hasSignedCardcheck ? (cardcheckBU ? (buMap.get(cardcheckBU) || 'Unknown') : 'None') : 'N/A',
            issueType
          });
        }
      }

      if (onProgress) {
        onProgress({
          processed: records.length,
          total: records.length
        });
      }

      return records;
    });
  }
}
