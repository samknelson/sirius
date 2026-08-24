---
name: Remote schema bring-up diagnosis
description: How boot-time schema bring-up is reported and repaired on a target with no shell — env-var-only levers, report-only mode, and the drift↔migration correlation.
---

# Bring-up diagnosis for a shell-less target

The deployment operator has **only** the deploy log, the env vars the pipeline
injects, and a redeploy. Every diagnosis must therefore reach them through the
boot log or over HTTP, and every repair must be an environment variable.

**Rule:** never answer a bring-up problem with a script to run on the target.
If a repair cannot be expressed as "set a variable and redeploy", or "ship a
file in the next image", it is not a usable repair.

## Structural consequences

- The bring-up report module is a **pure leaf with zero imports** and prints
  with `console.log`, not winston. The database is the thing that may be
  broken, and the entry point has to read the report before `DATABASE_URL`
  even exists. Same constraint as the boot-status module — don't add imports
  to either.
- A migration failure is **fatal**. When it wasn't, the first thing that
  actually refused to boot was the drift gate, so the operator saw a table
  diff instead of the migration error. The symptom outranked the cause in the
  log, and three different situations (never attempted / attempted and failed
  / stamp ahead of schema) produced byte-identical output.
- Report-only mode stops the boot by **throwing a named error**, not
  `process.exit`: exiting crash-loops the container and takes the report with
  it. The entry points recognize the error name and keep serving.

## Drift ↔ migration correlation is textual, and deliberately so

Migrations do not declare which tables/columns they touch, and adding
declarations would mean editing every migration file. The correlation matches
drift tokens against each migration's `name` + `description`, on non-word
boundaries so `_` counts as part of a token.

**Why:** the alternative (a declared table list per migration) is a large,
permanently-maintained edit for a diagnostic; a fuzzy match that names its own
method is honest and good enough to classify.

**How to apply:** if you extend it, keep two properties. Matches are ranked
**newest first** — the migration that CREATES a drifted item is the most
recent one mentioning it, and old migrations mention common tokens like
`sirius_id` constantly. And the suggested resume version is
`min(per-item newest match) − 1`: low enough that every drifted item re-runs,
high enough not to replay half the history over one incidental token match.
Always state in the output that the match is by name and description.

## A stamp-setting recovery variable must work in both directions

Lowering the stored `migrations_version` replays every migration above it, and
that only works because core migrations here check for their own work first
(`IF NOT EXISTS`, or an `information_schema` probe with an early return). It is
a convention, not something the runner can verify — verified once by replaying
the whole recent range against a fully-present schema, which was a clean no-op.

**Why both directions:** if one replayed migration does refuse to re-apply, a
lower-only variable leaves the stamp down and the boot wedged, repairable only
with database access — the one thing a shell-less target does not have. Raising
the stamp declares those migrations applied and resumes past the offender.

**How to apply:** any env-var lever that rewrites a high-water mark needs a way
to undo itself from the same lever, and both directions get equally loud
one-shot logging.

## Baselines must stay below the ordinary core sequence

The empty-database bootstrap stamps `migrations_version` to the **highest
registered core version, baselines included**. A baseline numbered above the
ordinary migrations would therefore retire all of them permanently on a fresh
database. Startup asserts this; baselines carry an explicit `baseline: true`
flag rather than being inferred from `version >= 1000`, because ordinary core
migrations passed 1000 long ago.
