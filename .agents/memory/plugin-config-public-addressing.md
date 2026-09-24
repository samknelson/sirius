---
name: Publicly addressing a plugin configuration
description: Why a component-managed plugin_configs row needs a declared alias to have a stable public URL, and how to resolve id-vs-alias safely.
---

## The rule

A `plugin_configs.id` is minted per database (`gen_random_uuid()`), so it names a
different row in every environment. Any surface that publishes a configuration's
address to the outside world — a URL an external caller bookmarks, a webhook
target, a documented endpoint — must offer a second, **declared** address that
the component manifest sets, not the id.

Keep that declared address in the base `data` jsonb as an `envelopeFields` entry
(folded in by `toRows`, lifted back out by `hydrate`) rather than inventing a
subsidiary table for one string.

**Why:** a component-managed configuration is created fresh in every
environment, so an id-based URL captured in dev is dead in prod. The manifest
declaration is the only thing that is identical everywhere.

**How to apply:** resolve **id first, then the declared alias**. A UUID-shaped
alias can then never shadow a real row. Do not enforce alias uniqueness at save
time — refuse an ambiguous alias at call time and fold that refusal into the
same indistinguishable response as "unknown", so an outsider cannot probe for
which aliases exist.

## Related: one resolution, many checks

A public dispatcher must resolve the configuration **once** and reuse that same
record for the grant check, the enabled check, the plugin/component check and
the handler call. A second lookup between authorization and use is the
split-authz/data IDOR (see `split-authz-data-idor.md`).

Every config-level refusal — unknown, ambiguous, ungranted, disabled,
plugin unregistered, component off — must return one byte-identical body, with
the real reason recorded only in the request log.
