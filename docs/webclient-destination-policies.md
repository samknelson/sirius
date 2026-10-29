# Webclient vendor destination policies

Vendor declarations can supply `endpointPolicy.requiresAllowlist` and
`endpointPolicy.defaultAllowedHosts`. The same metadata is published in the
vendor manifest. The webclient framework enforces destinations on actual HTTP
requests, not merely when configuration is saved or a connection is tested.

## Defaults and deployment overrides

These vendors require allowlists by default:

| Stable plugin ID | Default allowed hosts |
| --- | --- |
| `sitespecific-freeman-authorization` | `["*.freeman.com"]` |
| `sitespecific-freeman-edls-migrate` | `["*.freeman.com"]` |
| `sitespecific-t631` | `["*.teamsters631.com"]` |

Set **WEBCLIENT_VENDOR_ALLOWED_HOSTS** to a JSON object to replace selected
vendors' defaults or constrain any other vendor. Example raw value:

```json
{"sitespecific-freeman-authorization":["auth.freeman.com"],"sitespecific-freeman-edls-migrate":["legacy.freeman.com"],"sitespecific-t631":["*.teamsters631.com"],"sendgrid":["api.sendgrid.com"],"stripe":["api.stripe.com"],"twilio":["api.twilio.com","lookups.twilio.com"],"lob":[]}
```

The hostnames above illustrate the format, not discovered production endpoints.
Use the actual service hostnames for your deployment.

- Missing map entry: use that plugin's defaults.
- Present array: **replace**, never merge with, its defaults.
- Empty array: no external destinations permitted for that vendor.
- Required allowlist without defaults or an override: refuse external calls.
- Optional plugin without defaults or an override: no hostname restriction.
  The guarded HTTP path still enforces the baseline network checks below.
- Malformed JSON, malformed entries, invalid patterns, or unknown plugin IDs:
  fail closed on vendor invocation with a configuration error. Component-disabled
  but registered plugins are valid keys. No bad entry is silently ignored.

Patterns are exact hostnames or a single leading `*.`:

- `freeman.com` permits **only** that hostname.
- `*.freeman.com` permits `auth.freeman.com` and `a.b.freeman.com`, but not
  `freeman.com`, `evilfreeman.com`, or `freeman.com.attacker.example`.
- List both patterns if the bare domain and subdomains are needed.
- Hostnames are case-insensitive, normalized to ASCII and tolerate a trailing
  DNS dot. Do not supply URLs, paths, ports, userinfo, arbitrary globs, or regexes.

Exact service hosts are safer than a whole company's subdomain tree. A permitted
host is trusted to receive the operation's credentials and data.

## Configuration lock and timing

Administrators can inspect **Destination policy** in the Webclient Vendors
configuration editor and each configuration's plugin information popover.
This read-only view shows the stable plugin ID, normalized effective patterns,
whether a map entry replaces defaults (including deny-all), and whether the
whole map is locked by the deployment or supplied by an in-app override.
It also distinguishes guarded HTTP, unsupported active-policy SDK/browser
transports, unguarded SDK/browser transports, and local-only vendors.
An invalid policy is shown as a refusal, not as unrestricted access.
The view uses the invocation resolver, does not resolve vendor credentials,
and applies to every connection of that plugin, including disabled configurations.
It is a snapshot of the answering process, not a connection test or proof of
simultaneous policy adoption across processes.

Use the existing environment registry. An actual nonempty deployment value wins
over in-app overrides and locks the **whole map**. Set `{}` in the deployment
environment to lock the manifest defaults without additional restrictions.
Empty-string and `__UNSET__` release the deployment value under normal registry
semantics; neither locks it. A policy stored only as an in-app override is not a
boundary against an administrator who can also edit that override.

The effective policy is reread for each vendor invocation and each guarded
HTTP request; no reload or provider recreation is needed after the normal
environment-override cache observes an edit. This is local observation, not a
promise of simultaneous changes across processes. Updating an environment value
in a container deployment still requires replacing/restarting its processes.
An already-running request is not retroactively cancelled.

## Network enforcement and transport coverage

The guarded capability accepts HTTPS on port 443 only, rejects URL userinfo and
custom Host headers, refuses redirects without following their Location, and
checks the HTTPS socket's own DNS resolution. Every returned address must be
public; validation and address selection happen in the same handoff, so a
second, unvalidated resolution cannot connect elsewhere. TLS certificate
verification and hostname/SNI handling remain enabled. Non-public IP literals,
including alternate numeric IPv4 spellings and mapped IPv6, are also refused.
Requests have a maximum 30-second timeout and a 32 MiB response-body limit.

Guarded vendors: Freeman authorization, Freeman EDLS migration, Teamsters631,
Google geocoding, Census geocoding, OpenStates, Lob, SendGrid, Stripe, and Twilio.
Stripe uses its SDK's custom fetch transport; Twilio uses a webclient HTTP
adapter; SendGrid uses the same mail API through the guarded capability.

