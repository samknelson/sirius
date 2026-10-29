/** Display a sheet's date-only ymd directly, without timezone conversion. */
export function formatEdlsSheetLabel(sheet: { ymd: string; title: string }): string {
  const title = sheet.title.trim();
  const number = /^#?\s*(\d+)$/.exec(title);
  return `${sheet.ymd} - ${number ? `#${number[1]}` : title}`;
}
