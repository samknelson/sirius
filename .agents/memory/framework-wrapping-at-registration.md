---
name: Putting a vendor on a shared framework from outside its own module
description: When a registrar wraps a plugin's handlers instead of the plugin calling the framework itself — why the lexical maintenance-guard lint goes blind, and what to check instead.
---

A vendor whose operations are *declared* by a plugin and *wrapped* by the
registrar is on the shared web client framework without ever naming it. Two
things follow, and both are easy to get wrong.

## Wrap at registration, not at the caller

Register a COPY of the plugin whose handlers are already wrapped, and keep the
raw literal local to its file (`PluginRegistry.register` stores the object as
passed and does not freeze it, so a wrapped clone is all it takes).

**Why:** a dispatcher that callers are *supposed* to use is a convention, and
the maintenance refusal is a promise about the whole process — one caller
reaching into `operations[...].run` quietly makes it false. Wrapping at
registration means the guarantee holds however the handler is reached, so the
dispatcher is left owning only what it genuinely owns: the resolved credential
and the answer for an operation the plugin does not declare.

**How to apply:** any plugin kind where the framework is applied centrally
rather than inside each plugin. Watch the export surface — a raw literal that
escapes the file is the same plugin with the refusal missing.

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
