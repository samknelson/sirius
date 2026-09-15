/**
 * Filters for the worker's retained benefit-role history summary.
 *
 * The role values are intentionally narrowed to the two meaningful answers
 * here.  "any" is an input-only value and is omitted by the normalizer, as is
 * a blank value.
 */
export interface WorkerBenefitRoleFilters {
  isSubscriber?: "any" | "yes" | "no";
  isDependent?: "any" | "yes" | "no";
  subscriberSinceFrom?: string;
  subscriberSinceThrough?: string;
  dependentSinceFrom?: string;
  dependentSinceThrough?: string;
}

export class WorkerBenefitRoleFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerBenefitRoleFilterError";
  }
}

type RoleFilterValue = "any" | "yes" | "no";

const ROLE_FILTER_FIELDS = ["isSubscriber", "isDependent"] as const;
const DATE_FILTER_FIELDS = [
  "subscriberSinceFrom",
  "subscriberSinceThrough",
  "dependentSinceFrom",
  "dependentSinceThrough",
] as const;

/**
 * Normalize values received from query-string-like objects.  `object` is
 * deliberately used instead of `Record<string, unknown>`: callers commonly
 * pass a typed request/query object that has named properties but no index
 * signature.
 *
 * Disabled benefit deployments must not validate or otherwise inspect role
 * filter input.  The summary table is component-owned and may not exist in
 * those deployments.
 */
export function normalizeWorkerBenefitRoleFilters(
  input: object,
  enabled: boolean,
): WorkerBenefitRoleFilters {
  if (!enabled) return {};

  if (input === null || (typeof input !== "object" && typeof input !== "function")) {
    throw new WorkerBenefitRoleFilterError(
      "Worker benefit role filters must be an object",
    );
  }

  const source = input as { [key: string]: unknown };
  const normalized: WorkerBenefitRoleFilters = {};

  for (const field of ROLE_FILTER_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new WorkerBenefitRoleFilterError(
        `${field} must be one of 'any', 'yes', or 'no'`,
      );
    }

    const trimmed = value.trim() as RoleFilterValue | "";
    if (trimmed === "" || trimmed === "any") continue;
    if (trimmed !== "yes" && trimmed !== "no") {
      throw new WorkerBenefitRoleFilterError(
        `${field} must be one of 'any', 'yes', or 'no'`,
      );
    }
    normalized[field] = trimmed;
  }

  for (const field of DATE_FILTER_FIELDS) {
    const value = source[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new WorkerBenefitRoleFilterError(
        `${field} must be a YYYY-MM value`,
      );
    }

    const trimmed = value.trim();
    if (trimmed === "") continue;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(trimmed)) {
      throw new WorkerBenefitRoleFilterError(
        `${field} must be a valid YYYY-MM value`,
      );
    }
    normalized[field] = trimmed;
  }

  const ranges: Array<{
    label: string;
    from?: string;
    through?: string;
  }> = [
    {
      label: "subscriberSince",
      from: normalized.subscriberSinceFrom,
      through: normalized.subscriberSinceThrough,
    },
    {
      label: "dependentSince",
      from: normalized.dependentSinceFrom,
      through: normalized.dependentSinceThrough,
    },
  ];

  for (const range of ranges) {
    if (range.from && range.through && range.from > range.through) {
      throw new WorkerBenefitRoleFilterError(
        `${range.label}From must be on or before ${range.label}Through`,
      );
    }
  }

  return normalized;
}