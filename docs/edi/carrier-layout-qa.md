# Carrier-layout QA downloads

The Provider Trust EDI wizard's Deliver step offers **Provider file** by
default and **Carrier-layout CSV** for inspection. Both read saved generated
rows through the authorized wizard export endpoint. Downloads do not run
generation, update delivery state, or invoke provider transport.

The QA export decodes each carrier serializer's actual output, using its
authoritative field order and widths. Fixed-width cells retain their spaces,
truncation and carrier encodings. CSV cells retain their serialized values;
native column headings, suppressed headings, separators, file headers and
trailers follow the native serializer. This includes Local 11's legacy CSV
serializer, whose `outputFormat` metadata is not changed.

QA CSV has a first-column **QA-only** record-kind label. **QA-only field
names** rows describe the layout that follows. These additions are not
transmitted data. Different file-header/trailer layouts have separate
headings rather than borrowing detail-record column names. Import columns as
text in a spreadsheet to preserve codes, dates and leading zeros. The file
contains sensitive personal and coverage data; do not submit it to a carrier.
SFTP delivery and re-delivery always assemble the native file independently
of the download selector.

## Verification

- `tests/edi/carrier-layout-csv.test.ts` traverses every registered provider,
  comparing QA cells against actual native records, including empty runs,
  delimiters/quotes/newlines, non-ASCII values, overlong values, constants,
  padding, overpunch, and distinct file headers/trailers.
- `tests/edi/deliver-export.test.ts` exercises the dispatcher over HTTP with
  controlled authorization/storage/transport fixtures. It covers saved and
  delivered runs, filenames, MIME types, empty output, failures, permissions,
  unchanged Results exports, and native-only SFTP/re-delivery. No real provider
  transfer is made.
- `tests/edi/deliver-ui.test.tsx` exercises the actual React Deliver component
  with controlled requests, including default/selected downloads, server
  filenames, failures, pending state, stale responses, and native-only submit.
- Built-in help `system:provider-edi` remains scoped to
  `/trust/provider-edi`; path matching, near misses and sanitized guidance are
  checked in `tests/help/workflow-coverage.test.ts`. Local help is not changed.

The existing independent carrier conformance suite was also run. Its structural
checks for Kaiser, HealthNet and Delta pass, but its pre-existing fixture
inventory check fails for Local 11, Hinge, Dentwell, MLK, Carelon, VSP and
Express Scripts: these plugins were already registered without entries in
`tests/edi/fixtures/legacy-layouts.ts`. The QA fidelity tests cover all ten
registered serializers without weakening that independent specification check.

The application was restarted successfully. The live preview of
`/trust/provider-edi` requires sign-in, so the authenticated Deliver screen,
`/config/helps` listing, and Help dialog were not visually verified. Component
tests and source/path/sanitization checks are not a substitute for that
authenticated browser verification.
