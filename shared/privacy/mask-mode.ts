/** Session display preference, not an authorization or disclosure boundary. */
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
  const { maskMode: _ignored, maskModeEpoch: _epoch, maskModeRevoked: _revoked, ...rest } = incoming as Record<string, unknown>;
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

export type PersonalField = "name" | "email" | "phone" | "ssn" | "dob" | "address" | "identifier" | "initials";
const EMPTY_LABEL = /^(?:N\/A|None|Unknown(?: worker)?|Unnamed(?: worker| contact)?|Not (?:provided|set|available)|No (?:name(?: set)?|email(?: set)?|phone|address|Sirius ID)|Loading(?:\.\.\.|…)?|—|-)$/i;
const text = (value: unknown) => value == null ? "" : String(value);
const eligible = (value: string) => value !== "" && !EMPTY_LABEL.test(value.trim());

/** Unicode code points, never UTF-16 halves. Separators are retained verbatim. */
function firstThenStars(value: string, characters: RegExp): string {
  let first = true;
  return Array.from(value, c => {
    if (!characters.test(c) && c !== "*") return c;
    if (first) { first = false; return c; }
    return "*";
  }).join("");
}
export function maskName(value: unknown): string {
  const s = text(value);
  if (!eligible(s)) return s;
  return s.split(/(\s+)/u).map(part => firstThenStars(part, /[\p{L}\p{N}\p{M}]/u)).join("");
}
export function maskId(value: unknown): string {
  const s = text(value);
  return eligible(s) ? firstThenStars(s, /[\p{L}\p{N}\p{M}]/u) : s;
}
export function maskSsn(value: unknown): string {
  const s = text(value);
  // Invalid numeric fields still mask letters; never fall back to the raw input.
  return eligible(s) ? firstThenStars(s, /[\p{L}\p{N}\p{M}]/u) : s;
}
export function maskEmail(value: unknown): string {
  const s = text(value);
  if (!eligible(s)) return s;
  const at = s.lastIndexOf("@");
  return at > 0 ? maskId(s.slice(0, at)) + s.slice(at) : maskName(s);
}
export function maskPersonal(value: unknown, field: PersonalField): string {
  if (field === "name") return maskName(value);
  if (field === "email") return maskEmail(value);
  if (field === "dob") {
    const s = text(value);
    if (!eligible(s)) return s;
    return /\p{N}/u.test(s) ? firstThenStars(s, /\p{N}/u) : maskId(s);
  }
  if (field === "initials") return eligible(text(value)) ? "*" : text(value);
  return maskId(value);
}
