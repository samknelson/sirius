---
name: Putting a vendor on a shared framework from outside its own module
description: When a registrar wraps a plugin's handlers instead of the plugin calling the framework itself — why the lexical maintenance-guard lint goes blind, and what to check instead.
---

A vendor whose operations are *declared* by a plugin and *wrapped* by the
registrar is on the shared web client framework without ever naming it. Two
things follow, and both are easy to get wrong.

## Take the runnable half off the declaration entirely

A plugin declares what a vendor CAN do; the function that does it is stripped
out at registration into a module-private map, reachable only through one
accessor the framework calls. The registered object has no `run` on it at all.

**Why:** wrapping each handler at registration (registering a clone whose
handlers already call the framework) gets the guarantee right but leaves a raw
handler in existence — one export, one `operations[...].run` read, and the
refusal, the count and the write gate are all missing with nothing to notice
it. Removing the function from the reachable object makes the bypass
unwritable rather than merely discouraged, and it collapses "wrapped" and
"unwrapped" into one thing.

**How to apply:** pair it with a lint rule restricting imports of the accessor
to the single framework file that dispatches, or the private map is private in
name only. The raw plugin literal still must not be exported — the strip
happens at registration, so the literal in the file still carries its handlers.

## The lexical lint cannot see it, so check the inverse property

`check-maintenance-guards` rule 1 wants the framework call to sit lexically
under the outbound call, and it follows delegation **only within one file**.
When the framework call lives in the registrar, adding the vendor to
`OUTBOUND_CALLS` reports every handler and buys one exemption per handler, each
saying "yes it is". That is a rule that has been argued into silence.

What is worth checking instead is that the vendor is reachable **only** from
the wrapped handlers — and that must be computed BACKWARDS:

- Seed with every function containing a value-position mention of the vendor,
  attributed to the whole enclosing function stack (an inline arrow is not
  called by any name a walk can follow).
- Propagate upward to fixpoint: calling something vendor-reaching makes you
  vendor-reaching.
- Report anything vendor-reaching that is not reachable from a handler.

**Why:** forward reachability from the handlers answers the wrong question. It
proves a helper *can* be reached from a handler, not that it can *only* be —
a helper shared between a handler and a metadata hook like `validateConfig`
looks fine read forwards while the second caller reaches the vendor unwrapped.

**How to apply:** also check the spellings that reach the vendor without naming
it — module-scope mentions and module-scope calls into the vendor-reaching set
(an empty function stack has nothing to propagate to), and every way the raw
plugin can leave the file (`export const`, `export { x }`, `export default x`).
A re-export mentions no vendor identifier at all, so reachability analysis can
never see it; it needs its own check.
