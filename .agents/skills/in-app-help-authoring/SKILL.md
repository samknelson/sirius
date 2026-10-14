---
name: in-app-help-authoring
description: Author and verify in-app help in the existing /config/helps framework. Load during planning and implementation of user-facing feature or screen changes, and whenever creating or updating help content.
---

# In-App Help Authoring

## When to use

Load this skill during planning and implementation when adding or changing a
feature, screen, action, label, permission, prerequisite, or status meaning
that a user encounters, or when editing help itself. Include affected help
and its verification in the task's acceptance criteria. Ship the help update
with the behavior; do not leave it for a later documentation task.

If existing help remains accurate and sufficient, document why no update is
needed in the completion notes. A visual-only change can qualify; a new
workflow normally cannot. Do not backfill unrelated screens as part of a task.

## Read the behavior before writing

Inspect the delivered page, controls, route, server validation, access policy,
and any component/configuration prerequisites. Cover relevant create, edit,
delete, empty, pending, success, and failure states, not just the happy path.
Use actual UI labels and verified outcomes. Do not describe planned features,
infer permissions from a visible button, or promise immediate processing when
work is queued. Help is guidance, not an authorization mechanism.

## Existing framework and ownership

- `client/src/components/HelpDisplay.tsx` looks up the current Wouter path.
  Every matching entry has a plain-text `summary` shown inline. Nonempty
  `details` adds the **more** button, opening the scrollable **Help** dialog
  with the summary above the HTML details. Markdown is not rendered.
- `/config/helps` (`client/src/pages/config/helps.tsx`) lists both sources.
  Built-in entries have **System** and **Built-in** labels, not edit/delete
  controls. Database entries remain admin-authored and editable.
- Prefer built-in entries for shipped product guidance: add a focused file
  under `server/help/system/`, import `SystemHelpEntry` with `import type`
  from `./index`, export the entry, then import it and add it to the `entries`
  array in `server/help/system/index.ts`. Follow `trust-providers.ts`.
- Use a unique, stable `system:<descriptive-name>` ID. Keep the ID when
  changing wording or paths; do not derive it from mutable labels or database
  IDs. The registry rejects duplicates, and APIs refuse system mutations.
- Database help (`server/storage/helps.ts`, `shared/schema.ts`) is for local
  procedures and organization-specific guidance. Do not seed, rewrite,
  delete, or migrate those rows to ship product documentation. Both sources
  appear together; a system entry does **not** override a local entry.
  Respect local guidance even when patterns overlap, and report a discovered
  contradiction rather than silently replacing it.
- Help read endpoints in `server/modules/helps.ts` require authentication;
  `/config/helps` and database mutations require `admin`. Matching is path-based, not per-entry
  role/component-based. Do not put secrets or restricted operational content
  in help or imply that everyone who can read it can perform its actions.

## Select narrow page patterns

Use real browser paths, not API URLs, full origins, or route placeholders
such as `:id`. Prefer exact paths; enumerate several paths when needed.
`paths` is a nonempty array, and matching any pattern includes the entry.

System matching (`server/help/path-match.ts`) is case-sensitive and anchored
to the whole path. `%` matches any sequence, including empty text and `/`;
it is not limited to one path segment. For example, `/workers/%/hours` can
also match nested segments. `/config/helps` does not match
`/config/helps/extra`; `/config/helps%` also matches `/config/helps-other`.
Do not use broad patterns like `%` or `/config/%` for a single screen.

Use `%` as the only wildcard convention. The system matcher treats `_`
literally, while database lookup uses PostgreSQL `LIKE` directly (where `_`
is a wildcard and backslash has escape semantics). Do not assume those
edge cases behave identically; verify actual lookup results if applicable.
Check the path the router supplies rather than relying on query strings or
hashes to scope help.

## Writing standard and reusable details structure

- **Summary:** one short plain-text sentence stating the page's purpose
  (usually about 15–30 words). No HTML, Markdown, headings, or step lists.
- **Details:** simple semantic HTML, normally `<h3>`, `<p>`, `<ol><li>`,
  `<ul><li>`, and `<strong>` for exact UI labels. Use links only when useful,
  preferably relative links to app pages. Escape literal `&`, `<`, and `>`
  in text. Do not add decorative styling, classes, scripts, images, embedded
  controls, or layout wrappers.
