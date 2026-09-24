---
name: Dead capability removal
description: House rule — if a capability has no caller, delete it; never invent a user story to justify code that already exists.
---

# Dead capability removal

If a capability is dead, remove it. Do not describe it as "forward
-looking", "extensible", or "there for hosts that need it".

**Why:** existing code exerts a pull toward being explained rather than
removed, and the explanation is always available after the fact. A
capability with no caller has no requirements either, so it drifts,
grows guards for hazards nobody faces, and quietly widens the surface
that every future change has to keep working. The owner treats an
invented user story as worse than the dead code itself, because it
converts a deletable branch into a permanent obligation.

**How to apply:** when you find an unused parameter, prop, request
shape, or branch, first prove nothing calls it (grep every caller, not
just the obvious one), then delete it along with the machinery that
existed only to make it safe. Do not reason from "someone might".

Removing the implementations is not removing the capability. Its
vocabulary survives in type names, helper names and doc comments, and
those comments keep asserting the capability exists — which is how it
gets rebuilt by the next reader who trusts them. Finish a removal by
renaming what was named after it and by rewriting every doc sentence
that still claims it. Leave ordinary English alone: a picker can "offer"
choices; what must go is any claim that the subsystem can produce data
it is only ever handed.

While rewriting those docs, check the sentence against the code rather
than against the old sentence. A contract line describing a count or a
reason usually has an edge case (a switched-off component, an empty
input) that the original phrasing quietly got wrong.

Deleting a request shape an API once accepted is not the same as making
it a no-op. Refuse it explicitly, by PRESENCE of the key rather than by
truthiness (`{"entity": null}` is a caller describing a shape you no
longer serve), and name the one shape you do accept in the refusal. A
caller sending a retired shape is describing a result it will not get,
and silently rendering something else is the lie the whole surface
exists to avoid.
