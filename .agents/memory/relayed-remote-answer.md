---
name: Relaying a remote system's answer to an admin screen
description: Two rules for any "test the connection" / external-client surface — redact the credential out of what the remote says, and never read HTTP 200 as success.
---

# Relaying a remote system's answer

A diagnostics surface that shows an administrator what an external service
replied is a relay, and a relay has two failure modes that both look fine on
screen.

## 1. Masking our own request is not enough

Masking the Authorization header we *send* protects nothing if the reply is
passed through verbatim. A service, or a proxy in front of it, can reflect the
credential in a body, a response header, or an error string, and it lands on
the page and in any screenshot of it.

**Rule:** the whole result leaves through ONE redaction pass that strips every
form of the secret (the raw value and the base64 Basic value it is half of)
from strings, arrays, object values *and keys*. Route-level catch blocks send
error text through the same pass, since that text is written by code we do not
control end to end.

**Why:** a code review caught exactly this on the Freeman EDLS migration ping —
own-request masking was in place, relayed content was not. Redaction must not
swallow the message itself: the remote's own words are the useful part.

**How to apply:** any new external client with a diagnostics panel. Test it by
stubbing a reply that reflects the credential in JSON, in non-JSON text, in a
header, and in a thrown transport error, then assert the *serialized* result
contains neither form.

## 2. HTTP 200 is not the remote saying yes

Envelope-style services (Drupal `sirius_service` here) answer 200 with a body
carrying their own `success` flag, and answer refusals as a bare JSON array of
message strings with a 4xx. Reading `response.ok` reports "connected" for calls
the remote rejected.

**Rule:** success is the envelope's own flag. A 200 whose body cannot be parsed
or carries no flag is a failure ("unrecognized"), never an assumed success.
Distinguish the outcomes — not configured / network / HTTP / remote-reported
failure / unrecognized — because they are different problems with different
fixes, and carry the remote's message text through unchanged.

**How to apply:** a ping that echoes its arguments back also proves the payload
transited, not merely that the host answered — send a random token and look
for it.
