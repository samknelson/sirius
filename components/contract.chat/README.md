# Contract Chat (`contract.chat`)

This optional component adds the provider-neutral Contract Chat operations and
the Dummy provider, not a chat page. Real providers are separate components
that depend on this one (for example `components/contract.chat.foray`). Enable
the `contract` dependency first. Installation alone does not enable it.

Use **Webclient Vendors** in the existing plugin configuration editor to create
a `contract-chat-dummy` connection (or a provider component's connection). Every
provider exposes:

- `contract.chat.catalog` — list provider contracts
- `contract.chat.ask` — answer using a caller-supplied conversation
- `contract.chat.search` — search published pages
- `contract.chat.route` — suggest a provider contract, or ask/none
- `contract.chat.feedback` — rate a previous request
- `service.test-connection` — free connection test

Existing operation assignments support automatic selection; explicit config
selection also works. Nothing is cached, and no adapter stores transcripts.
Call through `wcRequest`, never a plugin handler. Types are in `shared/types.ts`.

## Dummy

No secret or network. Use `synthetic-contract` from its catalog as contractId,
role `member`, and messages `[{"role":"user","content":"What are the breaks?"}]`.
All data is synthetic, including an expired-contract warning and citation.
Configure `scenario` as normal (default), refusal, truncated, budget_exceeded,
rate_limited, or service_error. Routing questions exactly `ask` and `none`
exercise those outcomes. Feedback returns `persisted:false`.

## Settings

Administrators can open **Configuration → Contract Chat → Settings** at
`/config/contract-chat` when `contract.chat` is enabled. First create a connection
in **Plugins → Webclient Vendors** (`/admin/plugin-configs/wc-vendors`).
The selector offers enabled, component-available saved configurations declaring
all five Contract Chat operations, independently of automatic operation assignments.

The component-owned contract is in `shared/settings.ts`. The core by-name
variable endpoints persist `contract_chat_settings` as a JSON object:
`{ "providerConfigId": "<saved configuration ID>" }`, or
`{ "providerConfigId": null }` for an explicit no-provider choice. A missing
variable also means no provider. This is a configuration ID, not a vendor plugin
ID. Default core variable access remains administrator-only for both reads and
writes; there is no new route, permission, or migration.

Unavailable saved IDs stay visible until explicitly replaced or cleared.
Malformed settings require an explicit replacement; failed reads cannot be
saved over. This page only records a choice for future consumers: it does not
resolve a runtime provider, change operation assignments, test a connection,
or send provider requests. No implicit default is selected.
