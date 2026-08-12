import { FeedWizard, FeedField, FeedConfig, FeedData } from '../feed.js';
import { WizardStatus, WizardStep, LaunchArgument } from '../base.js';
import { storage } from '../../../../storage/index.js';
import { createUnifiedOptionsStorage } from '../../../../storage/unified-options.js';
import { objectStorageService } from '../../../../services/objectStorage.js';
import { getCurrentEffectiveRate } from '../../../../utils/rateHistory.js';
import { parse as parseCSV } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { logger } from '../../../../logger.js';

const unifiedOptionsStorage = createUnifiedOptionsStorage();

/* ------------------------------------------------------------------ */
/* Normalized row shape shared by every file format                    */
/* ------------------------------------------------------------------ */

export const RATE_CATEGORIES = ['training', 'housing', 'legal', 'pension'] as const;
export type RateCategory = (typeof RATE_CATEGORIES)[number];

export interface WeekFigures {
  week: number;
  /** YYYY-MM-DD check date from the row, when present. */
  checkDate: string | null;
  grossPay: number | null;
  hours: number | null;
  dues: number | null;
  training: number | null;
  housing: number | null;
  legal: number | null;
  pension: number | null;
}

export interface NormalizedRow {
  rowIndex: number;
  workLocationName: string | null;
  employeeStatus: string | null;
  longendFlag: boolean;
  ssn: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  personNumber: string | null;
  birthDate: string | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phoneNumber: string | null;
  email: string | null;
  weeks: WeekFigures[];
  shiftCount: number | null;
}

export interface WeekInfo {
  week: number;
  payWeekStart: string | null;
  payWeekEnding: string | null;
  /** Most common per-row check date for the week (candidate week date). */
  checkDate: string | null;
}

export interface ParsedFile {
  rows: NormalizedRow[];
  weeks: WeekInfo[];
  payrollMonthLabel: string | null;
  /** Per-hour rate constants found in file metadata (Marriott S2 only). */
  fileRates: Partial<Record<RateCategory, number>>;
}

/* ------------------------------------------------------------------ */
/* Small parsing helpers                                                */
/* ------------------------------------------------------------------ */

