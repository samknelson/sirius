---
name: Appeal grievance pattern
description: How S2 appeals are stored and tested inside the grievances module
---

## Rule
Appeals are individual grievances with `data.appealMeta.kind = "appeal"` — no separate table. Carrier is derived at read time from `trustBenefits.providerId → trustProviders`. New denial reasons live in `options_grievance_denial_reason`.

**Why:** Avoids a parallel case-management system; reuses all existing grievance infrastructure (status history, timeline, notes, files, list, worker tab).

**How to apply:**
- Distinguish appeals via `readAppealMeta(grievance.data)` (exported from `shared/schema/grievance/schema.ts`).
- Server filter: `data->'appealMeta'->>'kind' = 'appeal'` jsonb condition added to `GrievanceSearchFilters.kind = "appeal"` in storage search.
- New literal routes (`GET /api/grievances/appeal/benefits`, `POST /api/grievances/appeal`) MUST be registered before `/:id` — see employer-route-registration-order memory.
- Component option type `"grievance-denial-reason"` follows the unified-options pattern (add to `OptionsTypeName`, `optionsMetadata`, and `optionsTypeRegistry`).
- Migration: `scripts/migrate/components/grievance/030_create_options_grievance_denial_reason.ts` (component `grievance`, version 30).

## BAO appeal-only mode
- **Decision:** BAO component enablement selects an appeal-only product surface on the shared grievance infrastructure — no mode flag of its own, no second case system. Generic creation is refused server-side; every list/entity-scoped query on the surface filters `kind=appeal`; WORDING follows the surface (legacy generic records reached by direct URL are presented as appeals) while form BEHAVIOR follows the record's own metadata so legacy cardinality/class data is never coerced.
- **Decision:** appeal intake defaults (initial status + timeline template) are configuration, not user choice: one registry-validated variables row, applied server-side; missing or stale config refuses intake with an actionable conflict rather than silently picking a status. Non-BAO deployments keep the explicit-status contract.

## Integration tests
- Test file: `tests/grievances/appeal-intake.test.ts`
- The grievance component tables may be absent on a fresh test DB. The test imports all 30 grievance component migration modules at the top (which registers them), then calls `getComponentMigrations("grievance").sort(...).forEach(m => m.up())` in beforeAll. This pattern is reusable for any component whose tables may be missing.
- Trust benefits needed for testing are inserted via raw `db.execute(sql...)`, accessing result via `.rows[0]` (not destructured iterator).
- **Shared-dev-DB state**: `updateComponentCache(id, enabled)` writes the deployment's `components` variable — a suite that toggles a component (or deletes a settings variable) MUST capture the original value first and restore it in afterAll, or it silently reconfigures the running dev app (BAO got switched off this way; the preview showed generic Grievances until restored + restarted).