**BTU card-check browser scraping is not adapted to guarded browser egress.**
When an allowlist is active for `sitespecific-btu-cardcheck` (including `[]`),
webclient refuses the operation before launching or invoking the browser.
It does not pretend that checking the initial page also secures page redirects,
scripts, subresources, and attachment requests. Without a policy it retains
existing browser behavior; the guarded HTTP baseline does not claim to cover
that independent browser transport. Future unadapted SDK/browser plugins follow
the same fail-closed rule when they have an active policy.

Policy refusal is a local error, never a successful vendor answer or cache
failure hold. A legacy plugin catching a request error cannot turn that refusal
into a successful cached result. Public Freeman bearer authentication stays
closed and returns a generic configuration-unavailable message rather than
falling back to another authentication method.

## Rollout and scope

Review existing endpoints before rollout: HTTP, private/internal addresses,
nonstandard ports, redirects, and hosts outside the manifest defaults will now
be refused on guarded paths. Use the final HTTPS endpoint instead of a redirect.
An allowlist cannot exempt a destination from baseline network checks.
No existing vendor configuration, deployment setting, or database record is
automatically rewritten.

This is not an OS/network firewall or a guarantee that every host in a permitted
domain is trustworthy. It does not alter unrelated outbound clients. Keep
credentials out of URLs and preserve existing response redaction. Vendor
responses remain available under their established contracts only after the
destination has passed the checks.

## Diagnosing DNS refusals in the affected deployment

The socket resolver refuses the **entire** answer set if any answer is
prohibited. Its error now includes rejected IPs and classification reasons
(at most eight, with rejected/total counts and an omission count). An empty
answer set is reported separately. A resolver failure says `DNS resolution
failed`, with a recognized DNS error code where available; native error text
is never relayed. No URL paths, query strings, credentials or response bodies
are included. This uses the socket's actual lookup, not a preflight lookup.

For the reported `dev.api.freeman.com` refusal, the affected deployment's DNS
answers have **not** been observed. Replit's deployment metadata reports no
deployment accessible for this project; that does not establish the status of
an externally hosted deployment. A workspace lookup is not production evidence.
The code does not establish whether production returned a mixed answer set,
an intentional private endpoint, or whether the deployed image contains an
older address-classification bug.

Run this DNS-only diagnostic **inside the affected running application
container/process environment** (same network and resolver, not this workspace
or a local laptop). It makes no API request and needs no vendor credentials:

```sh
node --input-type=module <<'JS'
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
const host = "dev.api.freeman.com";
const timeout = setTimeout(() => {
  console.log(JSON.stringify({ host, error: "DNS lookup timed out" }));
  process.exit(1);
}, 10000);
try {
  const answers = await lookup(host, { all: true, verbatim: true });
  console.log(JSON.stringify({
    observedAt: new Date().toISOString(), host, total: answers.length,
    answers: answers.slice(0, 32).map(({ address, family }) => ({
      address: isIP(address) ? address.split("%", 1)[0].slice(0, 64) : "[invalid address]",
      family: family === 4 || family === 6 ? family : "invalid",
    })),
    omitted: Math.max(0, answers.length - 32),
  }));
} catch (error) {
  const safeCodes = ["ENOTFOUND", "ENODATA", "EAI_AGAIN", "EAI_FAIL", "ETIMEOUT", "ESERVFAIL", "ECONNREFUSED"];
  console.log(JSON.stringify({
    host, error: "DNS resolution failed",
    code: safeCodes.includes(error?.code) ? error.code : "unclassified",
  }));
  process.exitCode = 1;
} finally { clearTimeout(timeout); }
JS
```

Return only that output and the DNS refusal's bounded details, plus which
running deployment/image was tested. Do not send credentials or complete vendor
request/response logs. DNS can change between this diagnostic and a request;
the request-time socket refusal is the authoritative evidence for that attempt.

- All-public answers should pass the address guard; this does not prove TLS,
  authorization or vendor API health.
- A mixed public/private set remains refused even if the first answer is public.
- If production intentionally uses private addresses, leave it blocked. The
  owner must separately authorize and scope a private-endpoint policy decision;
  adding a hostname allowlist entry does not authorize private network access.
- Do not hardcode an observed IP, disable the resolver guard, or infer that the
  connection is restored without a successful check in the affected deployment.

## Offline production-format Twilio regression

Run `npx vitest run tests/webclient/twilio-native-esm.test.ts` to compile just
the regression and adapter under `/tmp` using `--packages=external` and native
Node ESM. It exercises the installed SDK's account-list connection-check call,
message response mapping, SDK errors, headers and diagnostic response contract.
HTTP responses are fake and real sockets are forbidden. This catches the
response-module default-import constructor failure that development loaders
mask. It does not send SMS or use real credentials. Do **not** use the package
build command for this check: that command includes database push.