function norm(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normKey(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Parse money/number cells; blanks and "$-" placeholders become null. */
export function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const s = String(value).replace(/[$,\s]/g, '');
  if (s === '' || s === '-' || s === '--') return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/** Parse a date cell (Excel serial, Date, or common strings) to YYYY-MM-DD. */
export function parseDateCell(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const serial = typeof value === 'number' ? value : parseFloat(value);
    if (serial >= 1 && serial <= 73050) {
      // Excel's 1900 date system: epoch 1899-12-30 already absorbs the fake
      // 1900-02-29 (serial 60) for all serials > 60, so use the serial as-is.
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(excelEpoch.getTime() + Math.floor(serial) * 86400000);
      if (!isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
    }
    return null;
  }
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const mdy = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

/** Normalize an SSN-ish value to XXX-XX-XXXX, or null when unparseable. */
export function preprocessSSN(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 0 || digits.length > 9) return null;
  const padded = digits.padStart(9, '0');
  return `${padded.substring(0, 3)}-${padded.substring(3, 5)}-${padded.substring(5, 9)}`;
}

function truthyFlag(value: unknown): boolean {
  const s = norm(value);
  return s !== '' && s !== '0' && s !== 'no' && s !== 'n' && s !== 'false';
}

/** Split "First Last" or "Last, First" into name components. */
function splitName(fullName: string | null): { firstName: string | null; lastName: string | null } {
  if (!fullName) return { firstName: null, lastName: null };
  const s = fullName.trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',', 2).map((p) => p.trim());
    return { firstName: first || null, lastName: last || null };
  }
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: null, lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/* ------------------------------------------------------------------ */
/* File format layer                                                    */
/* ------------------------------------------------------------------ */

/**
 * A Local 26 file format turns raw sheet rows into the normalized shape.
 * Adding a new format (e.g. Compass once sample data exists) means adding a
 * parser here and listing its id in FILE_FORMATS + the launch schema enum.
 */
export interface Local26FormatParser {
  id: string;
  name: string;
  /** Whether the generic column-mapping step applies to this format. */
  usesColumnMapping: boolean;
  parse(rawRows: any[][], opts: { columnMapping?: Record<string, string>; hasHeaders?: boolean }): ParsedFile;
}

const WEEK_BLOCK_FIELDS: Array<{ key: keyof WeekFigures; header: string }> = [
  { key: 'checkDate', header: 'check date' },
  { key: 'grossPay', header: 'gross pay' },
  { key: 'hours', header: 'hours' },
  { key: 'dues', header: 'dues' },
  { key: 'training', header: 'training' },
  { key: 'housing', header: 'housing' },
  { key: 'legal', header: 'legal' },
  { key: 'pension', header: 'pension' },
];

/**
 * Marriott "S2" matrix format: metadata rows (payroll month, per-week Pay
 * Week Start/Ending + expected weekly rate constants), a totals row, the
 * real header row ("Work Location Name" ... "Week N Check Date" ...), then
 * one row per worker. Week 5 is detected from the headers, so files with
 * four or five reporting weeks both parse.
 */
export const marriottS2Parser: Local26FormatParser = {
  id: 'marriott_s2',
  name: 'Marriott S2',
  usesColumnMapping: false,
  parse(rawRows: any[][]): ParsedFile {
    // 1. Locate the real header row.
    const headerIndex = rawRows.findIndex((row) => norm(row?.[0]) === 'work location name');
    if (headerIndex < 0) {
      throw new Error('Could not find the header row (expected a "Work Location Name" column) — is this a Marriott S2 file?');
    }
    const headers = rawRows[headerIndex].map((h: unknown) => norm(h));

    const colOf = (...names: string[]): number => {
      for (const n of names) {
        const idx = headers.indexOf(n);
        if (idx >= 0) return idx;
      }
      return -1;
    };

    const cols = {
      workLocation: colOf('work location name'),
      employeeStatus: colOf('employee status'),
      longendFlag: colOf('longend flag'),
      ssn: colOf('national identifier', 'ssn'),
      employeeName: colOf('employee name'),
      personNumber: colOf('person number'),
      birthDate: colOf('date of birth'),
      gender: colOf('gender'),
      address: colOf('address', 'address line 1'),
      city: colOf('home location city', 'city'),
      state: colOf('home location state', 'state'),
      zip: colOf('home location zip code', 'zip', 'postal code'),
      shiftCount: headers.findIndex((h) => h.includes('shift count')),
    };

    // 2. Per-week column blocks from "Week N Check Date" style headers.
    const weekBlocks = new Map<number, Partial<Record<keyof WeekFigures, number>>>();
    headers.forEach((h, idx) => {
      const m = h.match(/^week\s*(\d+)\s+(.*)$/);
      if (!m) return;
      const weekNum = parseInt(m[1], 10);
      const field = WEEK_BLOCK_FIELDS.find((f) => f.header === m[2].trim());
      if (!field) return;
      const block = weekBlocks.get(weekNum) ?? {};
      block[field.key] = idx;
      weekBlocks.set(weekNum, block);
    });
    const weekNumbers = Array.from(weekBlocks.keys()).sort((a, b) => a - b);
    if (weekNumbers.length === 0) {
      throw new Error('No "Week N ..." columns found in the header row — is this a Marriott S2 file?');
    }

    // 3. Metadata above the header row: payroll month label, per-week Pay
    //    Week Start/Ending pairs, and the per-hour rate constants that
    //    follow each "Pay Week Ending" cell.
    let payrollMonthLabel: string | null = null;
    const metaWeeks: Array<{ payWeekStart: string | null; payWeekEnding: string | null }> = [];
    const fileRates: Partial<Record<RateCategory, number>> = {};
    for (let r = 0; r < headerIndex; r++) {
      const row = rawRows[r] || [];
      if (norm(row[1]) === 'last check date of month' && strOrNull(row[0])) {
        payrollMonthLabel = strOrNull(row[0]);
      }
      for (let c = 0; c < row.length; c++) {
        if (norm(row[c]) === 'pay week start') {
          const start = parseDateCell(row[c + 1]);
          let ending: string | null = null;
          if (norm(row[c + 2]) === 'pay week ending') {
            ending = parseDateCell(row[c + 3]);
            const rates = [row[c + 4], row[c + 5], row[c + 6], row[c + 7]].map(parseMoney);
            RATE_CATEGORIES.forEach((cat, i) => {
              if (rates[i] !== null) fileRates[cat] = rates[i]!;
            });
          }
          metaWeeks.push({ payWeekStart: start, payWeekEnding: ending });
        }
      }
    }

    // 4. Data rows.
    const cell = (row: any[], idx: number) => (idx >= 0 ? row[idx] : null);
    const rows: NormalizedRow[] = [];
    for (let r = headerIndex + 1; r < rawRows.length; r++) {
      const raw = rawRows[r] || [];
      const hasAny = raw.some((v: unknown) => strOrNull(v) !== null);
      if (!hasAny) continue;
      const fullName = strOrNull(cell(raw, cols.employeeName));
      const weeks: WeekFigures[] = weekNumbers.map((w) => {
        const block = weekBlocks.get(w)!;
        return {
          week: w,
          checkDate: block.checkDate !== undefined ? parseDateCell(raw[block.checkDate]) : null,
          grossPay: block.grossPay !== undefined ? parseMoney(raw[block.grossPay]) : null,
          hours: block.hours !== undefined ? parseMoney(raw[block.hours]) : null,
          dues: block.dues !== undefined ? parseMoney(raw[block.dues]) : null,
          training: block.training !== undefined ? parseMoney(raw[block.training]) : null,
          housing: block.housing !== undefined ? parseMoney(raw[block.housing]) : null,
          legal: block.legal !== undefined ? parseMoney(raw[block.legal]) : null,
          pension: block.pension !== undefined ? parseMoney(raw[block.pension]) : null,
        };
      });
      rows.push({
        rowIndex: rows.length,
        workLocationName: strOrNull(cell(raw, cols.workLocation)),
        employeeStatus: strOrNull(cell(raw, cols.employeeStatus)),
        longendFlag: truthyFlag(cell(raw, cols.longendFlag)),
        ssn: strOrNull(cell(raw, cols.ssn)),
        fullName,
        ...splitName(fullName),
        personNumber: strOrNull(cell(raw, cols.personNumber)),
        birthDate: parseDateCell(cell(raw, cols.birthDate)),
        gender: strOrNull(cell(raw, cols.gender)),
        addressLine1: strOrNull(cell(raw, cols.address)),
        addressLine2: null,
        city: strOrNull(cell(raw, cols.city)),
        state: strOrNull(cell(raw, cols.state)),
        postalCode: strOrNull(cell(raw, cols.zip)),
        phoneNumber: null,
        email: null,
        weeks,
        shiftCount: parseMoney(cell(raw, cols.shiftCount)),
      });
    }

    // 5. Candidate week dates: metadata ending dates + modal per-row check dates.
    const weeks: WeekInfo[] = weekNumbers.map((w, i) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const cd = row.weeks.find((wk) => wk.week === w)?.checkDate;
        if (cd) counts.set(cd, (counts.get(cd) || 0) + 1);
      }
      let modal: string | null = null;
      let best = 0;
      counts.forEach((n, d) => { if (n > best) { best = n; modal = d; } });
      return {
        week: w,
        payWeekStart: metaWeeks[i]?.payWeekStart ?? null,
        payWeekEnding: metaWeeks[i]?.payWeekEnding ?? null,
        checkDate: modal,
      };
    });

    return { rows, weeks, payrollMonthLabel, fileRates };
  },
};

