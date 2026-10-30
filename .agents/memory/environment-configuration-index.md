---
name: Environment configuration
description: Index of override precedence, canonical public origin, registry, and shared environment UI rules.
---

- [In-app overrides](env-overrides-framework.md) — deployment values win unless released; all registered variables remain overridable.
- [Canonical public origin](public-url-registry.md) — PUBLIC_URL owns the platform-domain fallback chain and external callback base.
- [Environment registry](env-var-registry.md) — all server environment reads use the pure registry leaf.
- [Shared presentation](env-variable-presentation-shared.md) — configuration screens reuse the shared environment row.
- [Reload classification](env-change-effect-reload.md) — registry consistency and restart-baseline semantics.