- Use these sections in this order, omitting irrelevant ones rather than
  inserting filler:
  1. **Purpose** — what this page helps the user do.
  2. **Before you start** — truthful access, configuration, and data needs.
  3. **How to use this page** — numbered steps, one action per step.
  4. **Results and status meanings** — what changes, what does not, and what
     visible statuses or messages mean.
  5. **Limitations and common problems** — actionable boundaries and recovery.
- Write in plain language using “you” and active verbs. Explain necessary
  domain terms; avoid developer jargon, promotional claims, and vague
  instructions such as “configure as appropriate.”
- Put consequential-action warnings before the action: deletion, charges,
  notifications, exports of sensitive data, and irreversible effects when
  relevant. Do not claim recovery or reversal unless it exists.
- Never include credentials, secrets, real personal data, or sensitive
  records. Use clearly fictional examples if sample data is necessary.

### Realistic example (illustrative only; do not register as part of this skill)

This documents the existing Help Text listing without requiring a database
write. In a task actually documenting that screen, the entry could be:

```ts
import type { SystemHelpEntry } from "./index";

export const helpTextListingHelp: SystemHelpEntry = {
  id: "system:help-text-listing",
  paths: ["/config/helps"],
  summary: "Review the help shown on each page and find entries by their page patterns or content.",
  details: `
    <h3>Purpose</h3>
    <p>Use Help Text to review built-in product guidance and locally configured help.</p>
    <h3>Before you start</h3>
    <p>You must be signed in with admin access to open this page or create, change, or delete local help.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Enter part of a page pattern in <strong>Filter by path…</strong>.</li>
      <li>Enter words in <strong>Filter by content (summary or details)…</strong> to narrow the list further.</li>
      <li>Review <strong>Paths</strong> and <strong>Summary</strong> for each matching entry.</li>
      <li>Visit a matching page to read the inline summary and select <strong>more</strong> when details are available.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p><strong>System</strong> and <strong>Built-in</strong> identify product help that cannot be edited here. <strong>Yes</strong> in the Details column means longer guidance is available.</p>
    <h3>Limitations and common problems</h3>
    <p>Filters search the listing; they do not change where help appears. If no entries match, clear one or both filters. A percent sign in a path pattern can match multiple path segments.</p>
  `,
};
```

## Verification and completion checklist

1. Compare every claim with the shipped UI, server behavior, permissions,
   prerequisites, and relevant states. Recheck exact labels and warnings.
2. Check stable ID and registration. Review intended paths plus near misses
   (sibling tabs, list/detail pages, trailing slashes, nested paths, and an
   unrelated area). For system patterns, use `likePatternMatches` against
   representative paths. For database patterns, use the real lookup.
3. Use the existing `sanitizeHtml(details, "rich-document")` policy from
   `@shared/utils/html`: system registry conversion sanitizes built-ins;
   help POST/PUT sanitizes database details. Inspect
   `shared/utils/html/policies.ts` and confirm the authored HTML survives.
   Do not bypass sanitization, introduce another sanitizer/allowlist, or
   depend on unsupported tags/attributes.
4. After server help changes, restart **Start application**. Reload in a
   fresh page/session or invalidate the help queries: lookups cache for
   five minutes, and a hard reload prevents stale in-memory results.
5. Signed in with appropriate access, visit `/config/helps`. Find the entry
   by path/content; confirm summary, paths, details presence, and
   **System**/**Built-in** for product entries. Confirm local entries remain
   intact. Do not create or modify live database entries for verification.
6. Visit intended pages; confirm the inline summary is readable. Select
   **more**, when present, and check headings, lists, links, scrolling, and
   accurate details in the **Help** dialog. A summary-only entry should
   have no **more** button. Check narrow/mobile layout if content is long.
7. Visit unrelated and near-miss routes; confirm this entry is absent.
   Authenticated GET `/api/helps` and
   `/api/helps/lookup?path=<URL-encoded-path>` can corroborate listing and
   matching without mutations, but do not prove dialog rendering.
8. Record the help IDs/paths changed and checks performed in completion
   notes, or the specific no-update rationale. If signed-in UI verification
   is unavailable, state that limitation and distinguish source/API checks
   from browser checks; never claim an unopened dialog was verified.

For instruction/skill-only work, cross-check the standard and example against
these sources and report it as instruction work—not as documentation of
existing screens. Do not change help UI, API, schema, permissions, or local
database content merely to apply this standard.
