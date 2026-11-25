# Contract Chat (`contract.chat`)

This removable, provider-neutral component lets authorized users select a
provider-published contract and ask questions with returned clause citations.
Enable its `contract` dependency first. Installation alone does not enable it.
Foray is a separate optional adapter in `components/contract.chat.foray`.

## Access and setup

1. Enable `contract.chat` (and the chosen real provider component, if applicable).
2. In **Plugins → Webclient Vendors** (`/admin/plugin-configs/wc-vendors`), create
   and enable a Contract Chat configuration.
3. As an administrator, explicitly save that configuration at
   `/config/contract-chat`. A missing or cleared choice means **no provider**.
   Deleted, disabled, malformed, unsupported or component-unavailable selections
   are refused; automatic operation assignments never replace this choice.
4. Assign the component's `contract.chat` permission using existing role
   administration. Enabling the component registers the permission but grants
   it to no ordinary user.
5. Open `/contract-chat` directly. There is deliberately no new chat menu item.
   Existing administrator-only settings navigation and access are unchanged.

The page and all `/api/contract-chat/*` endpoints require authentication, an
enabled component, and the `contract.chat` permission. This permission allows
access to **every contract in the selected provider's catalog**. Provider contract
IDs are opaque, not Sirius contract IDs; there is no per-contract Sirius filter.
The server maps effective users with the `staff` permission to provider role
`staff`, and everyone else to `member`. There is no steward mapping.

## Workflow

Select an agreement explicitly, even if the catalog has only one entry. The
page shows its status and notice before a question is sent. Answers and
citations are rendered as plain text, including document/page/article/section
references when supplied. Provider content is never trusted HTML.

Changing agreements keeps conversations separate. **New conversation** clears
the selected conversation; **Change agreement** returns to selection. Refused,
partial, timed-out and failed attempts retain useful returned content. Requests
are not automatically retried. An explicit retry or another question may incur
another provider charge, including after a timeout or interrupted request.

The provider context is bound to the saved configuration revision, effective
user, login session and trusted role. Stale contexts are refused before sending
chat. The server also verifies catalog membership and bounded alternating input.
The browser sends at most nine complete prior question/answer turns plus the new
question (19 messages). Questions are limited to 4,000 characters; prior
assistant context to 20,000 characters per message. Failed or empty replies
never produce an invalid next conversation. Displayed history is not shortened
to that context window.

## Privacy and retention

History uses validated, versioned browser **sessionStorage**, scoped to the
effective identity, login session, provider revision and contract. It survives
refresh and navigation in the same tab, not a new login. Auth identity changes
and logout clear feature history; a server context check occurs before restore.
There is no cross-tab synchronization. If browser storage is unavailable or
full, a warning explains that the conversation remains in page memory instead.

No conversation is stored in Express sessions, database transcript tables,
application caches, audit entries or application logs. Feature HTTP responses,
including authorization and error responses, are private/no-store. A generic
request-scoped privacy marker suppresses response previews and raw unexpected
error diagnostics, while preserving HTTP method/path/status/timing metadata.
Transcript-free webclient usage counting remains enabled for external calls.

**External providers receive the submitted conversation window. Foray processes
it externally and applies its own retention policy. Clearing browser history
does not delete a provider's copies.** Avoid sharing unnecessary personal
information. The local Dummy provider makes no external calls and has no charges.

## Provider and settings contracts

Use `wcRequest`, never a plugin handler. All five provider operations must be
declared and uncached: `contract.chat.catalog`, `.ask`, `.search`, `.route`,
and `.feedback`, plus the provider's connection test. This page uses only
catalog and ask. Standalone search, routing and feedback are not page features.

The administrator-only core variable API stores `contract_chat_settings` as
`{ "providerConfigId": "<saved configuration ID>" }`, or
`{ "providerConfigId": null }` for an explicit no-provider choice. The component
owns the parsing contract in `shared/settings.ts`; credentials are never exposed
to chat users. No chat schema or database migration is needed.

## Dummy verification

Select a `contract-chat-dummy` configuration and explicitly choose its
`synthetic-contract`. Its expired example includes a notice and quotation.
Configure `scenario` as `normal`, `refusal`, `truncated`, `budget_exceeded`,
`rate_limited`, or `service_error`. Failure scenarios affect catalog reads too;
refusal and truncated affect answers. Routing questions exactly `ask` and `none`
exercise adapter-only routing outcomes. Feedback returns `persisted:false`.

Focused offline boundary tests:

```sh
npx vitest run components/contract.chat/tests components/contract.chat.foray/tests tests/webclient
```
