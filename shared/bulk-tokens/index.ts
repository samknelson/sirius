export type TokenScope = "contact" | "worker" | "employer" | "system";

export interface TokenDefinition {
  id: string;
  scope: TokenScope;
  label: string;
  description: string;
  defaultValue: string;
  example: string;
}

export const TOKEN_REGISTRY: TokenDefinition[] = [
  {
    id: "contact.firstName",
    scope: "contact",
    label: "Contact first name",
    description: "Given name on the contact record",
    defaultValue: "Friend",
    example: "Jamie",
  },
  {
    id: "contact.lastName",
    scope: "contact",
    label: "Contact last name",
    description: "Family name on the contact record",
    defaultValue: "",
    example: "Rivera",
  },
  {
    id: "contact.fullName",
    scope: "contact",
    label: "Contact full name",
    description: "Display name on the contact record",
    defaultValue: "Friend",
    example: "Jamie Rivera",
  },
  {
    id: "contact.email",
    scope: "contact",
    label: "Contact email",
    description: "Primary email on the contact record",
    defaultValue: "",
    example: "jamie@example.com",
  },
  {
    id: "worker.firstName",
    scope: "worker",
    label: "Worker first name",
    description: "First name when the contact is a worker",
    defaultValue: "Friend",
    example: "Jamie",
  },
  {
    id: "worker.lastName",
    scope: "worker",
    label: "Worker last name",
    description: "Last name when the contact is a worker",
    defaultValue: "",
    example: "Rivera",
  },
  {
    id: "worker.fullName",
    scope: "worker",
    label: "Worker full name",
    description: "Full display name when the contact is a worker",
    defaultValue: "Friend",
    example: "Jamie Rivera",
  },
  {
    id: "worker.jobTitle",
    scope: "worker",
    label: "Worker job title",
    description: "Most recent job title on the worker",
    defaultValue: "",
    example: "Lead Carpenter",
  },
  {
    id: "worker.siriusId",
    scope: "worker",
    label: "Worker ID",
    description: "Sirius worker ID number",
    defaultValue: "",
    example: "10241",
  },
  {
    id: "employer.name",
    scope: "employer",
    label: "Employer name",
    description: "Name of the worker's home employer (or first linked employer)",
    defaultValue: "",
    example: "Acme Construction",
  },
  {
    id: "system.year",
    scope: "system",
    label: "Current year",
    description: "Four-digit current year",
    defaultValue: String(new Date().getFullYear()),
    example: String(new Date().getFullYear()),
  },
  {
    id: "system.dateToday",
    scope: "system",
    label: "Today's date",
    description: "Today's date, e.g. Apr 17, 2026",
    defaultValue: "",
    example: "Apr 17, 2026",
  },
];

export const TOKEN_REGISTRY_MAP: Record<string, TokenDefinition> = TOKEN_REGISTRY.reduce(
  (acc, t) => {
    acc[t.id] = t;
    return acc;
  },
  {} as Record<string, TokenDefinition>,
);

export function isKnownToken(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOKEN_REGISTRY_MAP, id);
}

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*)\s*\}\}/g;

export function extractTokenIds(template: string | null | undefined): string[] {
  if (!template) return [];
  const found = new Set<string>();
  for (const m of template.matchAll(TOKEN_PATTERN)) {
    found.add(m[1]);
  }
  return Array.from(found);
}

export function findUnknownTokenIds(template: string | null | undefined): string[] {
  return extractTokenIds(template).filter((id) => !isKnownToken(id));
}

export type TokenContext = Record<string, string | null | undefined>;

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
