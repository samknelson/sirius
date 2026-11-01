---
name: Okta app-launch URLs
description: Avoid blaming the /home URL shape without comparing the actual SAML return flow.
---

Do not treat an Okta `/home/...` app-launch destination alone as proof that
SAML_ENTRY_POINT is wrong or must be replaced.

**Why:** On 2026-10-27 the user identified UAT as working. Public inspection of
its generated SAML request showed the same app-launch destination pattern as
production, contradicting the initial suspicion that this pattern explained
production's missing callback.

**How to apply:** Compare generated AuthnRequest fields and advertised metadata
with a known-working deployment, then establish where the browser actually
returns. A separately discoverable IdP metadata endpoint may describe another
Okta integration; never recommend copying its endpoint or issuer blindly.
