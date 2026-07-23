import { WizardReport, ReportConfig, ReportColumn, ReportRecord } from '../report.js';
import { storage } from '../../../../storage/index.js';
import { getTodayYmd, addDaysYmd } from '@shared/utils/date';
import { sql } from 'drizzle-orm';

interface ScheduledTooSoonConfig extends ReportConfig {
  minHours?: number;
  startDate?: string;
  endDate?: string;
}

interface AssignmentRow {
  assignmentId: string;
  sheetId: string;
  sheetTitle: string | null;
  sheetYmd: string;
  workerId: string;
  displayName: string | null;
  startTime: string | null;
  taskName: string | null;
  departmentName: string | null;
}

/**
 * EDLS Scheduled Too Soon: per worker, consecutive assignment pairs
 * (ordered by sheet date + start time) whose start datetimes are closer
 * together than the configured minimum gap in hours. A pair is included
 * when either shift's date falls inside the selected date range, so edge
 * violations at the range boundaries aren't missed. Trashed sheets are
 * excluded; draft and locked sheets are both included. Assignments with
 * no usable start time are skipped.
 */
export class ReportEdlsScheduledTooSoon extends WizardReport {
  name = 'report_edls_scheduled_too_soon';
  displayName = 'EDLS Scheduled Too Soon';
  description = 'Workers whose consecutive EDLS shift start times are closer together than a minimum gap';
  category = 'EDLS';
  requiredComponent = 'edls';

  getPrimaryKeyField(): string {
    return 'pairKey';
  }

