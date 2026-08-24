---
name: Template Studio host data honesty
description: A studio host owns its catalog request, so it must hand the studio that request's loading/error state, and roots must say whose records they are.
---

# The studio can only be honest about requests it is told about

The Template Studio is opened from many hosts (bulk message content, the
notifier config field, the generic ad-hoc tokenized field). Each host
fetches its OWN catalog from its own endpoint behind its own gate, and
passes the result down as data. A host that destructures only `data`
throws away the difference between "loaded and empty" and "the request
failed" — and the studio then renders identical blank panels for both.

**Rule:** every host that fetches a studio catalog must pass the query's
url + loading + error + a retry down to the studio, not just the data.
The panels' loading / failed / genuinely-empty wording is shared studio
behaviour; the raw request state is the one thing only the host knows.

**Why:** a bulk launch point looked "tokenless" for as long as it took a
developer with database access to prove the server was returning a full
catalog. Nothing in the browser said a request had failed.

**How to apply:** adding a new studio host, or a new studio data source
(a second catalog, a per-host tree), means wiring its request state
through the same way; the studio's in-browser diagnostics list is what
makes the next "why is this host empty?" answerable without server
access, and it can only list what it is given.

# Whose records a preview root offers

A root the container SUPPLIED records for offers those and nothing else.
A root the container merely NAMED falls back to the kind's own first
records — kept, because a studio with nothing to preview against helps
nobody, but always reported as the kind's, never passed off as the
container's.

**Why:** a bulk message with no recipients silently offered 11 unrelated
employers next to two genuinely-empty recipient roots: one panel, two
rules, neither labelled.

**How to apply:** the server tells the client both WHOSE the records are
and, when there are none, WHY (container supplied none / caller may read
none / kind offers none / kind is not previewable). Only the container
knows reasons like "this message has no recipients yet", so that one
travels as a container-supplied note keyed by root name — narration
layered on the rule, never a second rule.
