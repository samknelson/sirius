/** Presentation only. Never use these DTOs to update a source record. */
export const MASK_POLICY_VERSION = 1;
export type MaskPolicy = {
  version: typeof MASK_POLICY_VERSION;
  mode: "on" | "off";
  revision: number;
};
export type MaskState = MaskPolicy | { version: 1; mode: "unknown"; revision: 0 };

export function readMaskState(value: unknown): MaskState {
  const state = value as Partial<MaskPolicy> | null;
  if (state?.version === MASK_POLICY_VERSION &&
      (state.mode === "on" || state.mode === "off") &&
      Number.isSafeInteger(state.revision) && state.revision! > 0) {
    return { version: 1, mode: state.mode, revision: state.revision! };
  }
  return { version: 1, mode: "unknown", revision: 0 };
}

/** Ordinary whole-session saves cannot introduce, erase or roll back policy. */
export function preserveMaskState(incoming: unknown, existing: unknown): Record<string, unknown> {
  const { maskMode: _ignored, ...rest } = incoming as Record<string, unknown>;
  const prior = existing as Record<string, unknown>;
  const actor = (session: any) => session.masqueradeUserId ?? session.passport?.user?.dbUser?.id;
  const policy = readMaskState(prior.maskMode);
  // An effective-actor change is another presentation generation. Never let
  // another tab retain a cache under the old actor's generation.
  if (policy.mode !== "unknown" && actor(rest) !== actor(prior)) {
    return { ...rest, maskMode: { ...policy, revision: policy.revision + 1 } };
  }
  return Object.prototype.hasOwnProperty.call(prior, "maskMode")
    ? { ...rest, maskMode: prior.maskMode } : rest;
}

// Strict policy deliberately does NOT retain first names or last-four fragments.
export function maskName(_value: unknown): string { return "Name withheld"; }
export function maskSsn(_value: unknown): string { return "Withheld"; }
export function maskId(_value: unknown): string { return "Withheld"; }

export interface TrainingPerson {
  reference: string;
  label: "Training person";
  birthYear: string | null;
  ageGroup: "90 or older" | null;
}

/** A positive allowlist; no object spreads, original keys, IDs or names. */
export function projectTrainingPerson(
  source: { birthDate: string | null },
  randomReference: string,
  currentYear: number,
): TrainingPerson {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(source.birthDate ?? "");
  const year = match ? Number(match[1]) : 0;
  const month = match ? Number(match[2]) : 0;
  const day = match ? Number(match[3]) : 0;
  const check = new Date(Date.UTC(year, month - 1, day));
  const valid = year >= 1900 && year <= currentYear &&
    check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  // Conservative: suppress the year for everyone who could be 90 this year.
  const older = valid && currentYear - year >= 90;
  return {
    reference: randomReference,
    label: "Training person",
    birthYear: valid && !older ? String(year) : null,
    ageGroup: older ? "90 or older" : null,
  };
}
