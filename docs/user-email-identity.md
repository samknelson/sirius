# Login account email identity

Nonblank user email identity is `lower(nullif(btrim(email), ''))` in
PostgreSQL. Application writes trim surrounding whitespace and preserve display
casing. Blank legacy values remain allowed, but an empty lookup never selects
an account. Provider subjects remain separate identifiers, not email aliases.

## Creation and lookup inventory

| Surface | Account access |
| --- | --- |
| Administrator account creation | `server/modules/users.ts`: shared create schema, lookup, then `users.createUser`; a racing email collision returns 409. |
| First administrator / operator-managed local administrator | `server/modules/system/bootstrap.ts`, `server/auth/local-seed.ts`: shared storage create/lookup; the operator reconciler can re-read its explicitly configured account after an email-only conflict. |
| Trusted provider first login | Replit, Clerk and SAML providers call `getUserByEmail` and `server/auth/provisioning.ts`. Provisioning creates user + provider identity transactionally. Race recovery requires the exact provider type + external ID; an email collision alone never authorizes linking to the winner. |
| Existing external identity | Each provider resolves its provider subject first, then updates the named user via shared storage. Email uniqueness does not rewrite provider subjects or verification requirements. |
| Local password login | `server/auth/providers/local.ts`: trimmed, lowercased email identifies a unique local auth identity; password verification and user activity checks remain required. |
| Clerk worker registration | `server/auth/providers/clerk.ts`: existing worker-verification flow, shared lookup/create/update; racing email creation returns 409. |
| Worker, employer and trust-provider contact promotion | `server/modules/workers/users.ts`, `server/modules/employers/contacts.ts`, `server/modules/trust/provider/contacts.ts`: shared lookup/create/update, explicit 409 on email conflicts. Bulk employer promotion reports an explicit conflict for the affected item. |
| Employer-onboarding wizard | `server/plugins/wizards/plugins/employer-onboarding.ts`: shared lookup/create, existing per-item error reporting; no role assignment after a failed creation. |
| Component-owned importers | Shared lookup refuses ambiguity; raw inserts remain subject to the same database index. Resolving a relationship reference does not resolve an authentication identity. |
| Legacy upsert / direct storage callers | `server/storage/users.ts`: create, upsert and update normalize email, with database uniqueness as the concurrency authority. Upsert conflicts only on user ID, never email. |
| Contact synchronization | `server/services/user-contact-sync.ts`: trims emails, skips blank values and uses the contact store's case-insensitive identity lookup. It does not merge user accounts or assign roles. |

All consumers of `getUserByEmail`, including notifications and contact-linked
role operations, refuse multiple matches instead of selecting an arbitrary
account. This is a defense for a legacy database before migration enforcement.
The index also protects writes that bypass application storage.

## Upgrade and operator resolution

The user-email migration locks account writes inside one transaction, inventories
normalized duplicate groups, and refuses **before any change** if duplicates
exist. The error lists every affected account ID, without logging email values.
An operator must inspect the accounts, their provider identities, and role
assignments, then explicitly correct the email on each conflicting account.
Retry the migration after resolution. It never chooses a surviving account,
deletes an identity, changes roles, or merges accounts.

After the inventory succeeds, the migration removes the old case-sensitive
constraint, trims stored emails, and installs the normalized unique index.
All steps roll back together on failure. Existing provider identity rows,
passwords, user IDs, and role assignments are untouched.
