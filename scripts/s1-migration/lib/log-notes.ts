/**
 * Workbook-approved sirius_log classification for the S1→S2 worker-notes
 * migration. Keep this transform independent from the retired communications
 * importer: the source labels are provenance, never option names.
 */

export type ImportedNoteType =
  | "Comment"
  | "Legacy Notes"
  | "Member Inbound"
  | "Member Outreach"
  | "Provider Communication"
  | "Document Detail";

export interface LogNoteClassification {
  noteType: ImportedNoteType;
  medium: "Call" | "In-Person" | "Email" | "Letter" | null;
  issues: string[];
  category: string;
  type: string;
}

const norm = (value: unknown): string | null => {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, " ");
  return normalized || null;
};

type Mapping = Omit<LogNoteClassification, "category" | "type">;
const m = (
  noteType: ImportedNoteType,
  medium: LogNoteClassification["medium"] = null,
  issues: string[] = [],
): Mapping => ({ noteType, medium, issues });

/*
 * This is deliberately an explicit allowlist rather than a family matcher.
 * The workbook has a few intentionally similar-looking exclusions (for
 * example system email beside the one approved member email).
 */
const APPROVED: Record<string, Mapping> = {
  ":manual\u0000comment": m("Comment"),
  "call\u0000comment": m("Member Inbound", "Call"),
  "call\u0000incoming": m("Member Inbound", "Call"),
  "call\u0000hotline": m("Member Inbound", "Call"),
  "call\u0000outgoing": m("Member Outreach", "Call"),
  "call from member\u0000enrollment": m("Member Inbound", "Call", ["Enrollment"]),
  "call from member\u0000enrrolment": m("Member Inbound", "Call", ["Enrollment"]),
  "call from member\u0000private": m("Member Inbound", "Call"),
  "call from member\u0000public": m("Member Inbound", "Call"),
  "call from member\u0000eligibility": m("Member Inbound", "Call", ["Enrollment"]),
  "call to member\u0000enrollment followup": m("Member Outreach", "Call", ["Enrollment"]),
  "call to member\u0000enrollment": m("Member Outreach", "Call", ["Enrollment"]),
  "call to member\u0000private": m("Member Outreach", "Call"),
  "call to member\u0000disability/fmla": m("Member Outreach", "Call", ["Disability"]),
  "call to member\u0000public": m("Member Outreach", "Call"),
  "comment\u0000private": m("Comment"),
  "comment\u0000public": m("Comment"),
  "comment\u0000comment": m("Comment"),
  "email from member\u0000eligibility": m("Member Inbound", "Email", ["Enrollment"]),
  "helpline call from member\u0000mlk issues": m("Member Inbound", "Call", ["MLK"]),
  "helpline call from member\u0000disney issues": m("Member Inbound", "Call", ["Employer"]),
  "helpline call from member\u0000life insurance": m("Member Inbound", "Call", ["Life Insurance"]),
  "helpline call from member\u0000": m("Member Inbound", "Call"),
  "hotline call from member\u0000mlk issues": m("Member Inbound", "Call", ["MLK"]),
  "hotline call from member\u0000id card not received": m("Member Inbound", "Call", ["MLK", "ID Card"]),
  "in person visit\u0000enrollment": m("Member Inbound", "In-Person", ["Enrollment"]),
  "issue\u0000issue": m("Comment"),
  "issue\u0000comment": m("Comment"),
  "issue reported for member\u0000mlk issues": m("Member Inbound", null, ["MLK"]),
  "issue reported for member\u0000id card not received": m("Member Inbound", null, ["MLK", "ID Card"]),
  "issue reported for member\u0000kaiser issues": m("Member Inbound", null, ["Kaiser"]),
  "issue reported for member\u0000dyntl": m("Member Inbound", null, ["Dental"]),
  "issue reported for member\u0000eligibility": m("Member Inbound", null, ["Enrollment"]),
  "letter\u0000appeal denial": m("Member Inbound", "Letter", ["Appeal"]),
  "material\u0000material": m("Document Detail"),
  "office visit\u0000mlk issues": m("Member Inbound", "In-Person", ["MLK"]),
  "office visit\u0000walk in": m("Member Inbound", "In-Person"),
  "office visit\u0000other": m("Member Inbound", "In-Person"),
  "office visit\u0000enrollment": m("Member Inbound", "In-Person", ["Enrollment"]),
  "office visit\u0000private": m("Member Inbound", "In-Person"),
  "office visit\u0000": m("Member Inbound", "In-Person"),
  "office visit\u0000delta appeal": m("Member Inbound", "In-Person", ["Delta", "Appeal"]),
  "office visit\u0000enrollment followup": m("Member Inbound", "In-Person", ["Enrollment"]),
  "office visit\u0000public": m("Member Inbound", "In-Person"),
  "office visit\u0000office visit": m("Member Inbound", "In-Person"),
  "office visit\u0000dental insurance problems": m("Member Inbound", "In-Person", ["Dental"]),
  "onsite visit\u0000scheduled": m("Member Inbound", "In-Person"),
  "provider call\u0000enrollment": m("Provider Communication", "Call", ["Enrollment"]),
  "visit\u0000office": m("Member Inbound", "In-Person"),
  "visit\u0000onsite": m("Member Inbound", "In-Person"),
  "visit\u0000comment": m("Member Inbound", "In-Person"),
  "worker:contact\u0000update": m("Comment"),
};

