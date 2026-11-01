# Account deactivation and session authority

Deactivation is an access boundary, not just a restriction on future logins.

- The session store checks current account state before restoring authenticated sessions. Passport, request guards, and effective-user resolution reuse request-scoped current account reads; serialized `dbUser` records are not authority.
- Both the signed-in owner and a masqueraded target must exist, be active, and match their saved revocation generations. A missing target no longer silently falls back to the administrator.
- Shared user updates require a boolean `isActive`. Deactivation increments the storage-controlled `users.session_version` and deletes affected sessions in the same transaction. Legacy provider subjects are matched through auth identities, not assumed to be internal user IDs.
- Session saves lock account rows in deterministic order before locking the session. Their saved generations must match the current accounts, preventing a save or renewal started before deactivation from restoring the revoked authority—even if the account has since been reactivated.
- Existing sessions without a generation belong to generation zero. Fresh provider-verified sign-ins carry the current account generation; new masquerades capture the target's generation. Public insert/update schemas do not expose generation controls.
- Private sockets recheck persisted session authority and current owner/target accounts before delivery, acknowledgments, and heartbeats. Account reads run outside ambient transactions, and socket checks do not renew inactivity deadlines. Local invalidation happens only after revocation commits; remote processes enforce the persisted state.

The core migration adds a non-null integer generation with default zero, so ordinary active sessions survive the upgrade. Existing inactive accounts are refused immediately; explicit reactivation does not revive sessions revoked by a deactivation performed under this policy.

This does not change configured session lifetimes, idle timeout, cookie policy, identity providers, public links, independent service credentials, or the break-glass startup reconciler. It does not undo an operation that was already authorized and underway before deactivation committed.

Account generations protect **account deactivation**. They are not a replacement for per-session revocation: an isolated administrative session deletion, without advancing an account generation, still needs separate protection against late save/touch resurrection.
