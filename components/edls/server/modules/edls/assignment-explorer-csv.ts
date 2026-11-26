import { stringify } from "csv-stringify/sync";
import { getCommStatusLabel } from "@shared/commStatus";
import { notifiedOptions, assignmentSheetStatusLabels, type AssignmentExplorerRow } from "../../../shared/edls-assignment-explorer";

export const assignmentCsvHeader = [
  "Assignment ID", "Date", "Worker", "Worker identifier", "Sheet", "Sheet link",
  "Sheet status", "Crew", "Task", "Effective start time", "Accepted?", "Notified?",
  "Communication status", "In Population?",
];

/** Quote CSV syntax and neutralize formula prefixes, including leading controls. */
export function assignmentCsvLine(values: unknown[]): string {
  return stringify([values.map(value => {
    const text = value == null ? "" : String(value);
    return /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  })], { record_delimiter: "\r\n", quoted_match: /[\r\n]/ });
}

export function assignmentCsvRow(row: AssignmentExplorerRow): string {
  return assignmentCsvLine([
    row.id, row.ymd, row.workerName, row.workerIdentifier, row.sheetTitle,
    `/edls/sheet/${encodeURIComponent(row.sheetId)}`, assignmentSheetStatusLabels[row.sheetStatus] ?? row.sheetStatus, row.crewTitle,
    row.taskName, row.startTime, row.accepted === null ? "No Answer" : row.accepted ? "Yes" : "No",
    notifiedOptions[row.notified], row.commId ? getCommStatusLabel(row.commStatus) : "",
    row.inPopulation ? "Yes" : "No",
  ]);
}
