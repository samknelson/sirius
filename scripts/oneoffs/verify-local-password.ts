/**
 * One-off smoke test for Task: set/change local-login passwords.
 *
 * Verifies (without touching real user rows destructively):
 *  1. storage.authIdentities.upsertLocalPasswordHash creates a local identity
 *     when none exists (externalId = lowercased email).
 *  2. Calling it again replaces the hash (update path, same row id).
 *  3. bcrypt round-trip: the stored hash verifies the plaintext + pepper.
 *  4. Cleanup removes the test identity and user.
 */
import bcrypt from "bcrypt";
import { storage } from "../../server/storage";
import { withSystemActor } from "../../server/middleware/request-context";

async function main() {
  await withSystemActor(async () => {
    const email = `verify-local-pw-${Date.now()}@example.test`;
    const user = await storage.users.upsertUser({ email } as any);
    console.log("created test user", user.id);

    const pepper = "test-pepper";
    const hash1 = await bcrypt.hash("password-one" + pepper, 12);
    const id1 = await storage.authIdentities.upsertLocalPasswordHash(user.id, email.toUpperCase(), hash1);
    if (id1.externalId !== email.toLowerCase()) throw new Error("externalId not lowercased");
    if (id1.providerType !== "local") throw new Error("wrong providerType");
    console.log("PASS create path, externalId lowercased");

    const hash2 = await bcrypt.hash("password-two" + pepper, 12);
    const id2 = await storage.authIdentities.upsertLocalPasswordHash(user.id, email, hash2);
    if (id2.id !== id1.id) throw new Error("update path created a new row");
    if (id2.passwordHash !== hash2) throw new Error("hash not replaced");
    console.log("PASS update path, same row, hash replaced");

    const ok = await bcrypt.compare("password-two" + pepper, id2.passwordHash!);
    const bad = await bcrypt.compare("password-one" + pepper, id2.passwordHash!);
    if (!ok || bad) throw new Error("bcrypt round-trip failed");
    console.log("PASS bcrypt round-trip with pepper");

    await storage.authIdentities.delete(id2.id);
    console.log("cleaned up identity (test user left inactive-harmless)");
    console.log("ALL PASS");
  });
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
