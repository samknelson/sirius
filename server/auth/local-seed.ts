import { storage } from "../storage";
import { logger } from "../logger";

/**
 * Seed (or refresh) the local-auth credential from environment variables.
 *
 * Deployments where the operator has no console access (e.g. ECS task defs
 * managed purely through the repo) can set:
 *
 *   LOCAL_AUTH_EMAIL          — email of an existing user (created via the
 *                               bootstrap flow or by an admin)
 *   LOCAL_AUTH_PASSWORD_HASH  — a bcrypt hash of the password (generate with
 *                               `npx tsx scripts/oneoffs/generate-password-hash.ts`)
 *
 * At boot this upserts the matching `auth_identities` row (providerType
 * "local", externalId = lowercased email). It never creates users, never
 * logs the hash, and is a no-op when either variable is missing.
 *
 * Also called from the bootstrap route right after the first user is
 * created, so a fresh deployment does not need a second restart before the
 * seeded credential works.
 */
export async function seedLocalCredential(): Promise<void> {
  const email = process.env.LOCAL_AUTH_EMAIL?.trim().toLowerCase();
  const passwordHash = process.env.LOCAL_AUTH_PASSWORD_HASH?.trim();

  if (!email || !passwordHash) {
    return;
  }

  const providers = (process.env.AUTH_PROVIDER || "replit")
    .split(",")
    .map((p) => p.trim());
  if (!providers.includes("local")) {
    logger.warn(
      "LOCAL_AUTH_EMAIL/LOCAL_AUTH_PASSWORD_HASH are set but 'local' is not in AUTH_PROVIDER — skipping local credential seeding",
      { source: "local-auth-seed" }
    );
    return;
  }

  if (!/^\$2[aby]\$\d{2}\$/.test(passwordHash)) {
    logger.error(
      "LOCAL_AUTH_PASSWORD_HASH does not look like a bcrypt hash ($2a$/$2b$/$2y$ prefix) — refusing to seed. Generate one with scripts/oneoffs/generate-password-hash.ts",
      { source: "local-auth-seed" }
    );
    return;
  }

  try {
    const user = await storage.users.getUserByEmail(email);
    if (!user) {
      logger.warn(
        // PII triage: the operator configured the seed email; keep it out of logs.
        `Local credential seeding: no user exists with the configured seed email. Create the user first (bootstrap flow or admin), then restart — or the bootstrap flow will seed it automatically.`,
        { source: "local-auth-seed" }
      );
      return;
    }

    const existing = await storage.authIdentities.getByProviderAndExternalId(
      "local",
      email
    );

    if (!existing) {
      await storage.authIdentities.create({
        userId: user.id,
        providerType: "local",
        externalId: email,
        email,
        passwordHash,
      });
      // PII triage: userId identifies the account; email stays out of logs.
      logger.info(`Local credential seeded (new identity)`, {
        source: "local-auth-seed",
        userId: user.id,
      });
      return;
    }

    if (existing.userId !== user.id) {
      logger.error(
        // PII triage: identityId identifies the row; email stays out of logs.
        `Local credential seeding: identity for the configured seed email belongs to a different user — refusing to overwrite`,
        { source: "local-auth-seed", identityId: existing.id }
      );
      return;
    }

    if (existing.passwordHash === passwordHash) {
      logger.info(`Local credential for the configured seed email already up to date`, {
        source: "local-auth-seed",
      });
      return;
    }

    await storage.authIdentities.update(existing.id, { passwordHash });
    // PII triage: identityId identifies the row; email stays out of logs.
    logger.info(`Local credential updated`, {
      source: "local-auth-seed",
      identityId: existing.id,
    });
  } catch (error) {
    // Seeding must never take the app down — log loudly and continue booting.
    logger.error("Local credential seeding failed", {
      source: "local-auth-seed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
