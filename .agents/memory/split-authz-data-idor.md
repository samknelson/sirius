---
name: Split authz/data config resolution is an IDOR
description: When access to gated content is keyed by a client-supplied id, resolve ONE config for both the authorization check and the data read.
---

# Split authorization vs. data resolution = confused-deputy / IDOR

When an endpoint authorizes a request by checking a role/permission attached
to a config row identified by a **client-supplied id**, and then **separately**
fetches the content/settings, the two lookups can diverge.

**The trap:** authorize against `query.configId` but let the data read fall
back to the plugin's canonical config when the supplied id doesn't match. A
caller passes a `configId` from a *different* plugin (whose role they legitimately
hold), clears the role check, and then receives *this* plugin's canonical content.

**Rule:** resolve exactly ONE authoritative config envelope first; require a
supplied id to belong to the requested resource (else 404); use that same
envelope for BOTH the role/permission check AND the settings/data read. If the
request resolves to no config, deny — never fall back to unrestricted content.

**Why:** dashboard content gating (Task #414) shipped with this exact gap —
role-checked the named configId but read settings via a separate helper that
silently fell back to canonical. Single-envelope resolution closes it.

**How to apply:** any time auth keys off a record id and the same handler then
reads that record's data, fetch once and branch off the single result; treat
"id provided but doesn't match this resource" as 404, and "no record" as deny.