/** Generic one-row-per-worker format driven by the standard column mapping. */
export const genericParser: Local26FormatParser = {
  id: 'generic',
  name: 'Generic (column-mapped)',
  usesColumnMapping: true,
  parse(rawRows: any[][], opts): ParsedFile {
    const mapping = opts.columnMapping || {};
    const hasHeaders = opts.hasHeaders ?? true;
    // Canonical shape is { fieldId: colKey }; legacy { col_N: fieldId } also accepted.
    const keys = Object.keys(mapping);
    const isOld = keys.length > 0 && keys.every((k) => k.startsWith('col_'));
    const fieldToCol: Record<string, number> = {};
    for (const [k, v] of Object.entries(mapping)) {
      if (!v || v === '_unmapped') continue;
      if (isOld) fieldToCol[v] = parseInt(k.replace('col_', ''), 10);
      else fieldToCol[k] = parseInt(String(v).replace('col_', ''), 10);
    }
    const dataRows = hasHeaders ? rawRows.slice(1) : rawRows;
    const get = (row: any[], fieldId: string) =>
      fieldToCol[fieldId] !== undefined ? row[fieldToCol[fieldId]] : null;

    const rows: NormalizedRow[] = [];
    for (const raw of dataRows) {
      if (!raw || !raw.some((v: unknown) => strOrNull(v) !== null)) continue;
      const firstName = strOrNull(get(raw, 'firstName'));
      const lastName = strOrNull(get(raw, 'lastName'));
      const weeks: WeekFigures[] = [];
      for (let w = 1; w <= 5; w++) {
        const week: WeekFigures = {
          week: w,
          checkDate: parseDateCell(get(raw, `week${w}CheckDate`)),
          grossPay: parseMoney(get(raw, `week${w}GrossPay`)),
          hours: parseMoney(get(raw, `week${w}Hours`)),
          dues: parseMoney(get(raw, `week${w}Dues`)),
          training: parseMoney(get(raw, `week${w}Training`)),
          housing: parseMoney(get(raw, `week${w}Housing`)),
          legal: parseMoney(get(raw, `week${w}Legal`)),
          pension: parseMoney(get(raw, `week${w}Pension`)),
        };
        const mapped = Object.keys(fieldToCol).some((f) => f.startsWith(`week${w}`));
        if (mapped) weeks.push(week);
      }
      rows.push({
        rowIndex: rows.length,
        workLocationName: strOrNull(get(raw, 'workLocationName')),
        employeeStatus: strOrNull(get(raw, 'employeeStatus')),
        longendFlag: truthyFlag(get(raw, 'longendFlag')),
        ssn: strOrNull(get(raw, 'ssn')),
        fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
        firstName,
        lastName,
        personNumber: strOrNull(get(raw, 'personNumber')),
        birthDate: parseDateCell(get(raw, 'dateOfBirth')),
        gender: strOrNull(get(raw, 'gender')),
        addressLine1: strOrNull(get(raw, 'addressLine1')),
        addressLine2: strOrNull(get(raw, 'addressLine2')),
        city: strOrNull(get(raw, 'city')),
        state: strOrNull(get(raw, 'state')),
        postalCode: strOrNull(get(raw, 'postalCode')),
        phoneNumber: strOrNull(get(raw, 'phoneNumber')),
        email: strOrNull(get(raw, 'email')),
        weeks,
        shiftCount: parseMoney(get(raw, 'shiftCount')),
      });
    }

    const weekNumbers = Array.from(new Set(rows.flatMap((r) => r.weeks.map((w) => w.week)))).sort((a, b) => a - b);
    const weeks: WeekInfo[] = weekNumbers.map((w) => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const cd = row.weeks.find((wk) => wk.week === w)?.checkDate;
        if (cd) counts.set(cd, (counts.get(cd) || 0) + 1);
      }
      let modal: string | null = null;
      let best = 0;
      counts.forEach((n, d) => { if (n > best) { best = n; modal = d; } });
      return { week: w, payWeekStart: null, payWeekEnding: null, checkDate: modal };
    });

    return { rows, weeks, payrollMonthLabel: null, fileRates: {} };
  },
};

export const FILE_FORMATS: Record<string, Local26FormatParser> = {
  [marriottS2Parser.id]: marriottS2Parser,
  [genericParser.id]: genericParser,
};

/* ------------------------------------------------------------------ */
/* Result shapes                                                       */
/* ------------------------------------------------------------------ */

export interface Local26RateWarning {
  rowIndex: number;
  week: number;
  category: RateCategory;
  reported: number;
  expected: number;
  hours: number;
}

export interface Local26ValidationResults {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  errors: Array<{ rowIndex: number; field: string; message: string; value?: any }>;
  errorSummary: Record<string, number>;
  unmappedStatuses: string[];
  unmappedLocations: string[];
  ssnWarnings: Array<{ rowIndex: number; value?: any; message: string }>;
  rateWarnings: Local26RateWarning[];
  rateWarningsTruncated: boolean;
  weeks: WeekInfo[];
  completedAt: Date;
}

export interface Local26ProcessResults {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  hoursWritten: number;
  shiftsWritten: number;
  duesEventsEmitted: number;
  duesTotal: string;
  memberStatusesRecorded: number;
  warnings: string[];
  errors: Array<{ rowIndex: number; message: string }>;
  rowResults: Array<{ rowIndex: number; status: 'success' | 'error' | 'skipped'; message: string }>;
  rateWarningsCount: number;
  completedAt: Date;
}

/* ------------------------------------------------------------------ */
/* The wizard engine                                                   */
/* ------------------------------------------------------------------ */

const RATE_TOLERANCE = 0.02;
const MAX_RATE_WARNINGS = 100;

export class GbheLocal26HourlyWizard extends FeedWizard {
  name = 'gbhe_local26_hourly';
  displayName = 'GBHE Local 26 Hourly';
  description = 'Monthly employer-reported hours, shifts, dues and demographics upload for Local 26';
  entityType = 'employer';
  isMonthly = true;

