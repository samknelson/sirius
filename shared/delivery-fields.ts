/**
 * DELIVERY FIELD DECLARATIONS.
 *
 * What a tokenized field IS, as far as sending it is concerned: which
 * fields each channel carries, and exactly how each one is shaped
 * between rendering its tokens and putting it in front of a recipient.
 *
 * These are declarations about DELIVERY, so they live next to nothing
 * else: the server's delivery paths shape with them, and the editors
 * that preview a template import the very same constants, so a preview
 * can never claim a shaping delivery does not perform.
 *
 * The shaping IMPLEMENTATION that needs the server's HTML sanitizer
 * lives in `server/delivery/shape.ts`; everything here is pure and safe
 * to bundle into the client.
 */
// The escape LEAF, never the html barrel: the barrel pulls DOMPurify
// (and jsdom under Node) and this module is imported by the client and
// by delivery code alike.
import { escapeHtml } from "./utils/html/escape";

/**
 * How the field is WRITTEN — the syntax of the string an author types,
 * and therefore what "clean this value" has to mean for it.
 *
 *  - `text`  plain text: the value is inserted as-is. Nothing about a
 *            recorded name is markup, and nothing downstream reads it
 *            as markup, so there is nothing to neutralize.
 *  - `html`  markup: an inserted value is HTML-escaped so it renders as
 *            the characters it is (`Sam > Nelson`, not a swallowed
 *            line). The finished string is then sanitized like any
 *            delivered body — see `shapeRenderedValue`.
 */
export type DeliveryFieldSyntax = "text" | "html";

/** The complete syntax vocabulary, for validating a declaration. */
export const DELIVERY_FIELD_SYNTAX: readonly DeliveryFieldSyntax[] = [
  "text",
  "html",
];

/**
 * A safety rule applied to the FINISHED value, after rendering — not to
 * the values going into it.
 *
 *  - `relative-url` the field is a same-app path; a finished value that
 *                   is not safe (absolute URL, "javascript:", "//host")
 *                   is blanked, because delivery drops it too.
 */
export type DeliveryFieldSafety = "relative-url";

/** The complete safety vocabulary, for validating a declaration. */
export const DELIVERY_FIELD_SAFETY: readonly DeliveryFieldSafety[] = [
  "relative-url",
];

/**
 * How a token's value is cleaned on its way into a field.
 *
 * The container supplies this; token evaluation just calls it. That is
 * the whole point of the shape: evaluating a token is a string
 * operation that knows nothing about where the string is going, so the
 * destination — and only the destination — decides what cleaning means.
 *
 * It is given the value and WHICH TOKEN produced it, and nothing about
 * the template around it. A token's value must not change because of
 * what the author typed before or after it.
 */
export type TokenValueCleaner = (value: string, token: CleanedToken) => string;

/** Which token produced the value being cleaned. */
export interface CleanedToken {
  /** Leaf plugin id of the chain that produced it, when it has one. */
  id: string | null;
  /**
   * The leaf declares its value is already markup. Information for the
   * container to consult, NOT an override the token asserts: a plain
   * text destination has no reason to care, and an HTML one decides for
   * itself whether to trust it.
   */
  emitsHtml: boolean;
}

/**
 * What cleaning MEANS for each container syntax — the one declaration
 * preview and delivery both read.
 *
 * The HTML cleaner escapes; it does not allow-list. Escaped text is
 * safe wherever it lands in an HTML document, including inside a link
 * address, and shipped templates do build hrefs out of tokens. An
 * allow-list would have to know where in the document the value sits;
 * escaping does not, which is exactly why this can run per value with
 * no knowledge of the surrounding template.
 */
const CLEAN_BY_SYNTAX: Record<DeliveryFieldSyntax, TokenValueCleaner> = {
  text: (value) => value,
  html: (value, token) => (token.emitsHtml ? value : escapeHtml(value)),
};

/**
 * The cleaning function for one field, or `null` when the field is not
 * tokenized at all (nothing is ever inserted into it, so there is
 * nothing to clean and it must not be evaluated).
 */
export function tokenCleanerFor(spec: DeliveryFieldSpec): TokenValueCleaner | null {
  if (spec.tokenized === false) return null;
  return CLEAN_BY_SYNTAX[spec.syntax];
}