  /**
   * Columns computed at run time: the static columns plus one column per
   * worker-ID type flagged "show on lists", inserted before the Worker
   * column (same convention as the SOOP report).
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
        id: 'workerLink',
        header: 'Worker',
        type: 'link',
        width: 200
      },
      {
        id: 'firstSheetLink',
        header: 'First Sheet',
        type: 'link',
        width: 200
      },
      {
        id: 'firstSheetYmd',
        header: 'First Sheet Date',
        type: 'date',
        width: 120
      },
      {
        id: 'firstStartTime',
        header: 'First Start Time',
        type: 'string',
        width: 100
      },
      {
        id: 'nextSheetLink',
        header: 'Next Sheet',
        type: 'link',
        width: 200
      },
      {
        id: 'nextSheetYmd',
        header: 'Next Sheet Date',
        type: 'date',
        width: 120
      },
      {
        id: 'nextStartTime',
        header: 'Next Start Time',
        type: 'string',
        width: 100
      },
      {
        id: 'hoursBetween',
        header: 'Hours Between Starts',
        type: 'number',
        width: 140
      },
      {
        id: 'firstTaskName',
        header: 'First Task',
        type: 'string',
        width: 160
      },
      {
        id: 'nextTaskName',
        header: 'Next Task',
        type: 'string',
        width: 160
      },
      {
        id: 'departmentName',
        header: 'Department',
        type: 'string',
        width: 160
      }
    ];
  }

  async fetchRecords(
    config: ScheduledTooSoonConfig,
    _batchSize: number = 100,
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<ReportRecord[]> {
    const minHours =
      typeof config.minHours === 'number' && !isNaN(config.minHours)
        ? config.minHours
        : 24;
    const startDate = config.startDate || getTodayYmd();
    const endDate = config.endDate || addDaysYmd(startDate, 10);

    // The query fetches every non-trash assignment for workers who have at
    // least one assignment in (or near) the window; consecutive-pair logic
    // runs in TypeScript below. To keep the fetch bounded, we widen the
    // sheet-date filter by a generous margin around the selected range so
    // boundary pairs (one shift in range, its neighbor outside) are seen.
    const marginDays = Math.max(14, Math.ceil(minHours / 24) + 1);
    const fetchFrom = addDaysYmd(startDate, -marginDays);
    const fetchTo = addDaysYmd(endDate, marginDays);

    const rows = await storage.readOnly.query(async (db) => {
      const result = await db.execute(sql`
        SELECT
          ea.id as "assignmentId",
          es.id as "sheetId",
          es.title as "sheetTitle",
          es.ymd::text as "sheetYmd",
          w.id as "workerId",
          c.display_name as "displayName",
          COALESCE(NULLIF(ea.data->>'startTime', ''), ec.start_time::text) as "startTime",
          t.name as "taskName",
          d.name as "departmentName"
        FROM edls_assignments ea
        INNER JOIN edls_crews ec ON ea.crew_id = ec.id
        INNER JOIN edls_sheets es ON ec.sheet_id = es.id
        INNER JOIN workers w ON ea.worker_id = w.id
        INNER JOIN contacts c ON w.contact_id = c.id
        LEFT JOIN options_edls_tasks t ON ec.task_id = t.id
        LEFT JOIN options_department d ON es.department_id = d.id
        WHERE es.status != 'trash'
          AND es.ymd >= ${fetchFrom}
          AND es.ymd <= ${fetchTo}
        ORDER BY w.id ASC, es.ymd ASC, COALESCE(NULLIF(ea.data->>'startTime', ''), ec.start_time::text) ASC
      `);
      return result.rows as unknown as AssignmentRow[];
    });

    // Group by worker, keeping only assignments with a parseable start time.
    const byWorker = new Map<string, AssignmentRow[]>();
    for (const row of rows) {
      if (!row.startTime || isNaN(this.toEpochMs(row.sheetYmd, row.startTime))) {
        continue;
      }
      let list = byWorker.get(row.workerId);
      if (!list) {
        list = [];
        byWorker.set(row.workerId, list);
      }
      list.push(row);
    }

    const inRange = (ymd: string) => ymd >= startDate && ymd <= endDate;

    const pairs: Array<{ first: AssignmentRow; next: AssignmentRow; gapHours: number }> = [];
    byWorker.forEach((list) => {
      list.sort((a, b) => {
        const ta = this.toEpochMs(a.sheetYmd, a.startTime!);
        const tb = this.toEpochMs(b.sheetYmd, b.startTime!);
        return ta - tb;
      });
      for (let i = 0; i < list.length - 1; i++) {
        const first = list[i];
        const next = list[i + 1];
        if (!inRange(first.sheetYmd) && !inRange(next.sheetYmd)) continue;
        const gapMs =
          this.toEpochMs(next.sheetYmd, next.startTime!) -
          this.toEpochMs(first.sheetYmd, first.startTime!);
        const gapHours = gapMs / (1000 * 60 * 60);
        if (gapHours < minHours) {
          pairs.push({ first, next, gapHours: Math.round(gapHours * 100) / 100 });
        }
      }
    });

    // Sort output by first sheet date, then worker name.
    pairs.sort((a, b) => {
      if (a.first.sheetYmd !== b.first.sheetYmd) {
        return a.first.sheetYmd.localeCompare(b.first.sheetYmd);
      }
      return (a.first.displayName || '').localeCompare(b.first.displayName || '');
    });

    // Batch-fetch the show-on-lists worker ID values (same as SOOP).
    const uniqueWorkerIds = Array.from(new Set(pairs.map((p) => p.first.workerId)));
    const idValues = await storage.workerIds.getWorkerIdsForListByWorkerIds(uniqueWorkerIds);
    const idValueMap = new Map<string, Record<string, string>>();
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

    const records: ReportRecord[] = pairs.map(({ first, next, gapHours }) => ({
      pairKey: `${first.assignmentId}-${next.assignmentId}`,
      workerId: first.workerId,
      ...(idValueMap.get(first.workerId) ?? {}),
      workerLink: {
        url: `/workers/${first.workerId}`,
        label: first.displayName || 'View Worker'
      },
      firstSheetLink: {
        url: `/edls/sheet/${first.sheetId}`,
        label: first.sheetTitle || 'View Sheet'
      },
      firstSheetYmd: first.sheetYmd,
      firstStartTime: first.startTime,
      nextSheetLink: {
        url: `/edls/sheet/${next.sheetId}`,
        label: next.sheetTitle || 'View Sheet'
      },
      nextSheetYmd: next.sheetYmd,
      nextStartTime: next.startTime,
      hoursBetween: gapHours,
      firstTaskName: first.taskName,
      nextTaskName: next.taskName,
      departmentName: first.departmentName
    }));

    if (onProgress) {
      onProgress({ processed: records.length, total: records.length });
    }

    return records;
  }

  /** Combine a YYYY-MM-DD date and HH:MM[:SS] time into epoch ms (local). */
  private toEpochMs(ymd: string, time: string): number {
    const normalized = /^\d{1,2}:\d{2}(:\d{2})?$/.test(time.trim())
      ? time.trim()
      : '';
    if (!normalized) return NaN;
    return new Date(`${ymd}T${normalized.length === 5 ? normalized + ':00' : normalized}`).getTime();
  }
}
