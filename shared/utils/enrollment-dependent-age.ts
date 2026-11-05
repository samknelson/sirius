import { formatYmd } from "./date";

// These are the configured option NAMES, in subscriber → dependent direction.
// In particular, "Parent" describes the subscriber, not the dependent.
// Do not substitute carrier/S1 relation codes, which use another taxonomy.
export const CHILD_ENROLLMENT_RELATIONSHIPS = [
  "Parent", "Parent of Adopted Child", "Parent of Handicapped Child",
  "QMSCO Child", "Step Parent",
] as const;
export const ADULT_ENROLLMENT_RELATIONSHIPS = [
  "Domestic Partner", "Ex Spouse", "Guardian", "Responsible Party", "Spouse",
] as const;
export const ADULT_RELATIONSHIP_GUIDANCE =
  "Choose Domestic Partner, Ex Spouse, Guardian, Responsible Party, or Spouse.";
export const DEPENDENT_AGE_ERROR =
  `This dependent is age 26 or older and cannot be added with this relationship. ${ADULT_RELATIONSHIP_GUIDANCE}`;

const normalizeName = (name: string) => name.trim().toLowerCase();
export function classifyEnrollmentRelationship(name: string): "child" | "adult" | "other" {
  const normalized = normalizeName(name);
  if (CHILD_ENROLLMENT_RELATIONSHIPS.some(value => normalizeName(value) === normalized)) return "child";
  if (ADULT_ENROLLMENT_RELATIONSHIPS.some(value => normalizeName(value) === normalized)) return "adult";
  return "other";
}

const leapYear = (year: number) => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
function realDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

/** Date-only arithmetic. Feb 29 birthdays fall on March 1 in non-leap years. */
function birthday(birthDate: string, years: number): string {
  const [year, month, day] = birthDate.split("-").map(Number);
  const targetYear = year + years;
  const suffix = month === 2 && day === 29 && !leapYear(targetYear)
    ? "03-01" : birthDate.slice(5);
  return `${String(targetYear).padStart(4, "0")}-${suffix}`;
}

export interface DependentAgeEvaluation {
  error: string | null;
  warning: string | null;
  adultOnly: boolean;
  twentySixthBirthday?: string;
}

/**
 * today is the APPLICATION calendar date, supplied by the server, never the
 * viewer's local/display date or a plan-effective month.
 */
export function evaluateEnrollmentDependentAge(
  birthDate: unknown,
  relationshipName: string | undefined,
  today: string,
): DependentAgeEvaluation {
  if (!realDate(today)) throw new Error("Application calendar date is unavailable");
  if (!realDate(birthDate)) {
    return { error: "Enter a real date of birth in YYYY-MM-DD format.", warning: null, adultOnly: false };
  }
  if (birthDate > today) {
    return { error: "Date of birth cannot be in the future.", warning: null, adultOnly: false };
  }
  const twentySixthBirthday = birthday(birthDate, 26);
  const adultOnly = today >= twentySixthBirthday;
  const classification = relationshipName ? classifyEnrollmentRelationship(relationshipName) : undefined;
  return {
    adultOnly,
    twentySixthBirthday,
    error: adultOnly && classification !== undefined && classification !== "adult"
      ? DEPENDENT_AGE_ERROR : null,
    warning: !adultOnly && today >= birthday(birthDate, 25) && classification === "child"
      ? `This dependent turns 26 on ${formatYmd(twentySixthBirthday)}. Adding is allowed now, but this child relationship cannot be added starting on that birthday.`
      : null,
  };
}
