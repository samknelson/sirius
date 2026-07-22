/**
 * Seed local-auth credentials for additional dev users.
 *
 * Upserts auth_identities rows (providerType "local") for a fixed list of
 * existing users, mirroring server/auth/local-seed.ts. Idempotent: re-running
 * updates the hash if it changed and skips otherwise. Never creates users.
 *
 * Usage: npx tsx scripts/oneoffs/seed-local-credentials.ts
 */
import { storage } from "../../server/storage";

const CREDENTIALS: Array<{ email: string; passwordHash: string }> = [
  {
    email: "john.young@activistcentral.net",
    passwordHash: "$2b$12$/IzKv5lqfOgJJoiIr1NgFeytOScex51CIewuMvaCLi6WOquBdjM02",
  },
  {
    email: "mmcdermott@cgtconsultinginc.com",
    passwordHash: "$2b$12$.dr2MKAJgP26KB6mT4aU2eD8UJIGDlBmEOxJQaoSiw3kJRHpel82.",
  },
];

async function main() {
  for (const { email, passwordHash } of CREDENTIALS) {
    const normalized = email.trim().toLowerCase();
    const user = await storage.users.getUserByEmail(normalized);
    if (!user) {
      console.error(`SKIP ${normalized}: no user with this email`);
      continue;
    }

    const existing = await storage.authIdentities.getByProviderAndExternalId(
      "local",
      normalized
    );

    if (!existing) {
      await storage.authIdentities.create({
        userId: user.id,
        providerType: "local",
        externalId: normalized,
        email: normalized,
        passwordHash,
      });
      console.log(`CREATED local credential for ${normalized}`);
      continue;
    }

    if (existing.userId !== user.id) {
      console.error(`SKIP ${normalized}: identity belongs to a different user`);
      continue;
    }

    if (existing.passwordHash === passwordHash) {
      console.log(`OK ${normalized}: already up to date`);
      continue;
    }

    await storage.authIdentities.update(existing.id, { passwordHash });
    console.log(`UPDATED local credential for ${normalized}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
