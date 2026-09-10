/**
 * One-off verification for Task: record auth identity changes and retire their
 * timestamps.
 *
 * `auth_identities` is written on the sign-in path and holds a password hash,
 * a provider refresh token and whatever the provider puts in `metadata`. Two
 * properties of its storage logging config therefore have to be shown rather
 * than asserted in a comment, and this script drives the real storage against
 * the real database and reads back the rows that were actually stored:
 *
 *  1. **A login that changes nothing records nothing.** The provider login
 *     sequence (re-assert what the provider knows, then stamp last-used) is
 *     run twice — once changing something, once changing nothing — and the log
 *     must show one entry, not two. The identity's modified stamp must not
 *     move for the no-op either.
 *  2. **Nothing sensitive reaches the log.** Every secret written here is a
 *     canary string; after the run, no stored log row may contain any of them.
 *
 * Run with: npx tsx scripts/oneoffs/verify-auth-identity-logging.ts
 * Leaves nothing behind but the log rows it made (and the disabled test user).
 */
import { storage } from "../../server/storage";
import { entityMetadataStorage } from "../../server/storage/system/entity-metadata";
import { withSystemActor } from "../../server/middleware/request-context";

const CANARY = `CANARY-${Date.now()}`;
const SECRETS = {
  firstToken: `${CANARY}-REFRESH-TOKEN-1`,
  secondToken: `${CANARY}-REFRESH-TOKEN-2`,
  metadataValue: `${CANARY}-METADATA-VALUE`,
  firstHash: `${CANARY}-PASSWORD-HASH-1`,
  secondHash: `${CANARY}-PASSWORD-HASH-2`,
};

const failures: string[] = [];

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    failures.push(label);
    console.log(`FAIL ${label}`);
  }
}

/** Logging and provenance are written after the call returns; let them land. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

async function main(): Promise<void> {
  await withSystemActor(async () => {
    const email = `verify-auth-identity-${Date.now()}@example.test`;
    const user = await storage.users.upsertUser({ email } as any);
    console.log("created test user", user.id);

    // --- Linking an identity ------------------------------------------------
    const created = await storage.authIdentities.create({
      userId: user.id,
      providerType: "replit",
      externalId: `verify-${Date.now()}`,
      email,
      displayName: "Verify Person",
      refreshToken: SECRETS.firstToken,
      metadata: { managedRoleIds: [], secret: SECRETS.metadataValue },
    });
    await settle();
    const afterCreate = await entityMetadataStorage.get(created.id);
    check("linking an identity records its creation", afterCreate?.created.date != null);

    // --- A sign-in that changes nothing ------------------------------------
    // Exactly what the Replit/SAML/Clerk login path does on every sign-in:
    // re-assert what the provider knows, then stamp last-used.
    const noop = await storage.authIdentities.update(created.id, {
      email,
      displayName: "Verify Person",
      profileImageUrl: undefined,
    });
    await storage.authIdentities.updateLastUsed(created.id);
    check("a re-assertion reports no changed fields", noop?.changedFields.length === 0);
    await settle();
    const afterNoop = await entityMetadataStorage.get(created.id);
    check(
      "a login that changes nothing leaves the modified stamp alone",
      afterNoop?.modified.date?.getTime() === afterCreate?.modified.date?.getTime(),
    );

    // --- A sign-in that changes something ----------------------------------
    const changed = await storage.authIdentities.update(created.id, {
      email,
      displayName: "Verify Person Renamed",
    });
    await storage.authIdentities.updateLastUsed(created.id);
    check(
      "a changed assertion reports only the field that changed",
      changed?.changedFields.join(",") === "displayName",
    );

    // --- Role reconciliation ------------------------------------------------
    // The reconciler rebuilds the whole metadata object; re-asserting the same
    // managed roles must not read as a change.
    const sameRoles = await storage.authIdentities.update(created.id, {
      metadata: { secret: SECRETS.metadataValue, managedRoleIds: [] },
    });
    check("re-asserting the same managed roles changes nothing", sameRoles?.changedFields.length === 0);

    const newRoles = await storage.authIdentities.update(created.id, {
      metadata: { managedRoleIds: ["role-from-provider"], secret: SECRETS.metadataValue },
    });
    check("changing the managed roles is a change", newRoles?.changedFields.join(",") === "metadata");

    // --- Token rotation -----------------------------------------------------
    const rotated = await storage.authIdentities.update(created.id, {
      refreshToken: SECRETS.secondToken,
    });
    check("rotating the refresh token is a change", rotated?.changedFields.join(",") === "refreshToken");

    // --- Local credentials --------------------------------------------------
    const localCreated = await storage.authIdentities.upsertLocalPasswordHash(
      user.id,
      email,
      SECRETS.firstHash,
    );
    check("the first local credential reports a creation", localCreated.created === true);
    const localReplaced = await storage.authIdentities.upsertLocalPasswordHash(
      user.id,
      email,
      SECRETS.secondHash,
    );
    check("replacing the password reports no creation", localReplaced.created === false);

    // A local sign-in: find the credential, then stamp last-used.
    await storage.authIdentities.getByProviderAndExternalId("local", email.toLowerCase());
    await storage.authIdentities.updateLastUsed(localReplaced.identity.id);

    // --- Unlinking ----------------------------------------------------------
    const removedMissing = await storage.authIdentities.delete("00000000-0000-4000-8000-000000000000");
    check("deleting nothing reports nothing deleted", removedMissing.deleted === false);
    const removed = await storage.authIdentities.delete(created.id);
    check("unlinking reports the owner of the deleted identity", removed.userId === user.id);
    await storage.authIdentities.delete(localReplaced.identity.id);

    await settle();

    // --- What was actually written -----------------------------------------
    const entries = await storage.logs.getLogsByHostEntityIds({
      hostEntityIds: [user.id],
      module: "authIdentities",
      limit: 100,
    });
    const written = entries
      .map((entry) => `${entry.operation}: ${entry.description ?? ""}`)
      .sort();
    console.log("\nlog entries written for this user:");
    for (const line of written) console.log(`  ${line}`);

    // Six writes changed something: the link, the rename, the managed-role
    // change, the token rotation, and the two local-credential writes. The two
    // no-op assertions, the three last-used stamps and the delete that found
    // nothing are silent; the two real deletes are not.
    check("only the writes that changed something were logged", entries.length === 8);
    check(
      "the delete that found nothing was not logged",
      entries.filter((e) => e.operation === "delete").length === 2,
    );
    check(
      "no last-used stamp was logged",
      entries.every((e) => e.operation !== "updateLastUsed"),
    );

    const dump = JSON.stringify(entries);
    for (const [name, secret] of Object.entries(SECRETS)) {
      check(`no log entry contains the ${name}`, !dump.includes(secret));
    }
    check("no log entry contains any canary at all", !dump.includes(CANARY));
    check(
      "presence is reported instead of the secret",
      dump.includes("hasRefreshToken") && dump.includes("hasPasswordHash") && dump.includes("metadataKeys"),
    );

    // Provenance survives the identity only as long as the record does.
    const afterDelete = await entityMetadataStorage.get(created.id);
    check("provenance is forgotten with the identity", afterDelete === undefined);
  });

  if (failures.length > 0) {
    console.log(`\n${failures.length} CHECK(S) FAILED:`);
    for (const failure of failures) console.log(`  - ${failure}`);
    throw new Error("verification failed");
  }
  console.log("\nALL PASS");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
