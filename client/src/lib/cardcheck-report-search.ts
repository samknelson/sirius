export interface SearchableCardcheckReportItem {
  workerName: string;
  workerSiriusId: number | null;
}

export function matchesCardcheckReportSearch(
  item: SearchableCardcheckReportItem,
  searchTerm: string,
): boolean {
  const normalized = searchTerm.toLowerCase();
  return item.workerName.toLowerCase().includes(normalized) ||
    (item.workerSiriusId != null && String(item.workerSiriusId).includes(normalized));
}