  getFields(): FeedField[] {
    const fields: FeedField[] = [
      { id: 'ssn', name: 'SSN', type: 'string', required: false, description: 'Social Security Number (matched first)', displayOrder: 1 },
      { id: 'personNumber', name: 'Person Number', type: 'string', required: false, description: 'Payroll ID (matched second)', displayOrder: 2 },
      { id: 'firstName', name: 'First Name', type: 'string', required: false, requiredForCreate: true, displayOrder: 3 },
      { id: 'lastName', name: 'Last Name', type: 'string', required: false, requiredForCreate: true, displayOrder: 4 },
      { id: 'employeeStatus', name: 'Employee Status', type: 'string', required: true, displayOrder: 5 },
      { id: 'workLocationName', name: 'Work Location Name', type: 'string', required: false, displayOrder: 6 },
      { id: 'longendFlag', name: 'Longend Flag', type: 'string', required: false, displayOrder: 7 },
      { id: 'shiftCount', name: 'Monthly Shift Count', type: 'number', required: false, displayOrder: 8 },
      { id: 'dateOfBirth', name: 'Date of Birth', type: 'date', required: false, displayOrder: 9 },
      { id: 'gender', name: 'Gender', type: 'string', required: false, displayOrder: 10 },
      { id: 'addressLine1', name: 'Address 1', type: 'string', required: false, displayOrder: 11 },
      { id: 'addressLine2', name: 'Address 2', type: 'string', required: false, displayOrder: 12 },
      { id: 'city', name: 'City', type: 'string', required: false, displayOrder: 13 },
      { id: 'state', name: 'State', type: 'string', required: false, displayOrder: 14 },
      { id: 'postalCode', name: 'Postal Code', type: 'string', required: false, displayOrder: 15 },
      { id: 'phoneNumber', name: 'Phone Number', type: 'string', required: false, displayOrder: 16 },
      { id: 'email', name: 'Email', type: 'string', required: false, displayOrder: 17 },
    ];
    let order = 20;
    for (let w = 1; w <= 5; w++) {
      fields.push(
        { id: `week${w}CheckDate`, name: `Week ${w} Check Date`, type: 'date', required: false, displayOrder: order++ },
        { id: `week${w}Hours`, name: `Week ${w} Hours`, type: 'number', required: false, displayOrder: order++ },
        { id: `week${w}Dues`, name: `Week ${w} Dues`, type: 'number', required: false, displayOrder: order++ },
        { id: `week${w}Training`, name: `Week ${w} Training`, type: 'number', required: false, displayOrder: order++ },
        { id: `week${w}Housing`, name: `Week ${w} Housing`, type: 'number', required: false, displayOrder: order++ },
        { id: `week${w}Legal`, name: `Week ${w} Legal`, type: 'number', required: false, displayOrder: order++ },
        { id: `week${w}Pension`, name: `Week ${w} Pension`, type: 'number', required: false, displayOrder: order++ },
      );
    }
    return fields;
  }

  getSteps(): WizardStep[] {
    return [
      { id: 'upload', name: 'Upload', description: 'Upload the monthly report file' },
      { id: 'map', name: 'Parse / Map', description: 'Parse the file (Marriott S2) or map columns (generic)' },
      { id: 'weekdates', name: 'Week Dates', description: 'Confirm the date for each reporting week' },
      { id: 'validate', name: 'Validate', description: 'Validate rows, statuses, locations and rates' },
      { id: 'process', name: 'Process', description: 'Write hours, shifts, dues and worker data' },
      { id: 'review', name: 'Review', description: 'Review results' },
    ];
  }

  getStatuses(): WizardStatus[] {
    return [
      { id: 'draft', name: 'Draft', description: 'Initial draft state' },
      { id: 'complete', name: 'Complete', description: 'Upload processed' },
    ];
  }

  getLaunchArguments(): LaunchArgument[] {
    return [];
  }

  async getRecordCount(): Promise<number> {
    return 0;
  }

  protected async fetchWorkerData(): Promise<any[]> {
    return [];
  }

  async generateFeed(_config: FeedConfig, _data: any): Promise<FeedData> {
    throw new Error('GBHE Local 26 Hourly is an upload wizard; it does not generate feeds');
  }

  /* ------------------------- file loading ------------------------- */

  async loadParsedFile(wizard: { data: unknown }): Promise<ParsedFile> {
    const data = (wizard.data as any) || {};
    const fileId = data.uploadedFileId;
    if (!fileId) throw new Error('No uploaded file found');
    const file = await storage.files.getById(fileId);
    if (!file) throw new Error('File not found');
    const buffer = await objectStorageService.downloadFile(file.storagePath);

    let rawRows: any[][] = [];
    if (file.mimeType === 'text/csv') {
      rawRows = parseCSV(buffer, { columns: false, skip_empty_lines: true, relax_column_count: true });
    } else if (file.mimeType?.includes('spreadsheet') || file.mimeType?.includes('excel')) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' }) as any[][];
    } else {
      throw new Error('Unsupported file type');
    }

