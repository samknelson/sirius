# Operational gotchas

Hard-won traps that cost real debugging time. Migration-loader items come from
the 2026-08 real-data rehearsal (ECS one-off tasks → `migration-rehearsal-2026-08-06`).
Authoritative procedure: [`scripts/s1-migration/RUNBOOK.md`](../scripts/s1-migration/RUNBOOK.md);
spec: [`docs/s1-migration/`](s1-migration/README.md).

## S1→S2 migration / loader operations

- **Election bundle name trap.** The election node bundle is
  `sirius_trust_worker_election` — ad-hoc field-table SQL filtering
  `bundle='sirius_trust_election'` returns empty and yields false conclusions
  (loaders use the correct name and are unaffected). See 07-prod-query-pack §P4.
- **`rate=` is a cumulative average, not current speed.** Heartbeat `rate=`
  averages since run start; early fast pages inflate it and it *declines for
  hours* as target indexes grow (benefit-history settled ≈41 spans/s). A
  falling rate is normal, not a stall. `eta=` is omitted when unknowable —
  the hung-run signal remains *silence* on the liveness line, never a bad ETA.
- **The `--allow-rejects` gate fires at END of run, after all writes.** A run
  that exits `FAIL: reject reason(s) not allowed` has already persisted its
  rows and id_map entries; the corrected re-run is adopt-only and much faster.
  Corollary: a brand-new reject class can surface only at the end gate after
  hours of work (this is how `benefit_ref_missing` appeared). RUNBOOK §7.
- **The ECS image pins source at build time.** A fix committed to `bao-dev`
  does nothing until the image is rebuilt AND a new task started; in-flight
  runs keep the code they started with. RUNBOOK §1.
- **Old-image WARN flood during hours loads.** Images predating the throttle
  flood CloudWatch with per-trigger charge-executor `--migration-mode` WARNs —
  filter Live Tail to `ERROR`/`FAIL` instead of scrolling. Newer images
  throttle to one WARN per trigger per 5 min with `suppressedSinceLastWarn`.
  RUNBOOK §4.1.
- **The hours loader has NO reject gate — by design.** Problem rows are
  counted skips (`legacy_json_format`, `missing_worker_ref`, …), never fatal;
  review the final skip block instead of expecting an allow-list.
  `--migration-mode` is REQUIRED on any target with migrated ledger data;
  `--stub-missing` is a dev-only crutch, FORBIDDEN on a real target.
  RUNBOOK §4 row 12.
- **`--open-end-through` = the transition month** (the month the migration run
  happens in; the 2026-08 rehearsal used `2026-08`). Benefit-history and the
  §6 parity harness MUST be given the same value. RUNBOOK §4 row 9, §6.

## Dev workflow

- **`scripts/` is outside the app typecheck.** `npm run check` covers the app
  tsconfig only. Run `npx tsc -p tsconfig.scripts.json --noEmit` before first
  execution of a new or changed loader/script.
- **Pushes to `bao-dev` / `bao-prd` go through the workflows** ("Push to
  bao-dev" / "Push to bao-prd", `scripts/dev/push-branch.sh`) — never a manual
  `git push`; verify the result in the workflow's logs.
- **Workspace commits use `git -c core.hooksPath=/dev/null commit`** (hooks
  otherwise interfere with commits from this environment; the registered
  validations still run on task completion).

More app-level gotchas (facility sync, wizard access control, component-owned
tables, dev-server restart rules): `replit.md` → "Gotchas".
