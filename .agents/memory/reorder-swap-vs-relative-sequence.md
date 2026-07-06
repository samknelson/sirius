---
name: Reorder via swap, not relative +/-1
description: Why Move Up/Down reordering should swap adjacent sequence values instead of copying the GenericOptionsPage relative-math pattern.
---

The canonical `GenericOptionsPage` Move Up/Down reorder computes a new
sequence relative to the neighbor: `prev.sequence - 1` (up) /
`next.sequence + 1` (down), then issues one PATCH.

**This breaks on dense integer sequences (0,1,2,3…):**
- Move-up on the 2nd row sends `-1`. If the endpoint validates
  `sequence >= 0` (e.g. a zod `.min(0)`), the PATCH is rejected (400).
- Move-down places the row at `next.sequence + 1`, which equals the
  sequence of the row *after* next → collision + nondeterministic order
  unless `orderBy` has a tiebreak.

**Rule:** for adjacent Move Up/Down, swap the two rows' sequence values
instead. With distinct sequences this is exact, never negative, never
colliding. Reusing a per-row PATCH endpoint = two PATCH calls (current
↔ neighbor); no dedicated reorder route needed.

**Also:** always give the list `orderBy` a deterministic secondary key
(e.g. `asc(sequence), asc(id)`) so equal sequences never render in
random order.

**Best of all:** make the swap atomic server-side. When a per-row PATCH
sets \`sequence\` to a value another row already holds, do both writes in
one storage transaction (give the conflicting row this row's old
sequence, then set this row). One PATCH reorders, no dedicated route,
and a partial failure can't leave duplicate sequences. (No DB unique
constraint on \`(parent_id, sequence)\` — a non-deferrable one would
reject the swap's intermediate duplicate state.)

**Why:** copying the GenericOptionsPage math verbatim hard-blocks
move-up (negative, rejected by min(0)) and makes move-down collide; a
client-side two-PATCH swap fixes that but is non-atomic.
