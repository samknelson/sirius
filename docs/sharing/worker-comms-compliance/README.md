# Worker Comms Compliance — merge-ready handoff

This package transfers the existing component to a related, expanded codebase.
It is **not** a standalone application or an npm package. Keep the receiving
application's framework and extra features. Do not replace shared files wholesale.

Start with `INTEGRATION.md`. For another Replit Agent, use this prompt:

> Integrate Worker Comms Compliance from this archive into this existing app.
> Read README.md, INTEGRATION.md, and manifest.json first. Treat source/ shared
> framework files as reference, not overwrite instructions. Check compatibility,
> make a clean Git branch, and apply the minimal feature patch with three-way
> merging where necessary. Preserve this app's expanded worker filters, policy,
> storage, menu, dashboard, and bulk behavior. Retain the canonical component
> identifier, paths, definition prefix, and API. If a prerequisite is missing,
> explain it before expanding the scope. Run the supplied verification and
> application checks. Do not import data, replace databases, change authentication,
> publish, or send communications as part of this handoff.

## Contents

| Path | Purpose |
| --- | --- |
| `manifest.json` | Exact source and pre-feature commits, file classifications, SHA-256 checksums, Git blob IDs, package versions, prerequisite imports. |
| `feature.patch` | Complete scoped patch: initial component plus benefit-history enhancements and corrected help text. No unrelated application changes. |
| `source/` | Current versions of all feature and integration files. Shared-file snapshots are reference material. |
| `base/` | Pre-feature versions of modified shared files, for reliable three-way conflict resolution. |
| `reference/` | Small existing prerequisites, supplied for comparison only. Do not overwrite their equivalents. |
| `tools/verify.py` | Integrity check, offline patch reconstruction, and read-only target compatibility checks. |
| `tools/seed_merge_bases.py` | Optional, explicit import of old blobs into the target's Git object store if three-way application needs them. Does not change files, staging, or the database. |

No secrets, environment files, database exports, saved definitions, contact or
worker records, Git repository history, or installed packages are included.
No SQL migration or deployment configuration is supplied.

## Scope and semantics

- Staff report at `/workers/comms-compliance`, saved definitions, dashboard card.
- Any selected member status **and** any selected benefit, plus other population
  dimensions. OR within each selected dimension; AND between dimensions.
- Benefit membership comes from monthly `trust_wmb` facts, not daily enrollment.
- **Current:** the current site-calendar month. This remains the default for old
  definitions with no explicit history setting.
- **Ever:** any month through the current month; future-only facts do not qualify.
- **Last N months:** current month plus N−1 preceding months (1–1200).
- **Date range:** any month overlapping the inclusive calendar-date range.
  One qualifying month is sufficient; continuous coverage is not required.
- No selected benefits means no benefit restriction.
- Communication evidence requires one communication satisfying the selected tag,
  status, optional medium, and optional sent-date limits. Benefit dates and
  communication dates are independent.
- With/without matching communication views, counts, dashboard summaries, and
  new/existing bulk-message handoff use the same population logic.
- Queueing is not proof of delivery. Offline history is not proof of physical
  receipt. This package does not change delivery or postal CSV processing.

## Merge strategy for related repositories

Prefer integrating on a named feature branch and keeping its integration commit
in the receiving repository. Record the manifest's source commit and pre-feature
commit in that commit message. A patch alone does **not** import Git ancestry.

If both repositories already share history and can be connected, normal Git
branch merges preserve ancestry better than repeated copy-and-paste. This archive
deliberately does not connect remotes, import whole histories, or include unrelated
changes. Do not blindly cherry-pick a long range containing other features.

Keep canonical source paths and identifiers rather than creating a second copy
with different names. Resolve expanded shared-framework changes by combining
behavior, not choosing our entire file or the target's entire file.

For the next update, retain this manifest, the package, and the target integration
commit. Request a patch from **this package's source commit** to the newer source
commit. Apply that delta on top of the recorded integration rather than reapplying
the initial feature patch. If target-side changes improve the component, reconcile
them upstream before the next delta.

## Saved definitions and optional components

Definitions use existing `variables` records named
`worker_comms_compliance_definition:<id>`. This archive contains **no definitions**;
create appropriate ones in the target's admin UI. Definition values contain
database-specific tag, benefit, member-status, employer, bargaining-unit, and
representative IDs. Never blindly copy source values into another database.
Remap IDs and validate references if a separate data transfer is later approved.

The component is registered disabled by default. Enable **Worker Comms Compliance**
in the target's existing component configuration. Enable Bulk Messaging separately
to use handoff actions, and benefits support for benefit restrictions. Preserve
fail-closed behavior when a saved restriction references an unavailable component
or option. Do not enable optional schemas through ad hoc production SQL.

## Verification limits

The source feature was exercised by 36 focused tests, including temporary-table
SQL tests. This is not certification of compatibility with a different codebase.
Run the target checks and signed-in smoke tests described in INTEGRATION.md.
The archive verifier does not execute application code or contact a database.
