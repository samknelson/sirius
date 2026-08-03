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

  /**
   * Columns computed at run time: the static columns plus one column per
   * worker-ID type flagged "show on lists" (same set the workers list
   * shows), inserted where the old Sirius ID column used to be (before
   * the Worker column), in the types' configured sequence order.
   */
  async getRuntimeColumns(): Promise<ReportColumn[]> {
    const base = this.getColumns();
    const idTypes = await storage.workerIds.getShowOnListsIdTypes();
    const idColumns: ReportColumn[] = idTypes.map((t) => ({
      id: `workerIdType_${t.id}`,
      header: t.name,
      type: 'string',
      width: 120
    }));
    const workerIdx = base.findIndex((c) => c.id === 'workerLink');
    const insertAt = workerIdx === -1 ? base.length : workerIdx;
    return [...base.slice(0, insertAt), ...idColumns, ...base.slice(insertAt)];
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

    // Batch-fetch the show-on-lists worker ID values for all involved
    // workers and key them by workerId -> column id. A worker with
    // multiple values of the same type gets them joined with ", ".
    const uniqueWorkerIds = Array.from(new Set(rows.map((r) => r.workerId)));
    const idValues = await storage.workerIds.getWorkerIdsForListByWorkerIds(uniqueWorkerIds);
    const idValueMap = new Map<string, Record<string, string>>();
    // Sort so multiple values of the same type join in a stable order.
    idValues.sort((a, b) => a.value.localeCompare(b.value));
    for (const item of idValues) {
      const colId = `workerIdType_${item.typeId}`;
      let perWorker = idValueMap.get(item.workerId);
      if (!perWorker) {
        perWorker = {};
        idValueMap.set(item.workerId, perWorker);
      }
      perWorker[colId] = perWorker[colId] ? `${perWorker[colId]}, ${item.value}` : item.value;
    }

    const records: ReportRecord[] = rows.map((row) => ({
      assignmentId: row.assignmentId,
      sheetId: row.sheetId,
      sheetLink: {
        url: `/edls/sheet/${row.sheetId}`,
        label: row.sheetTitle || 'View Sheet'
      },
      sheetYmd: row.sheetYmd,
      workerId: row.workerId,
      ...(idValueMap.get(row.workerId) ?? {}),
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
