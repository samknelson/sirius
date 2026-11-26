---
name: Browser verification transport
description: Reliable browser transport and isolation of verification identities.
---

Prefer Puppeteer's pipe transport when browser launch stalls while discovering
a debugging endpoint. Resolve an available browser from PATH rather than
searching the Nix store.

**Why:** A working browser can fail endpoint discovery independently of app
readiness. Repeated binary searches and transport changes obscure that distinction.

**How to apply:** Keep browser transport failures separate from application
failures. Capture uncaught page exceptions as well as console output, and check
the actual preview proxy when development initialization or HMR matters.

Keep verification identities and authentication configuration isolated from the
shared application. Match an isolated production build's identity-provider
settings to its test server and let the browser use the matching origin normally.

**Why:** Build-time identity settings and runtime provider choices can disagree;
injected transport headers or a live identity SDK can prevent a valid fixture
from initializing without exposing an application defect.

**How to apply:** Use real synthetic-account sign-in in isolated environments,
or intercept complete identity fixtures only in the test browser. Never add a
server authentication bypass, alter saved workspace settings, or require a live
identity-provider account just to verify a component.

Production-format browser fixtures need a matching HTTPS origin, not only an
HTTP test server. Use an isolated TLS proxy and ordinary browser sign-in.

**Why:** Canonical HTTPS origins, browser-origin checks and Secure session
cookies can each refuse an otherwise valid synthetic login. Command-line
clients must preserve every Set-Cookie value, not just the first device cookie.

**How to apply:** Keep synthetic accounts and TLS keys disposable, set the
fixture's own public origin, and assert session restoration before feature
checks. Wait for rendered content rather than global network-idle when optional
external resources can stall.

Mount a page inside its actual route when using a disposable component harness.

**Why:** A page that normalizes its query string can redirect back to itself
after a link is activated if the harness keeps it mounted at the destination.
This falsely makes a working application link look broken.

**How to apply:** Let the router unmount the page on navigation before checking
the destination. Keep fixture responses and harness code out of application source.
