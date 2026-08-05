# Dependency security audit — remediation record (Aug 2026)

## Summary
Starting point: 66 findings (2 critical, 26 high, 36 moderate, 2 low).
After remediation: **0 critical, 0 low**, 2 high (both without a non-major fix — see below), 11 moderate (all require semver-major parent bumps).

## What was fixed
- **Clerk** (critical `@clerk/shared` authorization/middleware bypass): `@clerk/express` 2.0.8 → 2.1.50, `@clerk/clerk-react` 5.61.4 → 5.61.9; transitive `@clerk/shared`/`@clerk/backend` now at patched versions. Sign-in page, session gate (`/api/auth/user` → 401 unauthenticated) verified.
- **fast-xml-parser** (critical entity-expansion DoS, present at 4.x and 5.x): both instances now patched (5.10.1 via `@google-cloud/storage` 7.21.0 and `@aws-sdk/xml-builder`).
- Direct bumps: `multer` 2.2.0, `postcss` 8.5.25, `ws` 8.21.2, `adm-zip` 0.6.0, `basic-ftp` 5.3.1, `drizzle-orm` 0.45.2 (SQL-identifier escaping fix), `express` patched.
- Lockfile refresh resolved the remaining transitive highs (`axios`, `form-data`, `@xmldom/xmldom`, `fast-uri`, `glob`, `brace-expansion`, `picomatch`, `rollup`, `ip-address`, `js-yaml`, `jws`, `minimatch`, `path-to-regexp`, `js-cookie`). No npm overrides were needed.

Verified: `tsc` clean, app boots cleanly (migrations, plugin registries, component cache), login page renders, auth gate works.

## Accepted / deferred findings

### xlsx (high — prototype pollution, ReDoS) — NO FIX AVAILABLE
No patched version exists on the npm registry for either advisory.
**Exposure assessment:** xlsx is used only for staff-initiated spreadsheet parsing/generation behind authenticated, permission-gated routes; files come from trusted staff uploads, not anonymous users. ReDoS/prototype-pollution risk is therefore limited to an authenticated insider submitting a malicious workbook.
**Mitigation:** keep uploads behind authz (already the case); consider migrating to a maintained alternative (e.g. `exceljs`) as follow-up work.

### vite (high — path traversal in optimized-deps `.map` handling) — DEFERRED
The fix now requires **vite 8.x** (not the 5→6 bump the original scan suggested) plus a matching `@vitejs/plugin-react` / `@tailwindcss/vite` upgrade — a multi-major toolchain change. The vulnerability affects the **dev server only**; production serves prebuilt static assets, so the deployed app is not exposed. Deferred as a separate toolchain-upgrade task.

### Remaining moderates (all need semver-major parent bumps)
- `drizzle-kit` (dev-only, via legacy `@esbuild-kit/*` esbuild): dev tooling, not runtime.
- `esbuild` dev-server advisory via vite (dev-only, fixed by the vite major above).
- `@google-cloud/storage` transitive `uuid`/`teeny-request`/`retry-request`: audit's "fix" is a downgrade to 5.x — worse than staying current; low practical risk.
- `officeparser`/`file-type` (malformed-ASF infinite loop): requires officeparser 7.x major; parsing is staff-initiated only.
