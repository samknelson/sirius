import { desc } from "drizzle-orm";
import { edlsSheets } from "@shared/schema";

export function getEdlsSheetsPageOrder() {
  // Offset pagination requires a unique final key. Dates are intentionally not
  // unique, so the ID tie-breaker prevents rows moving between page requests.
  return [desc(edlsSheets.ymd), desc(edlsSheets.id)];
}