    const format = this.getFormat(wizard);
    return format.parse(rawRows, {
      columnMapping: data.columnMapping,
      hasHeaders: data.hasHeaders,
    });
  }

  getFormat(wizard: { data: unknown }): Local26FormatParser {
    const data = (wizard.data as any) || {};
    const formatId = data.launchArguments?.format || 'marriott_s2';
    const format = FILE_FORMATS[formatId];
    if (!format) throw new Error(`Unknown file format: ${formatId}`);
    return format;
  }

  /* ------------------- shared resolution helpers ------------------ */

  private async getEmploymentStatusOptions(): Promise<Array<{ id: string; name: string; code: string; employed: boolean }>> {
    const statuses = await unifiedOptionsStorage.list('employment-status');
    return statuses.map((s: any) => ({ id: s.id, name: s.name, code: s.code, employed: s.employed }));
  }

  /** Direct name/code match, then the employer's persistent mapping. */
  private resolveEmploymentStatus(
    value: string,
    options: Array<{ id: string; name: string; code: string }>,
    mappings: Array<{ sourceStatus: string; targetStatusId: string }>,
  ): { id: string } | null {
    const n = normKey(value);
    const direct = options.find((o) => normKey(o.name) === n || (o.code && normKey(o.code) === n));
    if (direct) return { id: direct.id };
    const mapped = mappings.find((m) => normKey(m.sourceStatus) === n);
    if (mapped) {
      const target = options.find((o) => o.id === mapped.targetStatusId);
      if (target) return { id: target.id };
    }
    return null;
  }

  /** Direct name match against accessible employers, then persistent mapping. */
  private resolveWorkLocation(
    value: string | null,
    launchEmployerId: string,
    accessibleEmployers: Array<{ id: string; name: string }>,
    mappings: Array<{ sourceLocation: string; targetEmployerId: string }>,
  ): string | null {
    if (!value) return launchEmployerId; // no location column → launch employer
    const n = normKey(value);
    const direct = accessibleEmployers.find((e) => normKey(e.name) === n);
    if (direct) return direct.id;
    const mapped = mappings.find((m) => normKey(m.sourceLocation) === n);
    if (mapped && accessibleEmployers.some((e) => e.id === mapped.targetEmployerId)) {
      return mapped.targetEmployerId;
    }
    return null;
  }

  /**
   * Expected per-hour withholding rates from the hourly charge plugin
   * configs' rate histories. A config maps to a category when its name
   * contains the category keyword (training/housing/legal/pension).
   */
  private async getExpectedRates(referenceYmd: string): Promise<Partial<Record<RateCategory, number>>> {
    const out: Partial<Record<RateCategory, number>> = {};
    try {
      const configs = await storage.pluginConfigs.search('charge', {
        pluginId: 'gbhe-hourly-charge',
        enabled: true,
      });
      for (const env of configs) {
        const nameNorm = norm((env as any).config?.name);
        const settings = ((env as any).subsidiary?.settings ?? (env as any).config?.settings) as
          | { rateHistory?: Array<{ effectiveDate: string; rate: number }> }
          | null;
        const history = settings?.rateHistory;
        if (!history || history.length === 0) continue;
        for (const cat of RATE_CATEGORIES) {
          if (out[cat] !== undefined) continue;
          if (nameNorm.includes(cat)) {
            const entry = getCurrentEffectiveRate(history, new Date(`${referenceYmd}T00:00:00Z`));
            if (entry && typeof (entry as any).rate === 'number') out[cat] = (entry as any).rate;
          }
        }
      }
    } catch (err) {
      logger.warn('Failed to load hourly charge configs for rate validation', {
        service: 'gbhe-local26-hourly',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return out;
  }

  private getWeekDates(wizard: { data: unknown }): Record<number, string> {
    const data = (wizard.data as any) || {};
    const raw = data.weekDates || {};
    const out: Record<number, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) out[parseInt(k, 10)] = v;
    }
    return out;
  }

  /** True when a week carries any reported figure at all. */
  private weekHasData(w: WeekFigures): boolean {
    return (
      w.hours !== null || w.dues !== null || w.grossPay !== null ||
      w.training !== null || w.housing !== null || w.legal !== null || w.pension !== null
    );
  }

  /* --------------------------- validate --------------------------- */

  async validateLocal26(
    wizardId: string,
    accessibleEmployers: Array<{ id: string; name: string }>,
    onProgress?: (pct: number) => void,
  ): Promise<Local26ValidationResults> {
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) throw new Error('Wizard not found');
    const launchEmployerId = wizard.entityId;
    if (!launchEmployerId) throw new Error('This wizard is not linked to an employer');

    const parsed = await this.loadParsedFile(wizard);
    const weekDates = this.getWeekDates(wizard);
    const statusOptions = await this.getEmploymentStatusOptions();
    const statusMappings = (await storage.wizardEmploymentStatusMappings.getByEmployer(launchEmployerId))
      .map((m) => ({ sourceStatus: m.sourceStatus, targetStatusId: m.targetStatusId }));
    const locationMappings = (await storage.wizardWorkLocationMappings.getByEmployer(launchEmployerId))
      .map((m) => ({ sourceLocation: m.sourceLocation, targetEmployerId: m.targetEmployerId }));

    const referenceYmd = Object.values(weekDates)[0]
      || `${(wizard.data as any)?.launchArguments?.year}-${String((wizard.data as any)?.launchArguments?.month).padStart(2, '0')}-01`;
    const expectedRates = await this.getExpectedRates(referenceYmd);

    const errors: Local26ValidationResults['errors'] = [];
    const ssnWarnings: Local26ValidationResults['ssnWarnings'] = [];
    const rateWarnings: Local26RateWarning[] = [];
    let rateWarningsTruncated = false;
    const unmappedStatuses = new Set<string>();
    const unmappedLocations = new Set<string>();
    let validRows = 0;
    let invalidRows = 0;

    // Every week that carries data must have a resolved date.
    const weeksNeedingDates = new Set<number>();
    for (const row of parsed.rows) {
      for (const w of row.weeks) if (this.weekHasData(w)) weeksNeedingDates.add(w.week);
    }
    const missingWeekDates = Array.from(weeksNeedingDates).filter((w) => !weekDates[w]);

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const rowErrors: Local26ValidationResults['errors'] = [];
      let unmatchedOnly = true;

      // SSN format (warning only, like the GBHE Legal wizards).
      const ssn = preprocessSSN(row.ssn);
      if (row.ssn && !ssn) {
        ssnWarnings.push({ rowIndex: i, value: row.ssn, message: 'SSN could not be normalized' });
      }

      // Identity: need SSN or Person Number to match, or full create data.
      const canMatch = !!ssn || !!row.personNumber;
      let mayCreate = false;
      if (!canMatch || !(ssn && (await storage.workers.getWorkerBySSN(ssn)))) {
        // Row may end up creating a worker: check create requirements.
        mayCreate = true;
      }
      if (!canMatch) {
        if (!row.fullName) {
          rowErrors.push({ rowIndex: i, field: 'identity', message: 'Row has no SSN, Person Number, or name to identify the worker' });
          unmatchedOnly = false;
        }
      }
      if (mayCreate && !canMatch) {
        // Definitely a create — enforce required contact/address data now.
        if (!row.fullName) {
          // already flagged above
        }
      }
      // Required address for creates: enforce when the worker cannot be
      // matched by SSN (payroll-ID matches are resolved at process time; a
      // row that matches neither will fail processing with a clear error).
      if (!ssn && !row.personNumber) {
        if (!row.addressLine1 || !row.city || !row.state || !row.postalCode) {
          rowErrors.push({ rowIndex: i, field: 'address', message: 'New workers require street, city, state and zip' });
          unmatchedOnly = false;
        }
      }

      // Employment status.
      if (!row.employeeStatus) {
        rowErrors.push({ rowIndex: i, field: 'employeeStatus', message: 'Employee Status is required' });
        unmatchedOnly = false;
      } else if (!this.resolveEmploymentStatus(row.employeeStatus, statusOptions, statusMappings)) {
        unmappedStatuses.add(row.employeeStatus);
      }

      // Work location.
      const resolvedEmployer = this.resolveWorkLocation(row.workLocationName, launchEmployerId, accessibleEmployers, locationMappings);
      if (!resolvedEmployer && row.workLocationName) {
        unmappedLocations.add(row.workLocationName);
      }

      // Numeric hours/dues sanity + rate comparison.
      for (const w of row.weeks) {
        if (!this.weekHasData(w)) continue;
        if (w.hours !== null && (w.hours < 0 || w.hours > 200)) {
          rowErrors.push({ rowIndex: i, field: `week${w.week}Hours`, message: 'Hours out of range (0-200)', value: w.hours });
          unmatchedOnly = false;
        }
        if (w.dues !== null && w.dues < 0) {
          rowErrors.push({ rowIndex: i, field: `week${w.week}Dues`, message: 'Dues cannot be negative', value: w.dues });
          unmatchedOnly = false;
        }
        // Warn-only rate validation against expected weekly withholdings.
        if (w.hours !== null && w.hours > 0) {
          for (const cat of RATE_CATEGORIES) {
            const rate = expectedRates[cat];
            const reported = w[cat];
            if (rate === undefined || reported === null) continue;
            const expected = Math.round(w.hours * rate * 100) / 100;
            if (Math.abs(expected - reported) > RATE_TOLERANCE) {
              if (rateWarnings.length < MAX_RATE_WARNINGS) {
                rateWarnings.push({ rowIndex: i, week: w.week, category: cat, reported, expected, hours: w.hours });
              } else {
                rateWarningsTruncated = true;
              }
            }
          }
        }
      }

      if (rowErrors.length > 0) {
        invalidRows++;
        errors.push(...rowErrors.slice(0, 12));
      } else {
        validRows++;
      }
      void unmatchedOnly;

      if (onProgress && (i % 25 === 0 || i === parsed.rows.length - 1)) {
        onProgress(Math.min(99, Math.round(((i + 1) / parsed.rows.length) * 100)));
      }
    }

    if (missingWeekDates.length > 0) {
      errors.unshift({
        rowIndex: -1,
        field: 'weekDates',
        message: `No date set for reporting week(s) ${missingWeekDates.join(', ')} — go back to the Week Dates step`,
      });
      invalidRows = Math.max(invalidRows, 1);
    }

    const errorSummary: Record<string, number> = {};
    for (const e of errors) {
      const key = `${e.field}: ${e.message}`;
      errorSummary[key] = (errorSummary[key] || 0) + 1;
    }

    const results: Local26ValidationResults = {
      totalRows: parsed.rows.length,
      validRows,
      invalidRows,
      errors,
      errorSummary,
      unmappedStatuses: Array.from(unmappedStatuses),
      unmappedLocations: Array.from(unmappedLocations),
      ssnWarnings,
      rateWarnings,
      rateWarningsTruncated,
      weeks: parsed.weeks,
      completedAt: new Date(),
    };

    const fresh = await storage.wizards.getById(wizardId);
    await storage.wizards.update(wizardId, {
      data: { ...((fresh?.data as any) || {}), validationResults: results },
    });
    return results;
  }

  /* ---------------------------- process ---------------------------- */

  async processLocal26(
    wizardId: string,
    accessibleEmployers: Array<{ id: string; name: string }>,
    onProgress?: (pct: number) => void,
  ): Promise<Local26ProcessResults> {
    const wizard = await storage.wizards.getById(wizardId);
    if (!wizard) throw new Error('Wizard not found');
    const launchEmployerId = wizard.entityId;
    if (!launchEmployerId) throw new Error('This wizard is not linked to an employer');
    const wizardData = (wizard.data as any) || {};
    if (!wizardData.validationResults) {
      throw new Error('No validation results found. Please validate the data first.');
    }
    const la = wizardData.launchArguments || {};
    const year = parseInt(String(la.year), 10);
    const month = parseInt(String(la.month), 10);
    if (!isFinite(year) || !isFinite(month)) throw new Error('Wizard launch arguments are missing year/month');
    const statementYmd = `${year}-${String(month).padStart(2, '0')}-01`;

    const parsed = await this.loadParsedFile(wizard);
    const weekDates = this.getWeekDates(wizard);
    const statusOptions = await this.getEmploymentStatusOptions();
    const statusMappings = (await storage.wizardEmploymentStatusMappings.getByEmployer(launchEmployerId))
      .map((m) => ({ sourceStatus: m.sourceStatus, targetStatusId: m.targetStatusId }));
    const locationMappings = (await storage.wizardWorkLocationMappings.getByEmployer(launchEmployerId))
      .map((m) => ({ sourceLocation: m.sourceLocation, targetEmployerId: m.targetEmployerId }));
    const employerNameById = new Map(accessibleEmployers.map((e) => [e.id, e.name]));

    const warnings: string[] = [];

    // Dues charge plugin config (one global config; account is first-class).
    let duesAccountId: string | null = null;
    try {
      const duesConfigs = await storage.pluginConfigs.search('charge', {
        pluginId: 'gbhe-local26-dues-allocation',
        enabled: true,
      });
      const withAccount = duesConfigs
        .map((env: any) => env.subsidiary?.account ?? env.config?.account ?? null)
        .filter(Boolean);
      duesAccountId = withAccount[0] ?? null;
    } catch { /* handled below */ }
    if (!duesAccountId) {
      warnings.push('GBHE Local 26 Dues Allocation charge plugin is not configured with a ledger account — no dues ledger entries were created.');
    }

    // Member status options (regular / shift / longend by code or name).
    const msOptions = await unifiedOptionsStorage.list('worker-ms');
    const findMs = (key: string) =>
      msOptions.find((o: any) => normKey(o.code) === key || normKey(o.name) === key) as
        | { id: string; industryId: string }
        | undefined;
    const msByKind = { regular: findMs('regular'), shift: findMs('shift'), longend: findMs('longend') };
    if (!msByKind.regular || !msByKind.shift || !msByKind.longend) {
      warnings.push('Member status options (regular/shift/longend) are not fully configured — member statuses were not recorded.');
    }

    // Payroll-ID worker-id type: find (or create) a "Person Number" type.
    let payrollTypeId: string | null = null;
    try {
      const idTypes = await unifiedOptionsStorage.list('worker-id-type');
      const existing = idTypes.find((t: any) => {
        const n = normKey(t.name);
        return n.includes('personnumber') || n.includes('payroll');
      });
      if (existing) {
        payrollTypeId = existing.id;
      } else {
        const created = await unifiedOptionsStorage.create('worker-id-type', { name: 'Person Number' } as any);
        payrollTypeId = (created as any).id;
        warnings.push('Created a new "Person Number" worker ID type for payroll-ID matching.');
      }
    } catch (err) {
      warnings.push(`Payroll-ID matching disabled: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Default bargaining unit: Local 26.
    const bargainingUnits = await storage.bargainingUnits.getAllBargainingUnits();
    const local26 = bargainingUnits.find((b) => norm(b.name).includes('local 26')) || null;
    if (!local26) warnings.push('No "Local 26" bargaining unit found — new workers were created without a bargaining unit.');

    const shiftsTableReady = await storage.gbhetShifts.tableExists().catch(() => false);
    if (!shiftsTableReady) {
      warnings.push('Worker shifts component table is unavailable — shift counts were not recorded (enable the GBHET Worker Shifts component).');
    }

    let createdCount = 0;
    let updatedCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    let hoursWritten = 0;
    let shiftsWritten = 0;
    let duesEventsEmitted = 0;
    let duesTotal = 0;
    let memberStatusesRecorded = 0;
    const errors: Array<{ rowIndex: number; message: string }> = [];
    const rowResults: Local26ProcessResults['rowResults'] = [];

    const { executeChargePlugins, TriggerType } = await import('../../../ledger/charge/index.js');

    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      try {
        // Resolve employer for this row.
        const employerId = this.resolveWorkLocation(row.workLocationName, launchEmployerId, accessibleEmployers, locationMappings);
        if (!employerId) {
          throw new Error(`Work location "${row.workLocationName}" is not mapped to an employer`);
        }

        // Resolve employment status.
        if (!row.employeeStatus) throw new Error('Employee Status is required');
        const status = this.resolveEmploymentStatus(row.employeeStatus, statusOptions, statusMappings);
        if (!status) throw new Error(`Employment status "${row.employeeStatus}" is not mapped`);

        // Match worker: SSN first, then payroll ID.
        const ssn = preprocessSSN(row.ssn);
        let workerId: string | null = null;
        let isNewWorker = false;
        if (ssn) {
          const existing = await storage.workers.getWorkerBySSN(ssn);
          if (existing) workerId = existing.id;
        }
        if (!workerId && payrollTypeId && row.personNumber) {
          const byPayroll = await storage.workerIds.getWorkerIdByTypeAndValue(payrollTypeId, String(row.personNumber));
          if (byPayroll) workerId = byPayroll.workerId;
        }

        if (!workerId) {
          // Create a new worker; contact + required address.
          if (!row.fullName) throw new Error('Cannot create a worker without a name');
          if (!row.addressLine1 || !row.city || !row.state || !row.postalCode) {
            throw new Error('New workers require street, city, state and zip');
          }
          const newWorker = await storage.workers.createWorker(row.fullName);
          workerId = newWorker.id;
          isNewWorker = true;
          if (ssn) await storage.workers.updateWorkerSSN(workerId, ssn);
          if (local26) await storage.workers.updateWorkerBargainingUnit(workerId, local26.id);
        }

        // Name / birth date / gender / email / phone / address updates.
        if (row.firstName || row.lastName) {
          await storage.workers.updateWorkerContactNameComponents(workerId, {
            given: row.firstName || undefined,
            family: row.lastName || undefined,
          });
        }
        if (row.birthDate) await storage.workers.updateWorkerContactBirthDate(workerId, row.birthDate);
        if (row.gender) {
          const genderOptions = await unifiedOptionsStorage.list('gender');
          const g = genderOptions.find((o: any) => normKey(o.name) === normKey(row.gender) || (o.code && normKey(o.code) === normKey(row.gender)));
          if (g) await storage.workers.updateWorkerContactGender(workerId, g.id, null);
        }
        if (row.email) await storage.workers.updateWorkerContactEmail(workerId, row.email);

        const worker = await storage.workers.getWorker(workerId);
        if (!worker) throw new Error('Worker disappeared during processing');
        const contactId = worker.contactId;

        if (row.phoneNumber) {
          const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(contactId);
          if (existingPhones.length === 0) {
            await storage.contacts.phoneNumbers.createPhoneNumber({ contactId, phoneNumber: row.phoneNumber, isPrimary: true });
          }
        }

        if (row.addressLine1 && row.city && row.state && row.postalCode) {
          const incoming = {
            street: row.addressLine2 ? `${row.addressLine1} ${row.addressLine2}` : row.addressLine1,
            city: row.city,
            state: row.state,
            postalCode: String(row.postalCode).padStart(5, '0'),
            country: 'US',
          };
          const existingAddresses = await storage.contacts.addresses.getContactPostalByContact(contactId);
          const eq = (a: string | null | undefined, b: string) => (a ?? '').trim().toUpperCase() === b.trim().toUpperCase();
          const alreadyPresent = existingAddresses.some((a: any) =>
            a.isActive && eq(a.street, incoming.street) && eq(a.city, incoming.city) &&
            eq(a.state, incoming.state) && eq(a.postalCode, incoming.postalCode) && eq(a.country, incoming.country));
          if (!alreadyPresent) {
            const currentPrimary = existingAddresses.find((a: any) => a.isPrimary && a.isActive);
            const makePrimary = !currentPrimary || (currentPrimary as any).source !== 'worker_self';
            await storage.contacts.addresses.createContactPostal({
              contactId,
              ...incoming,
              source: 'employer_feed',
              isPrimary: makePrimary,
            });
          }
        }

        // Payroll ID (Person Number) — store when missing.
        if (payrollTypeId && row.personNumber) {
          const value = String(row.personNumber);
          const existing = await storage.workerIds.getWorkerIdByTypeAndValue(payrollTypeId, value);
          if (!existing) {
            await storage.workerIds.createWorkerId({ workerId, typeId: payrollTypeId, value });
          }
        }

        // Weekly hours + dues events.
        for (const w of row.weeks) {
          if (!this.weekHasData(w)) continue;
          const weekYmd = weekDates[w.week];
          if (!weekYmd) throw new Error(`No date resolved for reporting week ${w.week}`);
          const [wy, wm, wd] = weekYmd.split('-').map((p) => parseInt(p, 10));

          await storage.workerHours.upsertWorkerHours({
            workerId,
            employerId,
            employmentStatusId: status.id,
            year: wy,
            month: wm,
            day: wd,
            hours: w.hours ?? 0,
          });
          hoursWritten++;

          if (duesAccountId && w.dues !== null && w.dues > 0) {
            const duesContext = {
              trigger: TriggerType.DUES_IMPORT_SAVED,
              wizardId,
              rowIndex: i,
              workerId,
              workerName: row.fullName || `Worker ${worker.siriusId}`,
              bpsEmployeeId: row.personNumber ? String(row.personNumber) : '',
              amount: w.dues.toFixed(2),
              transactionDate: new Date(`${weekYmd}T00:00:00Z`),
              accountId: duesAccountId,
              deductionCode: null,
              memo: `Local 26 dues week ${weekYmd}`,
              weekYmd,
              withholdingEmployerId: employerId,
              withholdingEmployerName: employerNameById.get(employerId) ?? null,
            };
            const execResult = await executeChargePlugins(duesContext as any);
            const failedExec = (execResult.executed ?? []).find((e: any) => !e.success);
            if (execResult.entryCreationError) {
              throw new Error(
                `Dues ledger entry failed for week ${weekYmd}: ${execResult.entryCreationError}`
              );
            }
            if (failedExec) {
              throw new Error(
                `Dues charge plugin failed for week ${weekYmd}: ${failedExec.error || failedExec.message || 'unknown error'}`
              );
            }
            duesEventsEmitted++;
            duesTotal += w.dues;
          }
        }

        // Monthly shift count.
        if (shiftsTableReady && row.shiftCount !== null) {
          await storage.gbhetShifts.upsert({
            workerId,
            statementYmd,
            shiftCount: row.shiftCount,
            data: { source: 'gbhe_local26_hourly', wizardId },
          });
          shiftsWritten++;
        }

        // Member status: longend > shift > regular.
        const kind: 'regular' | 'shift' | 'longend' = row.longendFlag
          ? 'longend'
          : (row.shiftCount !== null && row.shiftCount > 0 ? 'shift' : 'regular');
        const msOption = msByKind[kind];
        if (msOption) {
          const currentIds = await storage.workerMsh.getCurrentMemberStatusIds(workerId);
          if (!currentIds.includes(msOption.id)) {
            const history = await storage.workerMsh.getWorkerMsh(workerId);
            const dup = history.some((h: any) => h.date === statementYmd && h.industryId === msOption.industryId);
            if (!dup) {
              await storage.workerMsh.createWorkerMsh({
                workerId,
                date: statementYmd,
                msId: msOption.id,
                industryId: msOption.industryId,
                data: { source: 'gbhe_local26_hourly', wizardId },
              });
              memberStatusesRecorded++;
            }
          }
        }

        if (isNewWorker) createdCount++; else updatedCount++;
        rowResults.push({ rowIndex: i, status: 'success', message: `Worker ${isNewWorker ? 'created' : 'updated'}` });
      } catch (err) {
        failureCount++;
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ rowIndex: i, message });
        rowResults.push({ rowIndex: i, status: 'error', message });
      }

      if (onProgress && (i % 5 === 0 || i === parsed.rows.length - 1)) {
        onProgress(Math.min(99, Math.round(((i + 1) / parsed.rows.length) * 100)));
      }
    }

    const results: Local26ProcessResults = {
      totalRows: parsed.rows.length,
      createdCount,
      updatedCount,
      successCount: createdCount + updatedCount,
      failureCount,
      skippedCount,
      hoursWritten,
      shiftsWritten,
      duesEventsEmitted,
      duesTotal: duesTotal.toFixed(2),
      memberStatusesRecorded,
      warnings,
      errors,
      rowResults,
      rateWarningsCount: (wizardData.validationResults?.rateWarnings || []).length,
      completedAt: new Date(),
    };

    const fresh = await storage.wizards.getById(wizardId);
    await storage.wizards.update(wizardId, {
      data: { ...((fresh?.data as any) || {}), processResults: results },
      status: 'complete',
    });
    return results;
  }
}

export const gbheLocal26Hourly = new GbheLocal26HourlyWizard();
