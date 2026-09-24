# Template Studio editor-engine assessment

## Probe

On 2026-09-24, ran a one-off headless Chromium probe against the representative
fixture shape in `tests/postal-templates/browser.mjs` (nested table, stylesheet
rules, inline CSS, quoted `{{...}}` tokens in `href`/`src`/`style`), adding the
postal `data-template-page-break` marker. This was an isolated browser test,
not the application/browser regression suite. It used CDN ESM imports; no
runtime dependencies or project files were added.

Both editors received the fixture after replacing complete token expressions
with safe markers and restored them after serialization. This deliberately
gives the engines a favorable test of token transport; the fixture's quotes
inside quoted HTML attributes otherwise need preprocessing before HTML parsing.

| Engine and tested setup | Actual results |
| --- | --- |
| Tiptap 3.31.3: StarterKit, TableKit, Link, Image | Kept both nested tables. Emitted full token strings in `href` and `src` with the marker wrapper. Dropped the `<style>` rules, `.letter` class, cell padding, image inline CSS, tokenized paragraph color, and page-break marker. Kept image `alt` and `width`. A second protected import/export produced stable output, but not source-equivalent HTML: table markup was normalized and link attributes added. |
| Lexical 0.51.0: `@lexical/html`, table and link nodes registered | Kept both nested tables. Dropped the stylesheet, class, cell padding, inline image/style content, and page-break marker; no image node was registered, so the image was omitted. Link export prefixed the tokenized href with `https://`. A second import/export changed table-cell/paragraph styles again, so output was not stable. |

The probe also inspected engine-created editing DOM: Tiptap's core produced a
`contenteditable` element with `role="textbox"`; the bare Lexical core root had
neither attribute. This is not a full accessibility audit: toolbar semantics,
labels, keyboard behavior, announcements, and the final Lexical React
`ContentEditable` setup would still need application-level work and testing.

## Decision

Neither small integration met the postal-template round-trip contract. Both
require custom schema/nodes and HTML import/export handling for arbitrary
styles, tokenized attributes, and the page-break marker; Lexical additionally
needs an image node for this fixture. Their stable/canonical output is not a
replacement for the existing source mode, which must keep literal raw edits
until visual mode applies the existing HTML policy. **Retain the current
contentEditable editor and sanitized raw-HTML switch; do not migrate based on
this probe.** Reconsider only after a candidate passes the full postal browser
fixture with no authored-content loss and source/visual round trips are
explicitly specified.

## License and accessibility

The tested Tiptap packages and ProseMirror model/state packages, and the tested
Lexical packages, report MIT licenses in npm registry metadata. Both therefore
have permissive licensing in this probe; recheck package and extension
licenses before adopting a broader dependency set. Accessibility is not
guaranteed by either document model: Tiptap core supplied textbox semantics
in this probe, while the bare Lexical core did not, so Lexical integration must
provide and verify the appropriate editable/ARIA surface. Neither result
replaces an accessibility review of the editor controls and workflows.