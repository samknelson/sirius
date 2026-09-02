# Carrier EDI reference

Consolidated, in-repository reference for every carrier eligibility (EDI)
file the trust-provider EDI plugin kind produces
(`server/plugins/trust/provider-edi/`). One document per carrier, written
against the carrier's own specification — not against the legacy S1
generator or the current plugin source.

## Why this exists

Carrier files are parsed by byte offset by a third party. The only
defensible source of truth is the carrier's published layout, and the only
way to keep a plugin honest against it is to transcribe that layout into
the repository once, map every field to its authoritative S2 source, and
pin both in tests. The Delta Dental entry is the first completed reference
and the template for correcting the remaining carriers.

## Completed references

| Carrier | Plugin | Document |
| --- | --- | --- |
| Delta Dental (SMF) | `sitespecific-smf-delta` | [smf-delta-dental.md](smf-delta-dental.md) |

## How each reference is structured (the template)

Every carrier document records, in this order:

1. **Source specification** — the carrier document name, version, and date
   the transcription was made from. If the specification arrived as an
   attachment, name it here; the transcribed tables in the document are
   the durable copy.
2. **Record inventory** — every record type in the file (header, detail,
   trailer, …), its record-type constant, and its exact byte length.
3. **Field tables** — for each record type: field name, one-based
   position, width, required status, format rule, and the S2 mapping.
   The S2 mapping column takes one of:
   - a concrete source (`contacts.family`, `trust_wmb` coverage run, …)
     plus any transformation (date compaction, digit stripping, padding);
   - a constant, with where it is configured;
   - **blank — no S2 source**, with the rationale. An optional carrier
     field with no authoritative source stays blank; inventing data is
     never acceptable.
4. **Membership rule** — which people appear on the file and how
   subscriber/dependent family linkage is expressed.
5. **Synthetic examples** — golden records built from invented data,
   mirrored by the golden test suite.
6. **Open carrier questions** — every place the implementation and the
   specification disagree, or where the specification is ambiguous, with
   the current ruling and what confirmation is still needed.

## Where the enforcement lives

- Layout pin: `tests/edi/fixtures/legacy-layouts.ts` (field names, order,
  widths, total record width — transcribed from the spec, never derived
  from the plugin).
- Structural conformance (offsets, padding, truncation, constants,
  record width) for every registered plugin:
  `tests/edi/provider-edi-conformance.test.ts`.
- Carrier-specific golden records, header/trailer behavior, and code
  mappings: `tests/edi/<carrier>-edi.test.ts`.
