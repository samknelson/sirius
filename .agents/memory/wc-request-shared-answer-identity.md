---
name: One cached answer, many askers
description: When several call sites share one wc request entry — what belongs in the key, what must be stripped from the stored answer, and how a free service ends up in the vendor guard's list.
---

## A shared entry means the answer must be about the question only

Two unrelated call sites can ask a vendor the same question with different
credentials and for different reasons. They should share one stored answer —
that is the whole saving — which forces three rules:

- **The credential is not part of the key.** An API key decides who is billed,
  not what the answer is. Keying on it buys the same answer once per caller.
- **Every restriction that changes the answer IS part of the key.** A
  component or region restriction narrows what the vendor returns; leaving it
  out hands a restricted caller the unrestricted answer.
- **Anything caller-specific must not be stored, and must be re-applied on
  read.** A vendor often echoes the caller's own input back inside its answer
  (a recipient name on an address verification, say). Stored, that rides along
  to the next caller — who may put it on an envelope. Strip it before storing
  AND overwrite it on every read, because rows carried over from before the
  cache existed still carry it.

**Why:** the address/geocode work found all three: two geocode call sites with
different keys, a `components` restriction that would silently be ignored, and
Lob echoing `recipient` into an answer keyed by address alone and shared by
everyone living there.

**How to apply:** whenever a wc entry has more than one caller, ask what in the
stored blob came from the caller rather than the vendor.

## Freshness for an answer that never changes

An address's coordinates do not change, so "never expires" is the honest
window — and it is the wrong setting. The sweep only reclaims entries past
their window, so an unbounded window is an unbounded table: every address
anyone ever looked up, kept forever. A long-but-finite window (a year) keeps
essentially every repeat free and lets quiet rows go.

**How to apply:** treat "does the answer change?" and "should the row be
reclaimable?" as two questions. The second one is why there is no infinite
window.

## Free services still belong to the vendor guard

`WcService = ExternalService` is deliberate. The framework refuses every call
it is about to make through the one shared maintenance guard, so a service the
framework can name must be a service the guard knows — even a free one with no
side effect (the US Census district lookup). Adding it to the guard's union and
to the lint's guarded-module list is cheaper than the alternative, which is two
lists that drift.

**How to apply:** registering a wc entry for a new service means adding it to
`ExternalService`, giving its fetch function a literal guard statement, and
listing its module (and a URL marker) in the maintenance-guard lint.

## Where the guard goes once a call is wrapped

Move the pre-call guard OUT of the caller and into the fetch callback. The
framework reads the cache first and only refuses a call it is actually about to
make, so a stored answer keeps serving during maintenance. Then check every
`catch` between the caller and the framework: one that wraps all errors into a
domain message ("X validation failed") flattens the refusal into a verdict.
Rethrow on `isMaintenanceModeError` before wrapping.
