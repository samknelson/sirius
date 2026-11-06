/**
 * Normalize employer-relative filters without changing the meaning of a
 * restored legacy singular employer selection.
 */
export function normalizeEmployerEmploymentFilters<
  T extends {
    employerId?: string;
    employerIds?: string[];
    employmentStatusIds?: string[];
    employmentMode?: "current" | "ever" | "custom";
  },
>(filters: T): T {
  const next = { ...filters };
  const legacyEmployerId = filters.employerId;
  const hasEmployerArray = Boolean(filters.employerIds?.length);

  if (!hasEmployerArray && legacyEmployerId && legacyEmployerId !== "all") {
    next.employerIds = [legacyEmployerId];
    next.employmentMode = filters.employmentMode ?? "ever";
  }

  if (!next.employerIds?.length) {
    next.employmentStatusIds = [];
    next.employmentMode = undefined;
  } else if (next.employmentMode === "current" || next.employmentMode === "ever") {
    next.employmentStatusIds = [];
  }

  return next;
}

/**
 * A newly added employer scope defaults to current employment. Existing
 * explicit current/ever/custom choices survive employer edits.
 */
export function updateEmployerSelection<
  T extends {
    employerIds?: string[];
    employmentStatusIds?: string[];
    employmentMode?: "current" | "ever" | "custom";
  },
>(previous: T, employerIds: string[]): T {
  if (employerIds.length === 0) {
    return { ...previous, employerIds: [], employmentStatusIds: [], employmentMode: undefined };
  }

  const isFirstEmployer = (previous.employerIds?.length ?? 0) === 0;
  return {
    ...previous,
    employerIds,
    employmentMode: isFirstEmployer ? "current" : previous.employmentMode ?? "current",
    employmentStatusIds:
      previous.employmentMode === "custom" ? previous.employmentStatusIds ?? [] : [],
  };
}
