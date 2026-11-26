# Webclient vendor destination policies

Vendor declarations can supply `endpointPolicy.requiresAllowlist` and
`endpointPolicy.defaultAllowedHosts`. The same metadata is published in the
vendor manifest. The webclient framework enforces destinations on actual HTTP
requests, not merely when configuration is saved or a connection is tested.

## Defaults and deployment overrides

These vendors require allowlists by default:

| Stable plugin ID | Default allowed hosts |
| --- | --- |
| `sitespecific-example-authorization` | `["*.example.com"]` |
| `sitespecific-example-import` | `["*.example.com"]` |
| `sitespecific-t631` | `["*.teamsters631.com"]` |

Set **WEBCLIENT_VENDOR_ALLOWED_HOSTS** to a JSON object to replace selected
vendors' defaults or constrain any other vendor. Example raw value:

```json
{
  "sitespecific-example-authorization": {
    "allowedHosts": ["*.example.com"],
    "allowPrivateAddresses": true
  },
  "sitespecific-example-import": {
    "allowedHosts": ["legacy.example.com"]
  },
  "sitespecific-t631": {
    "allowedHosts": ["*.teamsters631.com"]
  },
  "lob": { "allowedHosts": [] }
}
```

The hostnames above illustrate the format, not discovered production endpoints.
Use the actual service hostnames for your deployment.

- Missing map entry: use that plugin's defaults.
- Present object: `allowedHosts` is required and **replaces**, never merges with,
  its defaults. `allowPrivateAddresses` is optional and defaults to `false`.
- Empty `allowedHosts` array: no external destinations permitted for that vendor,
  even with private access enabled.
- Only these two object fields are accepted. Legacy array-valued entries are
  rejected, not converted. This is an intentional breaking format change:
  operators must update their existing deployment values manually.
- Required allowlist without defaults or an override: refuse external calls.
- Optional plugin without defaults or an override: no hostname restriction.
  The guarded HTTP path still enforces the baseline network checks below.
- Malformed JSON, malformed entries, invalid patterns, or unknown plugin IDs:
  fail closed on vendor invocation with a configuration error. Component-disabled
  but registered plugins are valid keys. No bad entry is silently ignored.

Patterns are exact hostnames or a single leading `*.`:

- `example.com` permits **only** that hostname.
- `*.example.com` permits `auth.example.com` and `a.b.example.com`, but not
  `example.com`, `evilexample.com`, or `example.com.attacker.example`.
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
It shows the effective public-only or public/private network permission from
the same resolver used by enforcement; invalid policies have no effective mode.
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
permitted by the effective policy; validation and address selection happen in the same handoff, so a
second, unvalidated resolution cannot connect elsewhere. TLS certificate
verification and hostname/SNI handling remain enabled. Public-only is the default.
With explicit `allowPrivateAddresses: true`, ordinary RFC1918 IPv4
(10/8, 172.16/12, 192.168/16) and IPv6 unique-local (fc00::/7) are permitted.
Every DNS answer must pass; mixed public/private sets pass only under that opt-in.
Loopback, unspecified, link-local, multicast, reserved/special-use and IPv4-mapped
IPv6 remain forbidden, as do metadata/infrastructure endpoints (including
169.254.169.254, 100.100.100.200, fd00:ec2::254, fd20:ce::254 and 168.63.129.16).
Literal IP URLs undergo the same address check as DNS answers.
The opt-in is per plugin, never per connection or global, and never relaxes host
matching. It trusts the allowed hostnames to identify internal services; a
compromised hostname/DNS entry can reach other ordinary private services.
Requests have a maximum 30-second timeout and a 32 MiB response-body limit.

Guarded vendors: Example authorization, Example import, Teamsters631,
Google geocoding, Census geocoding, OpenStates, Lob, SendGrid, Stripe, and Twilio.
Stripe uses its SDK's custom fetch transport; Twilio uses a webclient HTTP
adapter; SendGrid uses the same mail API through the guarded capability.

**BTU card-check browser scraping is not adapted to guarded browser egress.**
When an allowlist is active for `sitespecific-btu-cardcheck` (including an object with `allowedHosts: []`),
webclient refuses the operation before launching or invoking the browser.
It does not pretend that checking the initial page also secures page redirects,
scripts, subresources, and attachment requests. Without a policy it retains
existing browser behavior; the guarded HTTP baseline does not claim to cover
that independent browser transport. Future unadapted SDK/browser plugins follow
the same fail-closed rule when they have an active policy.

Policy refusal is a local error, never a successful vendor answer or cache
failure hold. A legacy plugin catching a request error cannot turn that refusal
into a successful cached result. Public Example bearer authentication stays
closed and returns a generic configuration-unavailable message rather than
falling back to another authentication method.

## Rollout and scope

Review existing endpoints before rollout: HTTP, private/internal addresses,
nonstandard ports, redirects, and hosts outside the manifest defaults will now
be refused on guarded paths. Use the final HTTPS endpoint instead of a redirect.
The private-address flag exempts only ordinary private addresses, not the other
baseline checks. It does not make an unsupported SDK/browser transport supported.
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

The affected deployment reported private answers for `dev.api.example.com`.
The wildcard `*.example.com` already matches this nested subdomain; the refusal
was the public-only address check, not hostname matching. If the deployment
intends that internal destination, use the explicit private opt-in shown above.
A workspace lookup is not production evidence.

Run this DNS-only diagnostic **inside the affected running application
container/process environment** (same network and resolver, not this workspace
or a local laptop). It makes no API request and needs no vendor credentials:

```sh
node --input-type=module <<'JS'
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
const host = "dev.api.example.com";
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
- A mixed public/private set remains refused without explicit private opt-in,
  even if the first answer is public.
- If production intentionally uses private addresses, explicitly authorize them
  for that plugin using an object with matching `allowedHosts` and
  `allowPrivateAddresses: true`. Adding only a hostname does not authorize it.
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
