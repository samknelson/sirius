---
name: S1 doc publication split
description: How to deliver S1-migration design docs — sanitized tracked copy in docs/, record-level evidence stays in untracked docs/s1-migration
---
Rule: an S1-migration deliverable that reviewers/operators need must be published as a **sanitized tracked doc in `docs/`** (aggregates only — no prod entity nids, no payment-level amounts, no connection details), with a pointer stub + record-level "local evidence appendix" left in the untracked `docs/s1-migration/` so existing cross-references resolve. Raw prod dry-run exports (pasted attachments with entity ids/amounts) must be untracked/gitignored too.

**Why:** completion code review rejects work whose deliverables live only in the gitignored `docs/s1-migration/` (invisible in the diff), but force-adding that dir is forbidden (push protection — see s1-docs-push-protection.md), and review also rejects tracked files carrying record-level production financial data. The split satisfies all three constraints (first done for the N6 balance-parity doc: tracked `docs/n6-balance-parity.md` + local `docs/s1-migration/08-*` stub/appendix).

**How to apply:** when authoring any new S1-migration design/runbook, write the full sanitized version under `docs/`, keep nid lists / per-record tables / raw exports local-only, and have each side link to the other. Reviewers also expect: field-table SQL to carry the canonical `entity_type='node' AND deleted=0 AND language='und'` predicates, and snapshot-consistency claims to be precise (bracketing checks on fresh snapshots + ETL-owned export; never a pinned repeatable-read transaction that the ETL connection doesn't share).
