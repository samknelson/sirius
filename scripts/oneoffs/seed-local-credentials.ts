/**
 * Seed local-auth credentials for additional dev users.
 *
 * Upserts auth_identities rows (providerType "local") for existing users,
 * mirroring server/auth/local-seed.ts. Idempotent: re-running updates the
 * hash if it changed and skips otherwise. Never creates users.
 *
 * Credentials are NOT committed to source. Provide them via the
 * SEED_LOCAL_CREDENTIALS environment variable as a JSON array:
 *
 *   SEED_LOCAL_CREDENTIALS='[{"email":"a@b.com","passwordHash":"$2b$12$..."}]' \
 *     npx tsx scripts/oneoffs/seed-local-credentials.ts
 *
 * Generate a bcrypt hash with scripts/oneoffs/generate-password-hash.ts.
 */
import { storage } from "../../server/storage";
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../server/config/env-registry";

registerEnvironmentVariables([
  {
    name: "SEED_LOCAL_CREDENTIALS",
    description: "Local development credentials to seed.",
    secret: true,
    category: "core",
  },
]);

interface SeedCredential {
  email: string;
  passwordHash: string;
}

function loadCredentials(): SeedCredential[] {
  const raw = getEnvironmentVariable("SEED_LOCAL_CREDENTIALS")?.trim();
  if (!raw) {
    throw new Error(
      "SEED_LOCAL_CREDENTIALS is not set. Provide a JSON array of {email, passwordHash} objects (see file header)."
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("SEED_LOCAL_CREDENTIALS is not valid JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("SEED_LOCAL_CREDENTIALS must be a JSON array");
  }
  for (const entry of parsed) {
    if (
      typeof entry?.email !== "string" ||
      typeof entry?.passwordHash !== "string" ||
      !/^\$2[aby]\$/.test(entry.passwordHash)
    ) {
      throw new Error(
        "Each SEED_LOCAL_CREDENTIALS entry needs an email and a bcrypt passwordHash ($2a$/$2b$/$2y$ prefix)"
      );
    }
  }
  return parsed as SeedCredential[];
}

async function main() {
  const credentials = loadCredentials();
  for (const { email, passwordHash } of credentials) {
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
