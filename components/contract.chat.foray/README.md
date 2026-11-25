# Contract Chat — Foray (`contract.chat.foray`)

The Foray provider for [Contract Chat](../contract.chat/README.md). It depends
on `contract.chat`; enable that (and `contract`) first, then this component.
Installation alone does not enable it. To retire Foray, delete this directory
and rebuild; `contract.chat` and its Dummy provider keep working.

Create a `contract-chat-foray` connection under **Webclient Vendors**. It
exposes the same operations as every Contract Chat provider.

## Configuration

Set Secret Name to the name of an environment secret containing the **raw host
bearer token**, not the token itself or the `Bearer ` prefix.
The default HTTPS base URL is
`https://cba-service.foray-consulting.workers.dev`.
An optional baseUrl override is supported; a different hostname also requires
the existing `WEBCLIENT_VENDOR_ALLOWED_HOSTS` deployment override for plugin
`contract-chat-foray`. The default required allowlist is that exact hostname,
not all Cloudflare Workers.

Connection testing authenticates against `/v1/contracts` rather than the public
health check. Chat and route calls incur remote model costs and require manual
write confirmation; feedback is a remote write. Catalog, search and connection
test are free. All operations still use the standard component, destination,
maintenance, flood, usage and writable-database boundaries.

Chat submits `stream:false`, with a 180-second timeout; other calls use 30
seconds. No automatic paid retries. Supply the whole conversation, alternating
user/assistant, starting and ending with user, at most 20 messages, with nonblank
content (user ≤4,000 chars; assistant ≤20,000). Invalid history is rejected,
never silently shortened. Search/route query and feedback comment limit: 4,000;
search limit: 1–50.

Callers must authorize users/contracts and derive trusted roles and opaque
user/session references themselves. Foray trusts host role assertions. Its
provider contract IDs are distinct from Sirius contract IDs; externalRef is
only an optional explicit mapping. Show notices and non-success answer status
alongside any partial answer. `source:network` in the generic result means a
provider responded, not that an answer with `status:refusal/error` succeeded.
Do not log conversations or send browser-claimed authorization as trusted data.
Foray processes submitted questions externally and applies its own retention.

Implementation source: uploaded cba-contract-service archive, snapshot
4908ff730417df712ffad71a1008f586882561ef. No live paid service is needed for the
focused contract tests.
