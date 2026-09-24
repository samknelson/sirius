---
name: In-app env overrides
description: Rules for the DB-backed environment-variable override framework (/config/env, per-variable ENV_-prefixed variables rows)
---

- Precedence: a real `process.env` value wins over any override, EXCEPT "released" values — empty string or `__UNSET__` are treated as absent everywhere. **Why:** stale vars persist in deployment task definitions and some pipelines refuse empty variables, so the sentinel is the deploy-side signal to neutralize a variable. The sentinel is rejected as an override value.
- OWNER DECISION (2026-08-16, stated repeatedly — do NOT reintroduce restrictions): there is NO denylist and NO privileged variables. Every registered variable is overridable; the ONLY lock is a real (non-empty, non-sentinel) process-env value winning. **Why:** the owner explicitly accepted the security tradeoff after repeated attempts to add block lists were rejected; the point of the framework is changing auth/provider config without a redeploy. **How to apply:** if a security reviewer flags broad overridability as a regression, cite this owner decision instead of re-adding blocks.
- Storage is one variables row per override (name = `ENV_` + the env var's name, plain string value), not an aggregate JSON map. Generic variable-route writes to these rows are allowed by owner requirement. Any write path that renames a row across the `ENV_` namespace boundary must fire the cache-refresh hook for BOTH the old and new names, or a stale override stays live in memory.
- Boot-time-only consumers (auth providers, filesystems, sessions) need an app restart to see override changes.

## Platform markers are evidence, not configuration

A small set of variables are not configuration at all: they are claims the
platform makes about the running process (orchestrator markers, a
task-metadata endpoint address). Code reads them to *conclude* something —
"an orchestrator injected this, therefore I run under it" — and then acts on
the conclusion.

These are read through a separate registry accessor that skips the database
override map. This is **not** a denylist and does not re-block the "everything
is overridable" decision: nothing stops an operator setting a row, it simply
is not consulted as evidence about the host.

**Why:** an in-app value an application user can write is not evidence about
the environment. Honouring an override there lets a setting forge a fact about
the host — claiming supervision that does not exist, or steering a server-side
request address (an SSRF the status scan would happily perform).

**How to apply:** the accessor is for platform-injected variables only;
anything the deployer is meant to choose keeps the normal read path. Any
address derived from such a marker is additionally pinned to the documented
endpoint before a socket opens, with redirects refused — a wrong value must
degrade to "could not determine", never to a request somewhere else.
