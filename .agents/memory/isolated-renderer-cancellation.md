---
name: Isolated renderer cancellation
description: Why untrusted synchronous conversion needs an interruptible engine and an awaited worker exit.
---

An elapsed timeout is not proof that untrusted conversion has stopped consuming CPU or memory. Native synchronous work can prevent worker termination from completing; choose an interruptible execution engine or a killable process and prove actual exit.

**Why:** Postal rendering has separate queue lanes. Releasing either lane while timed-out conversion keeps running defeats the concurrency and resource protections. WebAssembly execution in a V8 worker can be interrupted; a promise race on the server thread cannot stop a synchronous converter.

**How to apply:** Keep conversion in a bounded isolate, terminate and await exit on success and failure, and include a test with genuinely busy synchronous execution. Explicitly clear inherited worker CLI arguments: standalone Node commands with `--input-type=module` otherwise change eval-worker interpretation even when the same bundle works under the normal web entrypoint.
