export { htmlToPlainText } from "./html-to-text";

export type TokenScope = "contact" | "worker" | "employer" | "system";

/**
 * Lightweight, channel-neutral data shapes the registry's resolvers
 * read from. Server fetches these once per recipient; the registry
 * is the single source of truth for which fields turn into which
 * tokens. Adding a new token = adding one entry below — no other
 * file changes are required as long as the data is already in
 * TokenSourceData.
 */
export interface TokenSourceContact {
  id?: string | null;
  given?: string | null;
  family?: string | null;
  displayName?: string | null;
  email?: string | null;
  birthDate?: string | Date | null;
  /** Resolved gender label (option name, falling back to nota text). */
  genderName?: string | null;
}

export interface TokenSourceWorker {
  id?: string | null;
  given?: string | null;
  family?: string | null;
  jobTitle?: string | null;
  siriusId?: number | string | null;
  /** Display name of options_worker_ws referenced by denormWsId. */
  workStatusName?: string | null;
  /** Display names of options_worker_ms referenced by denormMsIds (array). */
  memberStatusNames?: string[] | null;
  /** Display name of bargaining_units referenced by bargainingUnitId. */
  bargainingUnitName?: string | null;
  /** Most-recent cardcheck definition name (cardcheck_definitions.name). */
  cardcheckType?: string | null;
  /** Most-recent cardcheck status (pending|signed|revoked). */
  cardcheckStatus?: string | null;
  /** Most-recent cardcheck signed_date. */
  cardcheckSignedDate?: Date | string | null;
  /** Display name of the steward assigned to this worker's BU + employer. */
  buildingRepName?: string | null;
}

export interface TokenSourceEmployer {
  id?: string | null;
  name?: string | null;
}

export interface TokenSourceData {
  contact?: TokenSourceContact | null;
  worker?: TokenSourceWorker | null;
  employer?: TokenSourceEmployer | null;
  now?: Date;
}

export interface TokenDefinition {
  id: string;
  scope: TokenScope;
  label: string;
  description: string;
  defaultValue: string;
  example: string;
  resolve: (data: TokenSourceData) => string | number | null | undefined;
}

function fullName(
  given?: string | null,
  family?: string | null,
  display?: string | null,
): string {
  return (display || `${given || ""} ${family || ""}`.trim() || "").trim();
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateLike(v: string | Date | null | undefined): string {
  if (v == null || v === "") return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return fmtDate(d);
}

function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export const TOKEN_REGISTRY: TokenDefinition[] = [
  {
    id: "contact.firstName",
    scope: "contact",
    label: "Contact first name",
    description: "Given name on the contact record",
    defaultValue: "Friend",
    example: "Jamie",
    resolve: (d) => d.contact?.given,
  },
  {
    id: "contact.lastName",
    scope: "contact",
    label: "Contact last name",
    description: "Family name on the contact record",
    defaultValue: "",
    example: "Rivera",
    resolve: (d) => d.contact?.family,
  },
  {
    id: "contact.fullName",
    scope: "contact",
    label: "Contact full name",
    description: "Display name on the contact record",
    defaultValue: "Member",
    example: "Jamie Rivera",
    resolve: (d) =>
      fullName(d.contact?.given, d.contact?.family, d.contact?.displayName),
  },
  {
    id: "contact.email",
    scope: "contact",
    label: "Contact email",
    description: "Primary email on the contact record",
    defaultValue: "",
    example: "jamie@example.com",
    resolve: (d) => d.contact?.email,
  },
  {
    id: "worker.firstName",
    scope: "worker",
    label: "Worker first name",
    description: "First name when the contact is a worker",
    defaultValue: "Friend",
    example: "Jamie",
    resolve: (d) => d.worker?.given || d.contact?.given,
  },
  {
    id: "worker.lastName",
    scope: "worker",
    label: "Worker last name",
    description: "Last name when the contact is a worker",
    defaultValue: "",
    example: "Rivera",
    resolve: (d) => d.worker?.family || d.contact?.family,
  },
  {
    id: "worker.fullName",
    scope: "worker",
    label: "Worker full name",
    description: "Full display name when the contact is a worker",
    defaultValue: "Friend",
    example: "Jamie Rivera",
    resolve: (d) =>
      fullName(
        d.worker?.given || d.contact?.given,
        d.worker?.family || d.contact?.family,
        d.contact?.displayName,
      ),
  },
  {
    id: "worker.jobTitle",
    scope: "worker",
    label: "Worker job title",
    description: "Most recent job title on the worker",
    defaultValue: "",
    example: "Lead Carpenter",
    resolve: (d) => d.worker?.jobTitle,
  },
  {
    id: "worker.siriusId",
    scope: "worker",
    label: "Worker ID",
    description: "Sirius worker ID number",
    defaultValue: "",
    example: "10241",
    resolve: (d) =>
      d.worker?.siriusId == null ? "" : String(d.worker.siriusId),
  },
  {
    id: "worker.dob",
    scope: "worker",
    label: "Worker date of birth",
    description: "Date of birth from the worker's contact record",
    defaultValue: "",
    example: "Apr 17, 1987",
    resolve: (d) => fmtDateLike(d.contact?.birthDate),
  },
  {
    id: "worker.gender",
    scope: "worker",
    label: "Worker gender",
    description: "Gender label from the worker's contact record",
    defaultValue: "",
    example: "Female",
    resolve: (d) => d.contact?.genderName || "",
  },
  {
    id: "worker.workStatus",
    scope: "worker",
    label: "Worker work status",
    description: "Current work status (e.g. Active, Out-of-Work)",
    defaultValue: "",
    example: "Active",
    resolve: (d) => d.worker?.workStatusName || "",
  },
  {
    id: "worker.memberStatus",
    scope: "worker",
    label: "Worker member status",
    description: "Member status (multiple values joined with /)",
    defaultValue: "",
    example: "In Good Standing",
    resolve: (d) =>
      d.worker?.memberStatusNames && d.worker.memberStatusNames.length > 0
        ? d.worker.memberStatusNames.join(" / ")
        : "",
  },
  {
    id: "worker.bargainingUnit",
    scope: "worker",
    label: "Worker bargaining unit",
    description: "Name of the worker's bargaining unit",
    defaultValue: "",
    example: "Local 123",
    resolve: (d) => d.worker?.bargainingUnitName || "",
  },
  {
    id: "worker.cardcheckType",
    scope: "worker",
    label: "Worker cardcheck type",
    description: "Name of the most recent cardcheck definition for the worker",
    defaultValue: "",
    example: "Authorization Card",
    resolve: (d) => d.worker?.cardcheckType || "",
  },
  {
    id: "worker.cardcheckStatus",
    scope: "worker",
    label: "Worker cardcheck status",
    description: "Status of the most recent cardcheck (Pending, Signed, Revoked)",
    defaultValue: "",
    example: "Signed",
    resolve: (d) => titleCase(d.worker?.cardcheckStatus),
  },
  {
    id: "worker.cardcheckSignedDate",
    scope: "worker",
    label: "Worker cardcheck signed date",
    description: "Signed date of the most recent cardcheck",
    defaultValue: "",
    example: "Apr 17, 2026",
    resolve: (d) => fmtDateLike(d.worker?.cardcheckSignedDate),
  },
  {
    id: "worker.buildingRep",
    scope: "worker",
    label: "Worker building rep",
    description: "Steward assigned to this worker's bargaining unit and employer",
    defaultValue: "",
    example: "Jamie Rivera",
    resolve: (d) => d.worker?.buildingRepName || "",
  },
  {
    id: "employer.name",
    scope: "employer",
    label: "Employer name",
    description:
      "Name of the worker's home employer (or first linked employer)",
    defaultValue: "",
    example: "Acme Construction",
    resolve: (d) => d.employer?.name,
  },
  {
    id: "system.year",
    scope: "system",
    label: "Current year",
    description: "Four-digit current year",
    defaultValue: String(new Date().getFullYear()),
    example: String(new Date().getFullYear()),
    resolve: (d) => String((d.now ?? new Date()).getFullYear()),
  },
  {
    id: "system.dateToday",
    scope: "system",
    label: "Today's date",
    description: "Today's date, e.g. Apr 17, 2026",
    defaultValue: fmtDate(new Date()),
    example: "Apr 17, 2026",
    resolve: (d) => fmtDate(d.now ?? new Date()),
  },
];

export const TOKEN_REGISTRY_MAP: Record<string, TokenDefinition> =
  TOKEN_REGISTRY.reduce(
    (acc, t) => {
      acc[t.id] = t;
      return acc;
    },
    {} as Record<string, TokenDefinition>,
  );

export function isKnownToken(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOKEN_REGISTRY_MAP, id);
}

