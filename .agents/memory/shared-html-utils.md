---
name: Shared HTML utility library
description: Why escaping, sanitizing and HTML→text live in one split-by-dependency-weight library, and the two traps when consolidating them.
---

# One HTML library, split by dependency weight

All HTML escaping, entity decoding, HTML→text conversion and sanitization
belong in `shared/utils/html/`. Nothing else in the repo may define an
escape helper, an entity-replace chain, or a DOMPurify allowlist; an
author-time check enforces this.

**Why:** the same three things had been re-implemented per call site
(six escapers, five mutually inconsistent sanitizers, two partial entity
decoders). Nobody could answer "what markup may this content contain?"
without reading five files, and three of the escapers escaped different
character sets from each other.

## The dependency-weight split is load-bearing, not tidiness

`sanitize.ts` is the only file that imports `isomorphic-dompurify`, which
pulls jsdom under Node. `escape.ts` and `entities.ts` import nothing;
`to-text.ts` imports only `entities.ts`.

**Why:** the production boot-failure page escapes text before the app
exists, and a heavy top-level import on that path has crashed the lean
production image at module load before. The boot entry therefore imports
`shared/utils/html/escape` directly rather than the barrel, and
`shared/utils/index.ts` deliberately does NOT re-export `./html` — doing
so would drag DOMPurify into every consumer of that barrel.

**How to apply:** when adding to this library, put new code in the
lightest file that can hold it, and verify the boot chunk afterwards.
The check that matters is the *split* esbuild build (two entry points +
`--splitting`), then walking only the STATIC imports out of the boot
chunk — a single-file bundle inlines the lazy `app-init` import and will
show a DOMPurify reference that does not actually load at boot.

## Two traps when replacing a hand-rolled sanitizer with DOMPurify

1. **DOMPurify does not add `rel="noopener noreferrer"`.** Hand-rolled
   DOM-walking sanitizers usually do. Losing it is a silent security
   regression that no rendering test catches, because the page looks
   identical. Restore it with one `afterSanitizeAttributes` hook — and
   duck-type the node (`nodeType === 1`), since under Node the DOM comes
   from jsdom and there is no global `Element` to `instanceof` against.
2. **Naive DOM walkers leak nested disallowed tags.** The typical
   unwrap-and-return implementation moves a disallowed element's children
   up and then returns *without recursing into them*, so a disallowed tag
   inside another disallowed tag survives. DOMPurify strips both. Expect
   this diff and treat it as the fix it is.

**How to apply:** before swapping, diff old vs new output over real
stored content, not just synthetic cases. Diffs are cheap to read and
each one is either a bug you are fixing or a regression you are shipping.

## Escape vs sanitize

`escapeHtml` encodes text that is NOT markup; `sanitizeHtml(html, policy)`
filters markup that IS meant to render. Swapping them produces visible
angle-bracket soup in one direction and live markup in the other. Note
that widening an escaper (e.g. adding quote escaping) is safe for text
*content* — `&quot;` renders as `"` — so those migrations are not the
risky ones; picking the wrong function is.
