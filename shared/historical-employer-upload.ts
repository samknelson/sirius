/** Historical uploads retain their real wizard type/status, never runnable data. */
export const HISTORICAL_UPLOAD_REFUSAL =
  "This is historical S1 upload history. Its file is unavailable in S2. Resume, processing, download, rerun, and editing are not supported.";

export interface HistoricalEmployerUpload {
  kind: "s1-employer-upload";
  version: 1;
  feedNid: number;
  parentNid: number;
  employerNid: number;
  sourceType: string;
  sourceStatus: "complete" | "draft";
  createdEpoch: number;
  changedEpoch: number | null;
  year: number;
  month: number;
  postComplete: boolean | null;
  reviewComplete: boolean | null;
  fileAvailable: false;
}

export function historicalEmployerUpload(data: unknown): HistoricalEmployerUpload | undefined {
  if (!data || typeof data !== "object") return undefined;
  const history = (data as Record<string, unknown>).historicalEmployerUpload;
  if (!history || typeof history !== "object") return undefined;
  return (history as HistoricalEmployerUpload).kind === "s1-employer-upload"
    ? history as HistoricalEmployerUpload : undefined;
}
