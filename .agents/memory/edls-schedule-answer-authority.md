---
name: EDLS schedule answer authority
description: The deliberate authority model for workers accepting or declining EDLS assignments from their schedule link.
---

# EDLS schedule answer authority

An enabled worker Access Token (AAT) bearer link intentionally authorizes the
holder to record the linked worker's final accept or decline response for
assignments the public schedule currently shows. It is the same authority the
worker receives by text, not an authenticated session or a second credential.
The token remains usable until an authorized person manually rotates it.

**Why:** coordinators need a worker's answer from the schedule link itself.
The project owner explicitly accepted this bearer-link trade-off, including
that AATs are not a high-security login credential and may appear in logs.

**How to apply:** require the current AAT token for every irreversible public
schedule answer, scope the answer to the token's worker and the current visible
schedule window, and retain the conditional one-answer storage write. Migration
fallback links that predate AAT may still be read for their sunset period, but
must never authorize an answer.