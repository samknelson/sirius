---
name: Redacting a credential out of a vendor's reply
description: A vendor integration that reports diagnostics must scrub the credential from what the REMOTE system says, not just from what we send; the non-obvious leak paths and why fragment masking is not redaction.
---

Any vendor integration that hands back request/response diagnostics — a test-connection
page, an admin "run this call" screen, an error a cron job logs — has to treat the
credential as something that can come *back*, not only something that goes out.

**Why:** scrubbing our own request is the easy half and the half everyone does. The
credential arrives from the other direction too, and each of these was a real hole found
in review rather than in testing:

- **The remote echoes the request.** Some services answer a rejected or malformed
  request by quoting it. The credential then sits in the response body, in the parsed
  object, and in whatever the admin page renders.
- **Response headers and the status line.** A debugging proxy in front of the vendor can
  mirror `Authorization` back, or put detail in the HTTP reason phrase. The reason phrase
  is the worst of these because it usually gets concatenated into the short `error`
  string, which is the one value that travels everywhere — screen, thrown message, log.
- **JSON escaping defeats a literal scrub of the raw text.** A token containing a quote
  or a backslash is spelt one way in the response text and another in the value, so a
  string replacement over the body misses it and `JSON.parse` then reassembles the real
  thing. Scrub the text *and* recurse the parsed structure (values, array elements, and
  keys).
- **Overlapping secrets.** If one secret is a prefix of another and you replace the short
  one first, the long one's tail survives. Sort candidates longest-first.
- **Transport errors** quote the request they failed on.
- **Expected secret slots are not the whole request.** A public argument, URL, header,
  or diagnostic label can equal or contain the submitted token. Replacing only the
  known token field still leaks it through those collisions; scrub the complete request
  diagnostics structure too.

**Fragment masking is a leak, not a mitigation.** A "first four and last four" rendering
is still credential bytes in a log line, and those two ends are exactly what someone
holding the middle needs. It tells an operator nothing that the word "(redacted)" does
not. Identifiers that merely *look* secret — an account id, an employer id — are
different: if they are editable settings shown in the admin page, masking them in the
diagnostics only makes the diagnostics harder to read.

**Literal redaction sets a floor on credential length.** Redaction works by finding the
value in the reply, so a two-character "token" matches half the reply and shreds it. The
choice is between mangled diagnostics and an unredacted credential — so reject an
implausibly short credential at validation time instead, and say so.

**How to apply:** build one scrubber object from the full secret list (including derived
spellings like the base64 Basic header, which is the token merely re-spelt), and route
every outbound string through it: response headers (keys *and* values), status text, raw
body, parsed body, transport error message, and any short `error` summary — building the
summary from the already-scrubbed diagnostics rather than reaching back to the raw
response. Route the complete request diagnostics object through the same recursive
scrubber, even when its sensitive slots were already replaced explicitly. Test against
*fragments* of a canary, not just the whole string; a test that
only looks for the complete value passes a masked leak.
