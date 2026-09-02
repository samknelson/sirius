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
- BAO enablement (`isComponentEnabled("sitespecific.bao")` server / `hasComponent(APPEAL_ONLY_COMPONENT)` client) makes the grievance surface appeal-only: generic `POST /api/grievances` returns 403, list/detail/edit/history pages relabel as Appeals, `/grievances/add` redirects to `/grievances/appeal`.
- Appeal defaults are one variables row `sitespecific.bao.appeal_workflow` (`{ initialStatusId, timelineTemplateId }`), Zod-validated via `appealWorkflowSettingsSchema` and registered in the variable registry. In BAO mode intake ignores client statusId and applies these; missing/stale config → 409 with an actionable message. Non-BAO deployments still require an explicit statusId (400 without one).
- New exports from `shared/schema/grievance/schema.ts` MUST also be added to the named re-export list in `shared/schema.ts` (the barrel is selective; typecheck catches it, but a missed name means undefined at runtime in dev).
- The edit page's status card syncs `selectedStatusId` from the refreshed grievance's `currentStatusId` via useEffect — the status-history POST invalidates the grievance query and the card must follow the refreshed data, not its initial state.

## Integration tests
- Test file: `tests/grievances/appeal-intake.test.ts`
- The grievance component tables may be absent on a fresh test DB. The test imports all 30 grievance component migration modules at the top (which registers them), then calls `getComponentMigrations("grievance").sort(...).forEach(m => m.up())` in beforeAll. This pattern is reusable for any component whose tables may be missing.
- Trust benefits needed for testing are inserted via raw `db.execute(sql...)`, accessing result via `.rows[0]` (not destructured iterator).
- **Shared-dev-DB state**: `updateComponentCache(id, enabled)` writes the deployment's `components` variable — a suite that toggles a component (or deletes a settings variable) MUST capture the original value first and restore it in afterAll, or it silently reconfigures the running dev app (BAO got switched off this way; the preview showed generic Grievances until restored + restarted).
