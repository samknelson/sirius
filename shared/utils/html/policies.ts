/**
 * The sanitization policy table — dependency-free (data only).
 *
 * This is the ONE place in the codebase where a tag/attribute allowlist
 * is written down. Call sites pick a policy by NAME; they do not
 * re-derive an allowlist inline. If you need something that no policy
 * covers, add a policy here (with a comment saying what content it
 * governs) rather than passing an ad-hoc allowlist at the call site.
 *
 * Policies are named for the CONTENT they govern, not for the feature
 * that first needed them, because the same kind of content shows up in
 * more than one feature.
 */

/** A resolved allowlist handed to DOMPurify by `sanitizeHtml`. */
export interface HtmlSanitizeAllowlist {
  /** Human-readable note: what content this governs. */
  description: string;
  /**
   * Permitted tags. `undefined` means "DOMPurify's built-in defaults"
   * (a broad allowlist that still strips scripts and event handlers).
   */
  tags?: string[];
  /** Permitted attributes. `undefined` means DOMPurify's defaults. */
  attributes?: string[];
  /**
   * Permitted URI schemes for href/src. Set on every policy that allows
   * links, so a `javascript:` or `data:` href can never survive.
   */
  uriPattern?: RegExp;
}

/**
 * Schemes a link may use: http(s), mailto, tel, plus purely relative
 * references (`/path`, `#anchor`, `page.html`). Anything with another
 * explicit scheme is rejected.
 */
export const SAFE_URI_PATTERN = /^(?:https?|mailto|tel):|^[/#]|^[^:]*$/i;

/**
 * Formatting available in the rich-text editor's block/table mode:
 * headings, lists, links and tables.
 *
 * NOTE: `rich-document` and `authored-document` currently resolve to the
 * same tags and attributes, and that is not an accident to be cleaned up
 * casually — `authored-document` is DEFINED as "whatever the rich-text
 * editor lets an author write" (client/src/components/ui/simple-html-editor.tsx),
 * so if the editor's toolbar gains a tag, that policy changes and this
 * one does not. Keep the editor's `ALLOWED_TAGS` / `ALLOWED_ATTRIBUTES`
 * and `authored-document` aligned; they are two halves of one contract
 * (what an author can write, what a reader will be shown).
 */
const RICH_DOCUMENT_TAGS = [
  "strong", "b", "em", "i", "u", "ul", "ol", "li", "br", "p", "a",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
];
const RICH_DOCUMENT_ATTR = ["href", "target", "rel", "colspan", "rowspan", "scope"];

export const HTML_SANITIZE_POLICIES = {
  /**
   * Long-form staff-authored body copy that may include tables and
   * headings: help entries, and the HTML fields of delivered/previewed
   * messages (which are shaped through the same sanitizer so preview and
   * delivery can never disagree).
   */
  "rich-document": {
    description: "Staff-authored body copy with headings, lists, links and tables",
    tags: RICH_DOCUMENT_TAGS,
    attributes: RICH_DOCUMENT_ATTR,
    uriPattern: SAFE_URI_PATTERN,
  },

  /**
   * Documents composed in the rich-text editor and rendered back to
   * readers: contract section bodies, the worker time-off-sick banner.
   * Mirrors the editor's own authoring allowlist — see the note above.
   */
  "authored-document": {
    description: "Editor-composed documents rendered back read-only (contracts, banners)",
    tags: RICH_DOCUMENT_TAGS,
    attributes: RICH_DOCUMENT_ATTR,
    uriPattern: SAFE_URI_PATTERN,
  },

  /**
   * Short admin-authored blurbs that get to carry presentation hooks
   * (`span`/`div` with a `class`) but no tables: the login page intro,
   * its admin preview on Site Information, dashboard welcome messages.
   */
  "styled-text": {
    description: "Short admin-authored blurbs with span/div/class styling hooks",
    tags: [
      "b", "i", "em", "strong", "u", "p", "br", "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6", "a", "span", "div",
    ],
    attributes: ["href", "target", "rel", "class"],
    uriPattern: SAFE_URI_PATTERN,
  },

  /**
   * Snapshots of documents a worker actually signed (`esigs.doc_render`),
   * rendered back in the signature modal and the signed-document view.
   *
   * Wider than `authored-document` on purpose, and the extra width is
   * evidence-driven rather than generous: a signed snapshot is the
   * definition body PLUS the blocks the signing page appends around it
   * (bargaining unit, acknowledged statements, rate), and those are built
   * as `div`/`span` carrying inline `style`. Narrowing to
   * `authored-document` would strip the rules, borders and check marks
   * out of documents people have already put their name to, which is a
   * worse outcome than the width: the point of sanitizing a signed
   * snapshot is to stop a script in it executing, NOT to re-edit what the
   * document says.
   *
   * `style` is the load-bearing addition. DOMPurify still parses and
   * filters its value, so `expression()`/`url(javascript:)` do not
   * survive; what survives is layout.
   *
   * Sized against the stored corpus, and that sizing is re-checkable:
   * `scripts/tools/audit-signed-document-sanitize.ts` sanitizes every
   * stored record under this policy and reports any whose bytes change.
   * It is a data audit a human runs deliberately, not an automatic gate.
   */
  "signed-document": {
    description: "Signed e-signature document snapshots, rendered back read-only",
    tags: [...RICH_DOCUMENT_TAGS, "div", "span"],
    attributes: [...RICH_DOCUMENT_ATTR, "style", "class"],
    uriPattern: SAFE_URI_PATTERN,
  },

  /**
   * DOMPurify's built-in defaults — a broad HTML allowlist that still
   * removes scripts, event handlers and unsafe URI schemes. Used by the
   * site footer, whose markup is site-operator authored and has never
   * been narrowed. Deliberately left as-is: narrowing it is a visible
   * behavior change for existing footers, not a refactor.
   */
  "library-default": {
    description: "DOMPurify defaults — broad markup, operator-authored (site footer)",
  },
} satisfies Record<string, HtmlSanitizeAllowlist>;

/** The documented policy names. Autocomplete lists every option. */
export type HtmlSanitizePolicyName = keyof typeof HTML_SANITIZE_POLICIES;
