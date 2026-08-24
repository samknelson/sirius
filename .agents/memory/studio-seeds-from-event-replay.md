---
name: Studio seeds from event replay
description: How a notifier-style container with no records of its own supplies real preview records, and the id-alone record ref that makes it possible.
---

A container that is ABOUT events rather than about records (an event-notifier
config) still supplies its own studio seeds: replay the event bus's in-memory
recent-emit ring buffer for its subscribed events and run the container's OWN
root builders over each recorded payload. Recipients come from replaying the
recipient resolver with the config currently being edited, honoring the
per-config dispatch gate.

**Why:** the alternative shapes were both worse. A per-notifier "find me some
recent records" hook is plumbing on every notifier that drifts from what
delivery actually seeds, and most subject tables here have no timestamps to
order by. Replay reuses the exact builders delivery uses, so a seed can never
be a record the real message would not have been about, and the records offered
across roots are coherent because they came out of one emit.

The config being edited decides which remembered events count: ask the
same per-config dispatch predicate delivery asks, ONCE, and let every
root and the recipient list answer for that one eligible set.

**Why:** a config that fires on one status must never be offered a
record from an event at another status — that is a record it would
never have written about, and gating only the recipient list leaves the
record pickers lying.
**How to apply:** hand the studio record IDS, never rebuilt rows — a recorded
payload is a JSON snapshot and the row may have changed or been deleted since.
Skip truncated/unserializable payloads. A builder that throws costs that one
event that one root, never the editor. Cap to a handful, newest first.

Records replayed out of ONE occurrence are a coherent set, and the studio
has to keep them that way: tag every record with the occurrence it came
from and let the picker move siblings together (and drop a root to its
persona when the chosen occurrence has nothing for it).

**Why:** the record pickers are per root and independent. Offering real
records from several events without linking them lets an author preview
one event's parent beside another event's child — a message that was never
sent and could not be. Defaults have the same problem: anchor them on one
occurrence too.
Related framework rule: a container may name a candidate record BY ID ALONE
(omit the label). The kind's own preview load then supplies both the label and
the gate subject id, and a candidate whose record no longer loads is dropped
and reported separately from "none supplied" and "unreadable".

**Why:** a generic replay cannot know that, say, a dispatch status row is read
as a read of its worker. That knowledge already lives in the kind. Requiring
every container to repeat it is how a picker ends up gating a different record
than the render.

The buffer is per-process and cleared on restart. Say that plainly where the
picker would be — "nothing has fired since the app last started" is an honest
answer; an unexplained empty picker is not.
