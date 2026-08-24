/**
 * Freeman passport export response mapping.
 *
 * Pure translation from the storage page (see
 * `server/storage/edls/passport-export.ts`) into the legacy Drupal service's
 * envelope. The legacy byte shape is the contract, quirks included:
 *
 * - the payload is double-wrapped in `data.data`;
 * - `paging.total_records` is a STRING while `page` / `limit` / `offset` are
 *   numbers;
 * - a sheet's `count` is the string `"<assigned> / <planned>"`;
 * - `version` is `<sheet id>::<latest snapshot id>`, with an empty second
 *   half when the sheet has never been snapshotted;
 * - `status` is always the literal `"Scheduled"` (only `lock` sheets are
 *   exported) and `hall` is always null.
 *
 * No database access, no request handling — this module only formats.
 */
import { parseYmdParts, ymdToLocalDate } from "@shared/utils/date";
import type {
  EdlsPassportAssignment,
  EdlsPassportCrew,
  EdlsPassportExportPage,
  EdlsPassportSheet,
  EdlsPassportUser,
} from "../../storage/edls/passport-export";

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The one status the export emits — only `lock` sheets are exported. */
const SCHEDULED_STATUS_LABEL = "Scheduled";

export interface PassportExportPaging {
  /** String, not a number — legacy quirk. */
  total_records: string;
  page: number;
  limit: number;
  offset: number;
}

export interface PassportExportAssignmentExtra {
  time: string | null;
  classification: string | null;
  note: string | null;
}

export interface PassportExportAssignment {
  worker_name: string;
  worker_ms: string | null;
  worker_id: number | null;
  worker_empid: string | null;
  assignment_extra: PassportExportAssignmentExtra;
}

export interface PassportExportCrew {
  uuid: string;
  name: string;
  task: string;
  start_time: string | null;
  end_time: string | null;
  checkin_location: string | null;
  count: number;
  crewlead: string;
  supervisor: string | null;
  assignments: PassportExportAssignment[];
}

export interface PassportExportSheet {
  uuid: string;
  nid: string;
  title: string;
  version: string;
  status: string;
  employer: string | null;
  supervisor: string | null;
  creator: string | null;
  changed_date: string;
  date: string;
  event: string | null;
  event_status: string | null;
  dept: string | null;
  job_number: string;
  facility: string | null;
  hall: null;
  count: string;
  notes: string;
  crews: PassportExportCrew[];
}

export interface PassportExportEnvelope {
  success: true;
  ts: number;
  is_remote: true;
  data: {
    success: true;
    data: {
      paging: PassportExportPaging;
      sheets: PassportExportSheet[];
    };
  };
  minilog: string;
  drupal_messages: unknown[];
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Name a user the way the rest of the app does: first and last name, falling
 * back to the email address. Null when there is no user.
 */
export function formatUserName(user: EdlsPassportUser | null): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || user.email || null;
}

/**
 * RFC-2822 style timestamp in the server's local zone, e.g.
 * `Wed, 13 May 2026 13:17:02 -0700`.
 */
export function formatRfc2822(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absOffset = Math.abs(offsetMinutes);
  const offset = `${sign}${pad2(Math.floor(absOffset / 60))}${pad2(absOffset % 60)}`;
  return (
    `${WEEKDAYS_SHORT[date.getDay()]}, ${pad2(date.getDate())} ${MONTHS_SHORT[date.getMonth()]} ` +
    `${date.getFullYear()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${offset}`
  );
}

/**
 * A plain date field rendered as `Tuesday, May 19, 2026`. Built from the Ymd's
 * own components (never `new Date(ymd)`), so there is no timezone conversion.
 */
export function formatLongDate(ymd: string): string {
  const { year, month, day } = parseYmdParts(ymd);
  const weekday = WEEKDAYS_LONG[ymdToLocalDate(ymd).getDay()];
  return `${weekday}, ${MONTHS_LONG[month - 1]} ${day}, ${year}`;
}

/** `HH:MM:SS` (or `HH:MM`) trimmed to `HH:MM`. */
function formatHourMinute(time: string | null): string | null {
  if (!time) return null;
  return time.slice(0, 5);
}

function mapAssignment(assignment: EdlsPassportAssignment): PassportExportAssignment {
  return {
    worker_name: [assignment.workerFamily ?? "", assignment.workerGiven ?? ""].join(", "),
    worker_ms: assignment.memberStatusCode,
    worker_id: assignment.workerSiriusId,
    worker_empid: assignment.employeeId,
    assignment_extra: {
      time: assignment.startTime,
      classification: assignment.classificationName,
      note: assignment.note,
    },
  };
}

function mapCrew(crew: EdlsPassportCrew): PassportExportCrew {
  return {
    uuid: crew.id,
    name: crew.title,
    task: crew.taskName ?? "",
    start_time: formatHourMinute(crew.startTime),
    end_time: formatHourMinute(crew.endTime),
    checkin_location: crew.location,
    count: crew.workerCount,
    crewlead: crew.crewleadSiriusId ?? "",
    supervisor: formatUserName(crew.supervisorUser),
    assignments: crew.assignments.map(mapAssignment),
  };
}

function mapSheet(sheet: EdlsPassportSheet): PassportExportSheet {
  return {
    uuid: sheet.id,
    nid: sheet.id,
    title: sheet.title,
    version: `${sheet.id}::${sheet.latestSnapshotId ?? ""}`,
    status: SCHEDULED_STATUS_LABEL,
    employer: sheet.employerName,
    supervisor: formatUserName(sheet.supervisorUser),
    creator: formatUserName(sheet.creatorUser),
    changed_date: formatRfc2822(sheet.changed),
    date: formatLongDate(sheet.ymd),
    event: sheet.jobGroupName,
    event_status: sheet.showStatusName,
    dept: sheet.departmentName,
    job_number: sheet.title,
    facility: sheet.facilityName,
    hall: null,
    count: `${sheet.assignedCount} / ${sheet.workerCount}`,
    notes: sheet.notes ?? "",
    crews: sheet.crews.map(mapCrew),
  };
}

/**
 * Wrap one storage page in the legacy envelope. `now` is injectable so the
 * `ts` field is testable; it defaults to the current time.
 */
export function buildPassportExportEnvelope(
  page: EdlsPassportExportPage,
  paging: { page: number; limit: number },
  now: Date = new Date(),
): PassportExportEnvelope {
  return {
    success: true,
    ts: Math.floor(now.getTime() / 1000),
    is_remote: true,
    data: {
      success: true,
      data: {
        paging: {
          total_records: String(page.total),
          page: paging.page,
          limit: paging.limit,
          offset: paging.page * paging.limit,
        },
        sheets: page.sheets.map(mapSheet),
      },
    },
    minilog: "",
    drupal_messages: [],
  };
}
