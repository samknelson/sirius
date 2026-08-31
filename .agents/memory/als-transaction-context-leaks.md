---
name: Two ways the ambient transaction context lies
description: Deferred callbacks inherit the caller's transaction, and a helper that hands out a client without binding the ALS lets ambient code escape it.
---

The ambient transaction lives in an `AsyncLocalStorage`, and `getClient()`
returns it or falls back to the pool. Two failure modes follow from that, both
silent.

## Deferred work inherits a transaction it must not use

An async context propagates into `setImmediate`, `setTimeout`, and promise
continuations. Anything queued from inside a request therefore reaches for the
caller's transaction client — one that has usually already committed by the
time the callback runs, and may have been read-only.

**How to apply:** deferred work must step out of the context explicitly before
it touches the database. Fire-and-forget queues, background refreshes, and
after-response side effects all need this; do not assume scheduling implies a
fresh connection.

## Handing out a client is not the same as binding it

A helper that opens a transaction, applies a transaction-level setting, and
passes the client to a callback only covers code that *takes the client as an
argument*. Anything the callback reaches indirectly calls `getClient()`, gets
the pool, and escapes the setting entirely.

**Why:** the read-only query helper did exactly this. Its `SET TRANSACTION READ
ONLY` applied to the searchers that used the passed client and to nothing else,
so any gate asking "is this connection writable" saw a writable pool inside
what was supposed to be a read-only context.

**How to apply:** a helper that owns a transaction must bind it as the ambient
client for the duration of the callback, not just pass it down.
