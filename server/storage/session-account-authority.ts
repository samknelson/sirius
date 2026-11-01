import { sql } from "drizzle-orm";
import { getClient } from "./transaction-context";
import { accountVersion, sessionProviderType } from "../auth/account-authority";

export class SessionAccountRevokedError extends Error {
  constructor() {
    super("Session account authority has ended");
    this.name = "SessionAccountRevokedError";
  }
}

/**
 * Call inside the session write's transaction, BEFORE locking the session.
 * Account updates and authenticated saves then serialize on the same rows.
 */
export async function lockSessionAccounts(sess: any): Promise<void> {
  const principal = sess?.passport?.user;
  if (!principal) return;
  const client = getClient();
  let ownerId = principal.dbUser?.id;
  if (!ownerId && principal.claims?.sub) {
    const provider = await sessionProviderType(principal);
    const identities = await client.execute(sql`
      SELECT user_id FROM auth_identities
      WHERE provider_type = ${provider} AND external_id = ${principal.claims.sub}
    `);
    ownerId = (identities.rows[0] as any)?.user_id;
  }
  if (!ownerId) throw new SessionAccountRevokedError();
  const targetId = sess.masqueradeUserId ?? ownerId;
  const rows = await client.execute(sql`
    SELECT id, is_active, session_version FROM users
    WHERE id IN (${ownerId}, ${targetId}) ORDER BY id FOR UPDATE
  `);
  const byId = new Map((rows.rows as any[]).map(row => [row.id, row]));
  const owner = byId.get(ownerId);
  const target = byId.get(targetId);
  if (
    !owner?.is_active || !target?.is_active ||
    owner.session_version !== accountVersion(principal.dbUser?.sessionVersion) ||
    (targetId !== ownerId && target.session_version !== accountVersion(sess.masqueradeSessionVersion))
  ) throw new SessionAccountRevokedError();
}
