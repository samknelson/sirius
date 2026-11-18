import * as XLSX from "xlsx";

/** Keep the cell's displayed text for identifiers only. A numeric spreadsheet
 * cell formatted as 000000000 still has its meaningful leading zeros; the raw
 * number must not turn that alternate identifier into a different SSN.
 * Numeric hours, money and date cells retain their existing raw representations.
 */
export function restoreSpreadsheetIdentityText(
  sheet: XLSX.WorkSheet, rows: any[][], columns: number[],
): any[][] {
  const formatted = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, raw: false, defval: "" });
  return rows.map((row, index) => row.map((value, column) =>
    columns.includes(column) ? formatted[index]?.[column] ?? value : value));
}

/** Mapping column numbers refer to the compact (empty columns removed) grid. */
export function mappedSpreadsheetRows(sheet: XLSX.WorkSheet, mapping: Record<string, string>): any[][] {
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  const width = Math.max(0, ...rows.map(row => row.length));
  const retained = Array.from({ length: width }, (_, i) => i)
    .filter(column => rows.some(row => row[column] != null && row[column] !== ""));
  const columns = Object.entries(mapping).filter(([, field]) => field === "ssn")
    .map(([column]) => retained[Number(column.replace("col_", ""))]);
  return restoreSpreadsheetIdentityText(sheet, rows, columns);
}
