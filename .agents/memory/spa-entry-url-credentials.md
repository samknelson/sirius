---
name: Credentials in SPA entry URLs
description: How to contain a bearer credential when an external link must put it in the initial SPA query string.
---

When a public link must carry a credential in the initial query string, consume it
before the application mounts: install a no-referrer policy in the initial document,
capture the values, synchronously replace browser history without the credential, and
dispatch a one-shot request before auth/bootstrap effects run. Delete the temporary
handoff immediately and expose only the non-sensitive result promise to page code.

**Why:** removing the query value in a page `useEffect` is too late. Lazy chunks,
authentication checks, bootstrap requests, fonts, and other same-origin resources may
already have received the full URL as a referrer. Keeping the credential in React state,
a query key, or a query-function closure also extends its lifetime and exposes it to
developer tooling and caches.

**How to apply:** protect both the initial HTML response and document with
`Referrer-Policy: no-referrer`; remove the credential before application startup; send
it in a POST body rather than another URL; clear temporary client references after
dispatch; redact sensitive query keys in every server error-log path; and keep API
responses and logged errors free of the submitted value.