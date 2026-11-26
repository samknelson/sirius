---
name: Private SAML capture
description: Audience and failure boundaries for full assertion and role-explanation capture.
---
Keep full assertions and their mapping explanations together in the admin-only
capture. Correlate through metadata identifiers, not entity/host log bindings.
Never publish private authentication observations on shared events.

**Why:** Entity log history can have a wider staff audience than System Logs.
Binding an assertion to a user or host could expose credentials to that audience.

**How to apply:** Keep diagnostic payloads out of ordinary role-change audit
entries. Observation failure must not change login, grants or revocations.
Full ordinary authentication failure logs remain independently host-owned;
source removal is not a promise that those normal logs disappear.

Private capture must bypass log-event publication as well as avoiding a direct
event emission.

**Why:** The normal storage-log transport fans a stored entry's complete metadata
out as a LOG event. Merely moving capture into a private hook does not prevent
credentials from reaching shared subscribers.

**How to apply:** Mark these diagnostic entries private at the log transport
boundary, preserving their complete stored payload and normal logging elsewhere.
