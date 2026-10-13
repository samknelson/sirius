/** Monthly coverage checkpoints used by discovery and continuation scans. */
export function wmbScanWindow(month: number, year: number) {
  const previous = month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year };
  const monthEndYmd = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  return { previous, monthEndYmd, period: year * 12 + month };
}