const TOKEN_PATTERN =
  /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)\s*\}\}/g;

export function extractTokenIds(template: string | null | undefined): string[] {
  if (!template) return [];
  const found = new Set<string>();
  for (const m of template.matchAll(TOKEN_PATTERN)) {
    found.add(m[1]);
  }
  return Array.from(found);
}

export function findUnknownTokenIds(
  template: string | null | undefined,
): string[] {
  return extractTokenIds(template).filter((id) => !isKnownToken(id));
}

export type TokenContext = Record<string, string | null | undefined>;

/**
 * Run every registered resolver against the supplied source data
 * and produce a flat token-id → string context the renderer consumes.
 * This is the only place that turns source data into token values,
 * so adding a token to the registry is sufficient end-to-end.
 */
export function buildContextFromSources(data: TokenSourceData): TokenContext {
  const ctx: TokenContext = {};
  for (const def of TOKEN_REGISTRY) {
    const v = def.resolve(data);
    ctx[def.id] = v == null || v === "" ? null : String(v);
  }
  return ctx;
}

export interface RenderOptions {
  /** When true, missing/unknown values render as `[unknown token]` rather than the registry default. */
  strictUnknown?: boolean;
  /** When true, replacement values are HTML-escaped. */
  escapeHtml?: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderResult {
  output: string;
  unknownTokens: string[];
  missingValues: string[];
}

export function renderTemplate(
  template: string | null | undefined,
  context: TokenContext,
  options: RenderOptions = {},
): RenderResult {
  if (!template) return { output: "", unknownTokens: [], missingValues: [] };

  const unknownTokens = new Set<string>();
  const missingValues = new Set<string>();
  const { strictUnknown = false, escapeHtml: escape = false } = options;

  const output = template.replace(TOKEN_PATTERN, (match, tokenId: string) => {
    const def = TOKEN_REGISTRY_MAP[tokenId];
    if (!def) {
      unknownTokens.add(tokenId);
      return strictUnknown ? `[unknown token: ${tokenId}]` : match;
    }
    const raw = context[tokenId];
    let value: string;
    if (raw === null || raw === undefined || raw === "") {
      missingValues.add(tokenId);
      value = def.defaultValue;
    } else {
      value = String(raw);
    }
    return escape ? escapeHtml(value) : value;
  });

  return {
    output,
    unknownTokens: Array.from(unknownTokens),
    missingValues: Array.from(missingValues),
  };
}

export function buildSampleContext(): TokenContext {
  const ctx: TokenContext = {};
  for (const def of TOKEN_REGISTRY) {
    ctx[def.id] = def.example;
  }
  return ctx;
}