/** One field of a message and how delivery treats it. */
export interface DeliveryFieldSpec {
  /** Field key; unique within the set, shared with the client. */
  key: string;
  /** How the field is written. Required — see the author check. */
  syntax: DeliveryFieldSyntax;
  /** Safety rule for the finished value, when the field has one. */
  safety?: DeliveryFieldSafety;
  /**
   * Set false when the field is NOT tokenized: delivery sends the
   * stored value verbatim, so it is never evaluated and the preview
   * shows it verbatim too (rendering it would show the author a
   * substitution the recipient never gets). Defaults to true.
   */
  tokenized?: boolean;
  /**
   * Suppress this field entirely when the named field renders blank.
   * Mirrors delivery: an in-app link label is not shown when its URL
   * was dropped for being unsafe (or was never set).
   */
  blankWithout?: string;
  /** Delivery trims surrounding whitespace off this field. */
  trim?: boolean;
  /**
   * Delivery sends NOTHING when this field is blank after shaping (an
   * in-app notification needs a title and a body). The preview reports
   * the message as undeliverable instead of showing text nobody gets.
   */
  requiredForMessage?: boolean;
  /** What delivery substitutes when the field comes out blank. */
  fallback?: string;
}

/**
 * The tokenized fields of each bulk-message medium.
 *
 * Bulk content is sent as authored — nothing is trimmed and no field is
 * required (an empty subject becomes "(no subject)") — so those
 * differences are declared here rather than hidden in delivery code.
 */
export const BULK_CHANNEL_FIELDS: Record<string, DeliveryFieldSpec[]> = {
  email: [
    { key: "subject", syntax: "text", fallback: "(no subject)" },
    // Authored HTML: token values are escaped, then the body is
    // sanitized (bodies can be written through the API without passing
    // the rich-text editor).
    { key: "bodyHtml", syntax: "html" },
    // The plain-text alternative part. Derived from the HTML body when
    // a message is saved, but stored and rendered on its own — so it is
    // its own destination, and says so.
    { key: "bodyText", syntax: "text" },
  ],
  sms: [{ key: "body", syntax: "text" }],
  postal: [{ key: "description", syntax: "text" }],
  inapp: [
    { key: "title", syntax: "text" },
    { key: "body", syntax: "text" },
    // A plain stored URL: not tokenized, so delivery sends it verbatim
    // and the preview shows it verbatim.
    { key: "linkUrl", syntax: "text", tokenized: false },
    { key: "linkLabel", syntax: "text" },
  ],
};

/**
 * The tokenized fields of each event-notifier channel.
 *
 * - Email subjects are trimmed and required (no subject → no email);
 *   the body is escaped-then-sanitized HTML.
 * - SMS is a single trimmed, required message.
 * - In-app needs a title and a body; its link must be a same-app
 *   relative path, and the label disappears with a dropped link.
 */
export const NOTIFIER_CHANNEL_FIELDS: Record<string, DeliveryFieldSpec[]> = {
  email: [
    { key: "subject", syntax: "text", trim: true, requiredForMessage: true },
    { key: "bodyHtml", syntax: "html" },
  ],
  sms: [{ key: "message", syntax: "text", trim: true, requiredForMessage: true }],
  inapp: [
    { key: "title", syntax: "text", trim: true, requiredForMessage: true },
    { key: "body", syntax: "text", trim: true, requiredForMessage: true },
    // Written as plain text, and dropped if what it renders to is not a
    // same-app path.
    { key: "linkUrl", syntax: "text", safety: "relative-url", trim: true },
    { key: "linkLabel", syntax: "text", trim: true, blankWithout: "linkUrl" },
  ],
  postal: [
    { key: "bodyHtml", syntax: "html", trim: true, requiredForMessage: true },
    { key: "description", syntax: "text", trim: true },
  ],
};

/**
 * The tokenized fields of each MANUAL COMPOSE medium — the one-off
 * message an admin writes to one person from a Communications tab.
 *
 * A compose screen is not a template store: the author writes tokenized
 * text in the studio, the studio renders it against the record the page
 * is about, and the FINISHED text is what lands in the form and what is
 * sent. So these declarations describe the compose FORM's fields (the
 * keys the studio applies into), and they say what shaping the render
 * performs — the same shaping the send path performs on the way out,
 * which is why every field here is trimmed and required exactly where
 * the compose form's own send button requires it.
 *
 * Fields the author fills in by hand and the studio never writes — an
 * in-app link URL, a postal address, a Lob template id — are
 * deliberately absent: declaring a field here says the studio composes
 * it, and a field it does not compose has nothing to render.
 */
