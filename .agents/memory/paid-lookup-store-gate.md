---
name: Paid external lookups must be storable before they are made
description: The gating pattern for a billable external call that is cached, and why "the provider answered" cannot be detected by absence of a throw.
---

## The rule

Never make a billable external call unless the result can be stored.

An unstored lookup is money spent to learn something that is immediately
forgotten and will be spent again on the very next call. This matters most for
a function that is *also* the app's normalization entry point — everything
calls it, most callers do not care about the expensive answer, and the cost is
invisible until the provider's invoice arrives.

**Why:** the phone validator is the only route to E.164 in the app, so opt-in
reads, `WHERE`-clause building, list views and imports all went through it and
each one billed a Twilio Lookup.

## How to apply

**Ask the connection, not a flag.** Gate on
`SELECT current_setting('transaction_read_only')` issued on the connection the
write would use. A tracked boolean drifts; the setting picks up every
mechanism that can make a connection read-only — an explicit
`SET TRANSACTION READ ONLY`, maintenance mode arming
`default_transaction_read_only` per pool checkout, and anything added later —
without naming any of them. Fail closed when it cannot be determined.

**Write on the caller's own connection.** A dedicated side connection would
always be writable, which turns the gate into theatre. The consequence is
accepted deliberately: a caller that rolls back discards the cached answer and
pays for one repeat lookup.

**A deferred refresh is a separate operation, not a laundering route.** Work
queued out of band runs on its own connection and faces the gate on its own
merits. It must never be the way a read-only caller performs the write it was
just refused — such callers ask for the fully-local mode and queue nothing.

**Residual race:** the gate and the write are separate round trips, so a
connection that turns read-only *during* the external call loses one paid
answer. Handle it by backing the key off on write failure, so the next call
does not immediately pay again for as long as the condition lasts.

## A provider that swallows its own errors

A transport wrapper that catches its own failures and returns a
locally-derived "valid" answer is indistinguishable from a real answer by
control flow — nothing throws. Caching it stamps the record as freshly
validated on the strength of a call that never reached the carrier, buying the
full revalidation window of silence.

**Detect the answer by payload richness, not by absence of a throw**: the real
answer carries data only the provider could know (line type, carrier). Missing
that means the call did not land, whatever the `valid` flag says.

## Mode design that avoids a cycle

Where the cache lives on a row that some *other* read normalizes through the
same function, the fully-local mode must skip the cache read as well as the
network call — otherwise the two reads wait on each other. "No network" is not
enough; it has to be "no cache read" too.

Settings that affect *normalization* (e.g. default country) must still apply in
that mode, or the local mode keys the cache on a different value than the mode
that fills it. Memoize them briefly rather than skipping them.
