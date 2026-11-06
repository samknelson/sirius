/** Additional directory filters; singular fields remain supported for saved/legacy callers. */
export interface WorkerDirectoryFilters {
  employerIds?: string[];
  employmentStatusIds?: string[];
  employmentMode?: "current" | "ever" | "custom";
  memberStatusIds?: string[];
  workStatusIds?: string[];
  workStatusActive?: "yes" | "no";
  bargainingUnitIds?: string[];
  benefitIds?: string[];
  representativeIds?: string[];
  fieldRepIds?: string[];
  isSteward?: "yes" | "no";
}

export class WorkerDirectoryFilterError extends Error {}

const arrayKeys = [
  "employerIds", "employmentStatusIds", "memberStatusIds", "workStatusIds",
  "bargainingUnitIds", "benefitIds", "representativeIds", "fieldRepIds",
] as const;

/** Accept JSON arrays or the existing query serializer's comma-separated strings. */
export function normalizeWorkerDirectoryFilters(input: Record<string, unknown>): WorkerDirectoryFilters {
  const result: WorkerDirectoryFilters = {};
  for (const key of arrayKeys) {
    const raw = input[key];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw !== "string" && !Array.isArray(raw)) {
      throw new WorkerDirectoryFilterError(`${key} must be a list of IDs`);
    }
    const values = typeof raw === "string" ? raw.split(",") : raw;
    if (values.length > 1000 || values.some(value => typeof value !== "string" || value.length > 255)) {
      throw new WorkerDirectoryFilterError(`${key} must contain at most 1000 valid IDs`);
    }
    const ids = [...new Set((values as string[]).map(value => value.trim()).filter(value => value && value !== "all"))];
    if (ids.length) result[key] = ids;
  }
  const mode = input.employmentMode;
  if (mode !== undefined && mode !== "") {
    if (mode !== "current" && mode !== "ever" && mode !== "custom") {
      throw new WorkerDirectoryFilterError("employmentMode must be current, ever, or custom");
    }
    result.employmentMode = mode;
  }
  const active = input.workStatusActive === "active" ? "yes" : input.workStatusActive === "inactive" ? "no" : input.workStatusActive;
  if (active !== undefined && active !== "" && active !== "all") {
    if (active !== "yes" && active !== "no") throw new WorkerDirectoryFilterError("workStatusActive must be yes or no");
    result.workStatusActive = active;
  }
  if (input.isSteward !== undefined && input.isSteward !== "" && input.isSteward !== "all") {
    if (input.isSteward !== "yes" && input.isSteward !== "no") throw new WorkerDirectoryFilterError("isSteward must be yes or no");
    result.isSteward = input.isSteward;
  }
  // Employer-dependent filters have no meaning without a selected employer.
  // Do not invent a new default for restored singular filters: absence means ever.
  if (!result.employerIds?.length && !(typeof input.employerId === "string" && input.employerId && input.employerId !== "all")) {
    delete result.employmentMode;
    delete result.employmentStatusIds;
  }
  return result;
}
