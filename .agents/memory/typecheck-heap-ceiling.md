---
name: Typecheck heap ceiling
description: Why the typecheck runs as two pinned tsc processes, and which memory levers were measured and rejected.
---

**Rule:** the whole-repo typecheck runs as two sequential tsc processes, each
with an explicit heap ceiling — never as one process inheriting the machine's
default.

**Why:** one combined program outgrew the default Node heap. It needs more
than a stock CI runner gives Node, so the check died with "Reached heap limit"
on CI while passing locally, where the validation was passing a large
`--max-old-space-size` and hiding it. An inherited default means the ceiling
silently differs between a dev machine and CI, so the first symptom is a red
CI on an unrelated PR.

**How to apply:** when the check OOMs again, do not bisect for a culprit.
Memory tracks codebase size almost linearly — roughly +0.6 GB per 1,000 files
over the year to Aug 2026, with no single change responsible — so crossing a
ceiling is a scheduled event. Confirm the trend across commits a few months
apart with `tsc --extendedDiagnostics`, then raise the pin deliberately.

**Levers already measured, so they need not be re-measured:**

- *Splitting the program* is worth roughly 15% off the peak. The client half
  is the larger one.
- *Cutting the client off from drizzle inference* — rejected. Replacing the
  drizzle/drizzle-zod schema module (imported by most client files) with an
  `any` stub removes ~35% of types and instantiations but only ~7% of heap.
  Type count is a bad proxy for heap here: the memory is in parsing and
  binding thousands of files and hundreds of thousands of lines of `.d.ts`.
- `skipLibCheck` and a narrow `types` list are already in place; neither is
  available as a further win.

**Gotcha when measuring:** `npx <tool>` spawns a child, so polling the npx
pid's `VmHWM` reports a few MB. Poll the real binary
(`node … node_modules/<tool>`) instead, and size the pin off tsc's reported
"Memory used" rather than RSS.
