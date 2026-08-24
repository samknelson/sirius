---
name: Plugin id inside client-facing schema metadata
description: Never let a plugin hand-write its own id into schema metadata that addresses a by-id endpoint; stamp it at registration from the registered id.
---

When a plugin's JSON-Schema metadata carries a URL or id that the client uses to call
a by-id endpoint (e.g. a notifier's message-template card fetching its token catalog),
that id must be stamped onto the schema at REGISTRATION time from the id the plugin is
actually registered under — never passed in by hand from a local constant in the plugin
file.

**Why:** a hand-written constant is free to drift from the registered id, and when it
does the endpoint 404s. The failure is completely silent to the author and to the
server: the editing surface still renders, it just has no catalog — no tokens, no
defaults, no preview roots — and nothing anywhere says why. Every other plugin
happening to use the same string for both hides the hazard until one doesn't.

**How to apply:** builders of client-facing schema blocks should not accept a plugin id
parameter at all. The register function walks the built schema and stamps the id/URL,
and throws when it finds nothing to stamp (a plugin declaring the feature but exposing
no card is the same silent nothing). Same reasoning applies to any other
"id repeated in two places" metadata: derive it from the single registration.
