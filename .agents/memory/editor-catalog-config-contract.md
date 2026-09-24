---
name: Editor catalog config contract
description: Why an in-progress editor sends its WHOLE unsaved config to a catalog/preview endpoint instead of a declared list of dependent fields.
---

When an editor asks the server what its unsaved config would produce (default
templates, who a notifier would write to, seed records), send the whole current
config minus the thing being edited — not a schema-declared list of "the fields
that matter".

**Why:** a per-field dependency declaration is a parallel copy of what the
server-side hooks read, and it goes stale the moment one of those hooks reads
one more field. That is not a visible break: the endpoint simply answers for a
config the author does not have, e.g. reporting "no recipients" because the
role/status fields the dispatch gate reads were never sent. Once the whole
config is sent, the declaration has no consumer left — delete it rather than
keeping a second source of truth.

**How to apply:** serialize the config into the request (and hence into the
query key, so it refetches on change), and DEBOUNCE it — otherwise a keystroke
in any config field re-runs the whole catalog, including any replay behind its
seed records. Keep the answer out of the input: the templates being edited are
what the request is about, never an input to it. This is a GET query string, so
if a config ever grows a large or sensitive setting, move the request to a POST
body instead of filtering fields heuristically.
