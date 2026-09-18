# Okta sign-in after a database refresh

The application startup migration repairs `auth_identities.created_at` and
`auth_identities.updated_at`. Both columns must exist, default to `now()`, and
allow null so an Okta identity can be recreated without rewriting historical
values.

## Staging recovery

1. Deploy or restart the staging application and wait for startup migrations to
   finish successfully.
2. Confirm the startup log reports migration
   `1197_repair_auth_identity_timestamps` as completed (or reports no pending
   migrations when it already ran).
3. In the database, verify both columns:

   ```sql
   SELECT column_name, column_default, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'auth_identities'
     AND column_name IN ('created_at', 'updated_at')
   ORDER BY column_name;
   ```

   Expect two rows, `now()` defaults, and `YES` nullability.
4. Use a staging Okta account whose Sirius user exists but whose staging
   identity was removed. Sign in once, then verify exactly one matching identity
   belongs to that user. Do not copy production identities into staging.
5. If sign-in still fails, find `Okta provisioned-account identity linking
   failed` in server logs. Its `database` object contains safe PostgreSQL
   identifiers such as error code, table, column, and constraint; it does not
   contain email addresses, claims, tokens, query text, or database values.