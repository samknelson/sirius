/**
 * DELIVERY FIELD DECLARATIONS.
 *
 * What a tokenized field IS, as far as sending it is concerned: which
 * fields each medium carries, and exactly how each one is shaped
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
// by delivery code alike. `to-text` is a leaf too (pure string work).
import { escapeHtml } from "./utils/html/escape";
import { htmlToPlainText } from "./utils/html/to-text";

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
}

/** Every medium a message can be delivered on. Keys of {@link MEDIUM_FIELDS}. */
export const MEDIUM_NAMES = ["email", "sms", "postal", "inapp"] as const;

export type MediumName = (typeof MEDIUM_NAMES)[number];

/**
 * WHAT A MESSAGE ON EACH MEDIUM IS MADE OF — declared once, for every
 * surface that authors one.
 *
 * Bulk messaging, the event notifier's admin templates and the one-off
 * compose forms used to each carry their own copy of this, and the
 * copies disagreed: the same SMS body was `message` in two of them and
 * `body` in the third, a blank email subject was fatal in one and
 * quietly became "(no subject)" in another. Those were never three
 * different kinds of message — they were three descriptions of one
 * medium, and a recipient only ever sees the medium.
 *
 * A field is listed here once and means the same thing everywhere: an
 * email subject is required, an SMS body is `body`, an in-app body is
 * plain text. What a surface may differ on is which of these fields IT
 * authors — a surface supplies only the keys it writes, and an
 * unsupplied OPTIONAL key is not rendered, not previewed and not
 * required. That is how the bulk postal editor keeps offering only a
 * description while the medium still has a letter body.
 *
 * What a surface may NOT do is opt out of a REQUIRED field of a medium
 * it composes for: an email with no subject is not a shorter email, it
 * is an email that cannot be sent. See {@link authoredFieldValue}.
 */
export const MEDIUM_FIELDS: Record<MediumName, DeliveryFieldSpec[]> = {
  /**
   * A subject and an HTML body.
   *
   * The subject is trimmed and REQUIRED: an email with no subject is
   * not sent and is recorded as a failure, never sent under a
   * substituted stand-in — a subject built entirely out of tokens can
   * render blank for one recipient and not another, and quietly mailing
   * "(no subject)" hides that from the author.
   *
   * There is no plain-text field. An email's plain-text alternative
   * part is DERIVED from the HTML body at send (see
   * {@link deriveEmailPlainText}), so the two parts of one email cannot
   * disagree with each other.
   */
  email: [
    { key: "subject", syntax: "text", trim: true, requiredForMessage: true },
    // Authored HTML: token values are escaped on the way in, then the
    // finished body is sanitized (a body can be written through the API
    // without passing the rich-text editor).
    { key: "bodyHtml", syntax: "html", trim: true },
  ],
  /** One trimmed, required body. A text with nothing in it is not a text. */
  sms: [{ key: "body", syntax: "text", trim: true, requiredForMessage: true }],
  /**
   * A title and a PLAIN-TEXT body — in-app notifications are displayed
   * as text, so a rich-text editor over the body would only promise
   * formatting the reader never sees.
   *
   * The link is tokenized like every other field: shipped links point
   * at the record the notification is about ("/dispatch/job/{{…}}"), so
   * a link that could not carry a token would be a link to nothing in
   * particular. What it RENDERS to is checked as a same-app path — an
   * absolute URL or a "javascript:" address is dropped, because the
   * alerts bell hands this to the browser — and the label disappears
   * with a link that was dropped or was never set.
   */
  inapp: [
    { key: "title", syntax: "text", trim: true, requiredForMessage: true },
    { key: "body", syntax: "text", trim: true, requiredForMessage: true },
    { key: "linkUrl", syntax: "text", safety: "relative-url", trim: true },
    { key: "linkLabel", syntax: "text", trim: true, blankWithout: "linkUrl" },
  ],
  postal: [
    { key: "bodyHtml", syntax: "html", trim: true, requiredForMessage: true },
    { key: "description", syntax: "text", trim: true },
  ],
};

/**
 * One field of one medium, BY KEY.
 *
 * Delivery code that shapes a single field looks it up this way rather
 * than by position, so a field added to or reordered in the declaration
 * above cannot silently rebind an existing call site. Asking for a
 * field a medium does not have is a programming error, not a blank.
 */
export function mediumField(medium: MediumName, key: string): DeliveryFieldSpec {
  const spec = MEDIUM_FIELDS[medium].find((f) => f.key === key);
  if (!spec) {
    throw new Error(`Medium '${medium}' declares no field '${key}'`);
  }
  return spec;
}

/**
 * What a surface actually authored for one field, given whatever it
 * holds for that key — the one place "the author left it out" is told
 * apart from "the author left it empty".
 *
 * `undefined` means the field is NOT IN PLAY: this surface does not
 * author it, so it is not rendered, not previewed, not required, and
 * does not appear in the delivered message at all.
 *
 * A missing REQUIRED field is not treated that way. A surface composing
 * for a medium takes on that medium's required fields, so a stored
 * record with no subject at all and one whose subject is blank are the
 * same message — one that cannot be sent — and both are reported as the
 * blank they are rather than one of them being invented or skipped.
 */
export function authoredFieldValue(
  spec: DeliveryFieldSpec,
  value: string | null | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  return spec.requiredForMessage ? "" : undefined;
}

/**
 * The plain-text alternative part of an email, derived from its HTML
 * body at send. Never authored and never stored: a second authored copy
 * of one message is a second thing that can be wrong.
 */
export function deriveEmailPlainText(bodyHtml: string): string {
  return htmlToPlainText(bodyHtml);
}

/**
 * Why a message could not be composed, in words a person reading a
 * failed communication can act on.
 *
 * Every surface records the same sentence, because it is the same
 * failure: a field the medium requires rendered blank for this
 * recipient.
 */
export function undeliverableReason(medium: MediumName, blankFields: string[]): string {
  const fields = blankFields.length > 0 ? blankFields.join(", ") : "a required field";
  const name = MEDIUM_LABELS[medium];
  return `Not sent: this ${name} message's ${fields} rendered blank, and a message is never sent with a substituted stand-in in place of a field it needs.`;
}

/** How each medium is named to a person reading a failed communication. */
const MEDIUM_LABELS: Record<MediumName, string> = {
  email: "email",
  sms: "SMS",
  postal: "postal",
  inapp: "in-app",
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
  /**
   * WHICH required fields came out blank. Empty when the message is
   * deliverable. The failure is recorded against the recipient by name,
   * so "not sent" can be answered with "the subject was blank" rather
   * than left as a message that simply never arrived.
   */
  blankRequired: string[];
}

/**
 * Apply the cross-field delivery rules: a companion field disappears
 * with the field it depends on (an in-app link label follows its link
 * URL), and a blank required field means no message at all.
 *
 * Only the fields the caller SUPPLIED are judged. A key absent from
 * `shaped` is one this surface does not author (see
 * {@link authoredFieldValue}), and a field that is not in play cannot
 * be the reason a message is undeliverable.
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
  const blankRequired: string[] = [];
  for (const spec of specs) {
    if (!spec.requiredForMessage) continue;
    if (!(spec.key in shaped)) continue;
    if (!values[spec.key]) blankRequired.push(spec.key);
  }
  return { values, deliverable: blankRequired.length === 0, blankRequired };
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
