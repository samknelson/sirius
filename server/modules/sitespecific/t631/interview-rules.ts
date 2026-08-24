/**
 * Pure persona rules for T631 job interviews.
 *
 * Kept side-effect free (no storage, no express) so the enforcement matrix
 * can be verified directly by scripts/oneoffs/verify-t631-interview-personas.ts.
 * The route layer resolves WHO the caller is; this module decides WHAT that
 * persona may do. A caller may hold several personas at once (e.g. a staff
 * member who is also a worker) — capabilities are the union.
 */

export type InterviewStatus = "offered" | "accepted" | "declined" | "passed" | "failed";
export type InterviewPersona = "staff" | "employer" | "worker";
export type CommentSlot = "worker" | "employer" | "staff";

export const INTERVIEW_STATUSES: InterviewStatus[] = [
  "offered",
  "accepted",
  "declined",
  "passed",
  "failed",
];

/** Employers only ever see interviews in these statuses. */
export const EMPLOYER_VISIBLE_STATUSES: ReadonlySet<InterviewStatus> = new Set([
  "accepted",
  "passed",
  "failed",
]);

export interface InterviewComments {
  worker?: string;
  employer?: string;
  staff?: string;
}

/** Targets a single persona may move an interview to from `current`. */
function targetsForPersona(persona: InterviewPersona, current: InterviewStatus): InterviewStatus[] {
  switch (persona) {
    case "staff":
      return INTERVIEW_STATUSES.filter((s) => s !== current);
    case "worker":
      return current === "offered" ? ["accepted", "declined"] : [];
    case "employer":
      return current === "accepted" ? ["passed", "failed"] : [];
  }
}

/** Union of allowed targets for all personas the caller holds. */
export function allowedTargetStatuses(
  personas: InterviewPersona[],
  current: InterviewStatus,
): InterviewStatus[] {
  const set = new Set<InterviewStatus>();
  for (const p of personas) for (const t of targetsForPersona(p, current)) set.add(t);
  return INTERVIEW_STATUSES.filter((s) => set.has(s));
}

/** Comment slots the caller may edit. Staff edit any slot. */
export function editableCommentSlots(personas: InterviewPersona[]): CommentSlot[] {
  if (personas.includes("staff")) return ["worker", "employer", "staff"];
  const slots: CommentSlot[] = [];
  if (personas.includes("worker")) slots.push("worker");
  if (personas.includes("employer")) slots.push("employer");
  return slots;
}

export interface TransitionValidation {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a status change (undefined target = comment-only save, always a
 * valid "transition" for anyone holding at least one persona).
 */
export function validateTransition(
  personas: InterviewPersona[],
  current: InterviewStatus,
  target: InterviewStatus | undefined,
): TransitionValidation {
  if (personas.length === 0) return { ok: false, reason: "No access to this interview" };
  if (target === undefined || target === current) return { ok: true };
  if (!allowedTargetStatuses(personas, current).includes(target)) {
    return {
      ok: false,
      reason: `Your role cannot change this interview from '${current}' to '${target}'`,
    };
  }
  return { ok: true };
}

/** Validate that every edited comment slot belongs to the caller. */
export function validateCommentEdits(
  personas: InterviewPersona[],
  edits: InterviewComments | undefined,
): TransitionValidation {
  if (!edits) return { ok: true };
  const editable = new Set(editableCommentSlots(personas));
  for (const slot of Object.keys(edits) as CommentSlot[]) {
    if (!editable.has(slot)) {
      return { ok: false, reason: `Your role cannot edit the ${slot} comment` };
    }
  }
  return { ok: true };
}

/** Merge comment edits into the interview's JSON data (immutable). */
export function mergeComments(
  data: unknown,
  edits: InterviewComments | undefined,
): Record<string, unknown> {
  const base = data && typeof data === "object" && !Array.isArray(data)
    ? { ...(data as Record<string, unknown>) }
    : {};
  if (!edits) return base;
  const existing =
    base.comments && typeof base.comments === "object" && !Array.isArray(base.comments)
      ? { ...(base.comments as Record<string, unknown>) }
      : {};
  for (const [slot, value] of Object.entries(edits)) {
    if (value === undefined) continue;
    if (value === "") delete existing[slot];
    else existing[slot] = value;
  }
  base.comments = existing;
  return base;
}

/** Read the comments object out of an interview's JSON data. */
export function readComments(data: unknown): InterviewComments {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const comments = (data as Record<string, unknown>).comments;
  if (!comments || typeof comments !== "object" || Array.isArray(comments)) return {};
  const out: InterviewComments = {};
  for (const slot of ["worker", "employer", "staff"] as const) {
    const v = (comments as Record<string, unknown>)[slot];
    if (typeof v === "string" && v.length > 0) out[slot] = v;
  }
  return out;
}
