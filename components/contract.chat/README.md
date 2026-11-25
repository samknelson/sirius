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
