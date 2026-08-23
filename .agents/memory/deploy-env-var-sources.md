---
name: Deploy-time env var sources for ECS
description: GitHub APP_* vars/secrets are the only working source of container env; the repo-managed per-env JSON file is referenced but unbuilt.
---

# Deploy-time env var sources for ECS

Per-environment container config is set in **GitHub Environment Variables and Secrets,
prefixed `APP_`**. That is the only source that reaches a running container.

A repo-managed per-environment JSON file under `deploy/` is referenced as though it also
feeds the container. It does not, and never has.

**Why:** it was documented ahead of being built. The failure mode is silent — a value set
there produces a green deploy and no change in the container.

**How to apply:** when asked where an environment's config lives, answer GitHub `APP_*`, and
verify before claiming the file works. Implementing it would touch the shared deploy workflow
and therefore every environment at once, so it needs an explicit precedence decision against
the GitHub set rather than being added for one environment.