/** Explicit exclusion precedence for prohibited families. */
function explicitlyExcluded(category: string | null, type: string | null): boolean {
  if (!category && !type) return true;
  const c = category ?? "";
  const t = type ?? "";
  if (c.startsWith("bulk:") || c.startsWith("twilio:")) return true;
  if (c === "auditlog" || c === "election" || c.startsWith("trust:election_wizard") || c === "system email") return true;
  if (c === "letter" && (t === "draft" || t === "sent")) return true;
  if (c === "smf" || c === "smf:notes") return true;
  if (c === "trust:wb:scan" || c === "news:view" || c === "fastload") return true;
  if (c === "sms" || c === "email" || c === "postal" || c === "voice" || c.includes("stop") || t === "stop") return true;
  return false;
}

export function classifyS1Log(categoryValue: unknown, typeValue: unknown): LogNoteClassification | null {
  const category = norm(categoryValue);
  const type = norm(typeValue);
  if (explicitlyExcluded(category, type)) return null;
  const mapping = APPROVED[`${category ?? ""}\u0000${type ?? ""}`];
  if (!mapping) return null;
  return {
    ...mapping,
    category: category ?? "",
    type: type ?? "",
    issues: [...mapping.issues],
  };
}

export const NOTE_TYPE_DEFINITIONS = [
  { id: "C", name: "Comment", description: "Imported internal or staff comment.", order: 10 },
  { id: "L", name: "Legacy Notes", description: "Legacy S1 notes retained for history.", order: 20 },
  { id: "I", name: "Member Inbound", description: "A note about contact received from a member.", order: 30 },
  { id: "O", name: "Member Outreach", description: "A note about outreach to a member.", order: 40 },
  { id: "P", name: "Provider Communication", description: "A note about communication with a provider.", order: 50 },
  { id: "D", name: "Document Detail", description: "Details retained from an imported document.", order: 60 },
] as const;

export const TAG_TYPE_DEFINITIONS = [
  { id: "medium", name: "Medium", description: "How the interaction occurred.", sequence: 10 },
  { id: "issue", name: "Issue", description: "The issue or subject covered by the note.", sequence: 20 },
  { id: "resolution", name: "Resolution", description: "How the issue was resolved.", sequence: 30 },
] as const;

export const TAG_DEFINITIONS = [
  ["medium:call", "Call", "medium", 10],
  ["medium:in-person", "In-Person", "medium", 20],
  ["medium:email", "Email", "medium", 30],
  ["medium:letter", "Letter", "medium", 40],
  ["issue:enrollment", "Enrollment", "issue", 10],
  ["issue:disability", "Disability", "issue", 20],
  ["issue:mlk", "MLK", "issue", 30],
  ["issue:employer", "Employer", "issue", 40],
  ["issue:life-insurance", "Life Insurance", "issue", 50],
  ["issue:id-card", "ID Card", "issue", 60],
  ["issue:kaiser", "Kaiser", "issue", 70],
  ["issue:dental", "Dental", "issue", 80],
  ["issue:appeal", "Appeal", "issue", 90],
  ["issue:delta", "Delta", "issue", 100],
] as const;

export const ISSUE_TAG_ID_BY_NAME: Record<string, string> = Object.fromEntries(
  TAG_DEFINITIONS.filter(([, , type]) => type === "issue").map(([id, name]) => [name, id]),
);