export const COMPOSE_CHANNEL_FIELDS: Record<string, DeliveryFieldSpec[]> = {
  email: [
    { key: "subject", syntax: "text", trim: true, requiredForMessage: true },
    // Plain text: the compose form sends `bodyText` as authored.
    { key: "bodyText", syntax: "text", trim: true, requiredForMessage: true },
  ],
  sms: [{ key: "message", syntax: "text", trim: true, requiredForMessage: true }],
  postal: [
    // The letter body, written as HTML and wrapped in a page before it
    // goes to the print vendor.
    { key: "composeBody", syntax: "html", trim: true, requiredForMessage: true },
    // The operator-facing description of the mailing. Sent with the
    // job, not printed, and optional — a letter with no description is
    // still mailed.
    { key: "description", syntax: "text", trim: true },
  ],
  inapp: [
    { key: "title", syntax: "text", trim: true, requiredForMessage: true },
    // Written in the rich-text editor; flattened to plain text by the
    // compose form on send, so token values are escaped into markup here
    // exactly as the editor stores them.
    { key: "bodyHtml", syntax: "html", trim: true, requiredForMessage: true },
  ],
};

/** Same-app relative path: starts with "/", not scheme-relative "//". */
export function isSafeRelativePath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

export interface ShapedFields {
  /** Surviving fields, keyed by field key. */
  values: Record<string, string>;
  /**
   * False when a field delivery treats as required came out blank — the
   * message is not sent at all, so the preview must say so rather than
   * show text nobody will receive.
   */
  deliverable: boolean;
}

/**
 * Apply the cross-field delivery rules: a companion field disappears
 * with the field it depends on (an in-app link label follows its link
 * URL), and a blank required field means no message at all.
 */
export function applyFieldEligibility(
  specs: DeliveryFieldSpec[],
  shaped: Record<string, string>,
): ShapedFields {
  const values: Record<string, string> = { ...shaped };
  for (const spec of specs) {
    if (!spec.blankWithout) continue;
    if (!(spec.key in values)) continue;
    if (!values[spec.blankWithout]) delete values[spec.key];
  }
  let deliverable = true;
  for (const spec of specs) {
    if (spec.requiredForMessage && !values[spec.key]) deliverable = false;
  }
  return { values, deliverable };
}

/**
 * Structural problems with a set of field declarations, as a list of
 * human-readable strings (empty means "fine").
 *
 * Used in two places, on purpose: the author-time check script runs it
 * over the tables above, and the preview endpoint runs it over the
 * specs a caller posts. A field with no declared syntax has no defined
 * cleaning or shaping, which is the one thing these declarations exist
 * to prevent — so it is rejected wherever it appears.
 *
 * Takes `unknown` because one of its callers is a request body.
 */
export function validateDeliveryFieldSpecs(specs: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(specs) || specs.length === 0) {
    return ["declares no fields"];
  }
  const syntaxes = new Set<string>(DELIVERY_FIELD_SYNTAX);
  const safeties = new Set<string>(DELIVERY_FIELD_SAFETY);
  const seen = new Set<string>();
  for (const raw of specs) {
    const field = raw as Partial<DeliveryFieldSpec> | null;
    if (!field || typeof field !== "object" || typeof field.key !== "string" || !field.key) {
      problems.push("has a field with no key");
      continue;
    }
    if (seen.has(field.key)) {
      problems.push(`declares field '${field.key}' more than once`);
    }
    seen.add(field.key);
    if (!field.syntax) {
      problems.push(`field '${field.key}' declares no syntax`);
    } else if (!syntaxes.has(field.syntax)) {
      problems.push(`field '${field.key}' declares unknown syntax '${field.syntax}'`);
    }
    if (field.safety !== undefined && !safeties.has(field.safety)) {
      problems.push(`field '${field.key}' declares unknown safety rule '${field.safety}'`);
    }
    if (field.tokenized !== undefined && typeof field.tokenized !== "boolean") {
      problems.push(`field '${field.key}' has a non-boolean tokenized`);
    }
    if (field.blankWithout !== undefined && typeof field.blankWithout !== "string") {
      problems.push(`field '${field.key}' has a non-string blankWithout`);
    }
    if (field.fallback !== undefined && typeof field.fallback !== "string") {
      problems.push(`field '${field.key}' has a non-string fallback`);
    }
  }
  for (const raw of specs) {
    const field = raw as Partial<DeliveryFieldSpec> | null;
    if (!field || typeof field !== "object") continue;
    if (typeof field.blankWithout === "string" && !seen.has(field.blankWithout)) {
      problems.push(
        `field '${field.key}' depends on '${field.blankWithout}', which is not a declared field`,
      );
    }
  }
  return problems;
}
