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

## External SVG logos: local proof and Stage rollout

### Evidence boundary

The supplied public Benefits 11 logo was fetched read-only and stored unchanged
as `tests/comm/fixtures/benefits11-logo.svg`: HTTP 200, `image/svg+xml`, 13,340
bytes, intrinsic dimensions 240 × 56.75. The inspected pre-change downloader
accepted only PNG/JPEG. This establishes an incompatibility in that source,
**not the cause of the deployed Stage failure**.

The reported facts are that text-only Stage previews work and the image renders
on Dev. The reported Dev surface has not been confirmed as HTML or PDF, and
the authenticated requests and deployed revisions for Dev/Stage have not been
provided. In the checked-out Studio, postal preview requests
`POST /api/comm/postal/preview` and displays an `application/pdf` response;
email preview uses HTML and can display SVG directly without this converter.
There is no Replit-published deployment recorded for this workspace. No Stage
deployment, branch push, infrastructure change, or postal send was performed.

### Conversion contract

Only the **external HTTPS image** branch additionally accepts
`image/svg+xml`. The downloader still validates HTTPS/443, refuses credentials,
checks all DNS answers, pins public IPv4 sockets, revalidates every redirect,
and enforces its overall 15-second and 1-MB download bounds. Input format is
selected by the validated response MIME type and verified content, not the
filename. Remote letter documents remain `application/pdf`-only. Managed
image ownership, filesystem access, retention, and PNG/JPEG upload policy are
unchanged.

The static SVG subset supports path-based shapes, groups, transforms,
local gradients, clips/masks, and allowlisted inline presentation styles.
Scripts, handlers, animations, `foreignObject`, images, `use` expansion,
text/fonts, CSS sheets/imports, DTD/entities, processing instructions,
unknown markup/attributes, and external references are refused. Missing,
circular, deeply nested or excessive fragment references are refused.
Assets requiring unsupported features must be exported as PNG/JPEG or have
their text converted to paths; this is not a general-purpose browser SVG engine.

Source is bounded to 1 MB, 2,000 elements, 32 nesting levels, 60,000 geometry
numbers and bounded attribute lengths/coordinate magnitudes. Conversion uses
the production `@resvg/resvg-wasm` package in a dedicated worker with no
SVG-selected filesystem, network, or font resource loader. The only host file
read is the fixed package WASM binary. The five-second deadline terminates the
worker and awaits its exit on every result; worker CLI flags are not inherited.
Conversion is sequential within each existing renderer lane, so at most one
converter per preview/delivery lane can run.

At 300/96 raster scale, the output must fit 8,192 pixels per edge, 16 megapixels
and 1 MB of PNG. Both source and converted bytes count toward the combined
5-MB image budget. The renderer keeps SVG intrinsic CSS size/aspect ratio so
the higher-resolution PNG does not enlarge an unsized logo. Only verified
raster data URLs reach Chromium, which still has JavaScript and networking
disabled. Preview guides are added after the shared delivery render.

Controlled refusals return HTTP 422 with the original image number and a
fixed reason; maintenance remains HTTP 503, and unexpected preview failures
remain generic HTTP 500. The existing preview component displays that message.
The shared renderer persists sanitized stage/category/image number, lane and
allowlisted transport status/code via the administrator-visible storage logger.
It never logs raw exceptions, HTML, image bytes, URLs, credentials or query
strings. Queue failures are recorded separately at stage `queue`.

### Local verification

- Live public-address-pinned HTTPS fetch and conversion succeeded: 13,340-byte
  SVG → 16,301-byte transparent PNG, 750 × 177 pixels.
- Actual Chromium PDF tests compare identical image/alpha streams between
  guided preview and delivery, inspect embedded resolution near 300 DPI,
  assert US Letter geometry, measure text placement and rasterize the PDF to
  prove visible colored logo pixels in the expected body region. No mail API
  is used.
- Deterministic tests cover the stored logo, local fragment references,
  unsafe resource/active/XML attacks, geometry/source/nesting/element limits,
  source-plus-output budgeting, PNG/JPEG transport, managed-image ownership,
  original image numbering, safe route responses, redacted admin diagnostics,
  and timeout cleanup including termination of genuinely busy synchronous
  execution.
- The compiled converter and worker passed with an isolated directory
  containing **only** its production dependencies, under UID 1000.
  Docker now runs `scripts/dev/verify-letter-svg-runtime.mjs` after dependency
  pruning and again as its non-root web-image user. This does not require
  native SVG libraries or fonts. **The actual Docker image build/run is not
  executed in this Replit environment**; the authorized production builder
  must pass those checks before rollout.
- Architecture lint passed all 16 rules; typechecks passed. The application
  restarted and its sign-in page was visually checked. Authenticated Studio
  UI was not exercised through the screenshot browser; route tests and real
  Chromium rendering provide local proof instead.

### Required authorized Stage checks (still pending)

1. Before deploying, identify whether the reported Dev success is email HTML
   or postal PDF. For postal, confirm the request is
   `POST /api/comm/postal/preview`, that it returns `application/pdf`, and that
   the logo is visible in that PDF. Capture revision/build identities on both
   environments using deployment records; do not equate a local branch name
   or a generic load-balancer health response with the running revision.
2. Compare the exact resolved image source and sanitized template body on both
   environments in an authorized browser. Keep private body text and signed
   URLs out of logs/reports. Record response status, controlled category,
   image number, and whether an admin `letter-renderer` entry exists.
3. After an operator deploys this revision and the Docker smoke checks pass,
   preview the same text-only letter, the supplied public SVG logo URL, a
   known PNG and JPEG, and a live managed template upload. Confirm visible
   logo proportions/colors, transparent background, correct letter margins,
   continuation-page layout, and preview-only address guides.
4. Use a deliberately unsupported/invalid test image to confirm the preview
   identifies its number and reason. Check the admin log viewer for fixed
   diagnostic context with no private markup, bytes, URL or signed query.
5. Record observed revision, timestamp, statuses and visual outcome. Do not
   send a real postal communication, alter managed-image retention, or claim
   Stage is fixed until those deployed observations exist.