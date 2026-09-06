---
name: Entity metadata eligibility
description: Record-history metadata is restricted to directly maintained records, with process-table exclusions enforced centrally.
---

The entity-metadata policy is the final product boundary: it rejects ledger and denorm table-name families plus explicitly process-owned tables. The storage leaf, admin registry, and cleanup migration must use the same policy; audit logging remains independent.

**Why:** Removing only admin registry entries allowed logging middleware to recreate metadata, while filtering only after pagination produced incorrect totals and pages.

**How to apply:** When adding a logging configuration or a process-owned table, decide eligibility in the dependency-light policy first. Keep migration cleanup idempotent and preserve metadata for directly maintained records and business history that relies on provenance.