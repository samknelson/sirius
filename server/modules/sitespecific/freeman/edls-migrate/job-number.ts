const NO_JOB_NUMBER = "(no job number)";

/** The source title is only a fallback; arbitrary title text is not a job number. */
export function importedJobNumber(source: Record<string, unknown>): string {
  for (const key of ["job_number", "jobNumber"]) {
    const value = source[key];
    const explicit = typeof value === "string" || typeof value === "number"
      ? String(value).trim().match(/^#?\s*(\d+)$/)?.[1]
      : undefined;
    if (explicit) return explicit;
  }

  for (const key of ["title", "name"]) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const fromTitle = value.trim().match(/^.+?\s+\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*#(\d+)$/)?.[1];
    if (fromTitle) return fromTitle;
  }
  return NO_JOB_NUMBER;
}