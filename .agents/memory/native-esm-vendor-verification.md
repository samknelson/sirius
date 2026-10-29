---
name: Native ESM vendor verification
description: Development/test interop can hide external CommonJS export shapes used by the production ESM bundle.
---

Verify vendor adapter interoperability under native Node ESM with external
dependencies, not only the development or test loader.

**Why:** a Twilio response-class import was callable in tests but became an
object containing the constructor under native ESM. It passed development
checks and then failed deployed connection tests. Read-only native imports
reproduced the discrepancy with the installed dependency.

**How to apply:** exercise production-format adapter output with fake HTTP
responses and the actual installed SDK. Prefer type-only response dependencies
where the SDK accepts a structural response. Never invoke a billable vendor
request just to check module interoperability.
