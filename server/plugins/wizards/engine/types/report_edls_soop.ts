import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../../../storage/index.js';
import { getTodayYmd } from '@shared/utils/date';

/**
 * EDLS Scheduled Out of Population: every FUTURE (today and later) sheet
 * assignment on a non-trash sheet whose worker is not currently in the
 * EDLS scheduling population (no `worker_edls` row with `active = true`,
 * the same rule `getAvailableWorkersForSheet` uses). One row per
 * (sheet, out-of-population worker) assignment.
 */
export class ReportEdlsSoop extends WizardReport {
  name = 'report_edls_soop';
  displayName = 'EDLS Scheduled Out of Population';
  description = 'Future sheet assignments whose worker is no longer in the EDLS scheduling population';
  category = 'EDLS';
  requiredComponent = 'edls';

  getPrimaryKeyField(): string {
    return 'assignmentId';
  }

  getColumns(): ReportColumn[] {
    return [
      {
        id: 'sheetLink',
        header: 'Sheet',
        type: 'link',
        width: 200
      },
      {
        id: 'sheetYmd',
        header: 'Sheet Date',
        type: 'date',
        width: 120
      },
      {
        id: 'siriusId',
        header: 'Sirius ID',
        type: 'number',
        width: 100
      },
      {
        id: 'workerLink',
        header: 'Worker',
        type: 'link',
        width: 200
      },
      {
        id: 'startTime',
        header: 'Start Time',
        type: 'string',
        width: 100
      },
      {
        id: 'taskName',
        header: 'Task',
        type: 'string',
        width: 160
      },
      {
        id: 'departmentName',
        header: 'Department',
        type: 'string',
        width: 160
      },
      {
        id: 'supervisorName',
        header: 'Supervisor',
        type: 'string',
        width: 160
      }
    ];
  }

  async fetchRecords(
    _config: ReportConfig,
    _batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const rows = await storage.edlsAssignments.getFutureOutOfPopulationAssignments(getTodayYmd());

    const records: ReportRecord[] = rows.map((row) => ({
      assignmentId: row.assignmentId,
      sheetId: row.sheetId,
      sheetLink: {
        url: `/edls/sheet/${row.sheetId}`,
        label: row.sheetTitle || 'View Sheet'
      },
      sheetYmd: row.sheetYmd,
      workerId: row.workerId,
      siriusId: row.siriusId,
      workerLink: {
        url: `/workers/${row.workerId}`,
        label: row.displayName || 'View Worker'
      },
      startTime: row.startTime,
      taskName: row.taskName,
      departmentName: row.departmentName,
      supervisorName: row.supervisorName
    }));

    if (onProgress) {
      onProgress({ processed: records.length, total: records.length });
    }

    return records;
  }
}
