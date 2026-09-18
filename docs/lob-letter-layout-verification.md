# Lob letter layout verification

Verified on 2026-09-17 using the configured **test-mode** Lob key, with a
runtime assertion refusing any key that does not start with `test_`.
No live letters were sent. All names and letter content were synthetic.

## Approach

Lob's HTML renderer ignored `@page` margins, repeated table headers/footers,
and fixed-position bands in returned proofs. Automatic page breaks could
split text mid-line. Per-block negative-margin tricks were not suitable for
arbitrary letter HTML. The owner approved generating PDFs on the server
instead of continuing with a wrapper-only CSS fix.

The dependency-free shared letter shell defines US Letter pages with one-inch
margins and a three-inch first-page body start. Chromium renders that shell
to PDF; Lob receives multipart PDF bytes, never composed HTML. Template
Studio and manual compose use the same PDF renderer. Preview-only guides
are added to the PDF after rendering and are absent from mailed PDFs.

Lob-hosted template IDs retain their existing path and are not covered by
this layout verification.

## Geometry

Source: Lob's `letter_template_updated 4_25.pdf`.

- Sheet: 8.5 × 11 inches (612 × 792 points).
- Address/barcode knockout: 3.15 × 2 inches, starting 0.6 inches from the
  left and 0.84 inches from the top; lower edge at 2.84 inches.
- Body starts at 3 inches on page one, below the knockout.
- One-inch side margins clear the serial-number column and lower-left
  data matrix. Continuation pages have a one-inch top margin.

## Actual returned proofs

Both PDF uploads were accepted in test mode. Proofs were downloaded after
Lob finished rendering, their text bounding boxes measured, and **all three
returned pages visually inspected** as raster images.

| Proof | Pages | Body left/right bounds | Body top/bottom bounds |
| --- | ---: | --- | --- |
| Short letter | 1 | 72.00–534.18 pt | 217.00–370.39 pt |
| Long letter, page one | 2 total | 72.00–538.40 pt | 217.00–694.39 pt |
| Long letter, page two | — | 72.00–538.40 pt | 73.00–418.39 pt |

Checks passed:

- Neither address, the barcode, nor page markers overlapped body text.
- No text reached the paper edge or clipped across a page boundary.
- Page two used its normal one-inch top margin, without the address reserve.
- Every long-letter paragraph and the end marker appeared in order.
- The short-letter guided preview matched the same rendered body placement.

Proofs are delivered as `attached_assets/lob-short-letter-proof.pdf` and
`attached_assets/lob-two-page-letter-proof.pdf` (synthetic test content).

An additional **local-only nine-page stress PDF** included one oversized
paragraph, a list, and a long nested table cell. All measured body text
remained inside the page margins (first-page top ≥217.89 pt; continuation
top ≥73.89 pt; bottom ≤717.29 pt). This was not mailed or submitted to Lob.

## Enforcement and runtime

- Bare and notifier-wrapped bodies pass through the same sanitizer and shell.
  A copied shell marker does not bypass either.
- Raw whole HTML documents are refused. Caller CSS and active markup are
  removed from body fragments.
- Remote bulk files are downloaded only over HTTPS/443, using pinned public
  IPv4 DNS with revalidated redirects, 15-second/5-MB bounds, PDF signature,
  content-type, and page-size validation. HTML URLs cannot reach Lob.
- Lob's provider itself refuses all string `file` content; it accepts PDF
  bytes or the existing template-ID path.
- Rendering has independent one-slot delivery/preview queues, each with at
  most 16 waiters and a 30-second queue timeout. PDF preparation finishes
  before the durable communication/send-key claim. A renderer or remote-file
  failure therefore leaves keyed notices retryable without reopening a key
  after a provider attempt. The authenticated staff preview also uses the
  existing per-user flood limiter.
- The normal production image includes Chromium and document fonts; migration
  images do not. `CHROMIUM_EXECUTABLE_PATH` can override runtime discovery.
  Docker-image execution was not tested here because Docker is unavailable.

## Application checks

- Typecheck and all 16 architecture-lint rules passed.
- Vite production build and split server esbuild completed successfully.
  The existing `npm run build` script itself first invokes the now-refused
  `db:push`; the two compilation commands were run directly without any
  database push or schema changes.
- Focused postal/notifier suites passed after merging the separate
  hosted-template fix. The merge preserves hosted template IDs in Lob's
  `file` API field, while composed letters use multipart PDF uploads.
- Additional concurrency tests prove preview/delivery capacity isolation,
  bounded waits, slot release after failure, no claim during a pending render,
  and successful retry with the same send key after local preparation fails.
- Application restarted successfully and displayed its sign-in screen.
- Unauthenticated preview POST returned 401.
- Full test run: 136 suites passed; six suites had 21 failures in EDI fixture,
  migration/provenance, migration-timezone, and BAO case/DC expectations.
  None of those files or behaviors were changed by this layout work.
- The migration guard could not pass against the existing repository state:
  its default mode references a missing historical migration; comparison to
  `origin/main` reports pre-existing version-counter collisions. This task
  changes no schemas or migrations.