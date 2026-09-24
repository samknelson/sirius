/**
 * Development/test-only local-auth worker fixture. No passwords or hashes are
 * accepted on the command line (shell history) or written to stdout.
 *
 * ALLOW_WORKER_PAYMENT_FIXTURE=1 WORKER_PAYMENT_FIXTURE_PASSWORD=<secret> \
 *   npx tsx scripts/oneoffs/worker-payment-fixture.ts
 * To deactivate: ALLOW_WORKER_PAYMENT_FIXTURE=1 \
 *   npx tsx scripts/oneoffs/worker-payment-fixture.ts deactivate
 */
import bcrypt from "bcrypt";
import { and, eq, sql } from "drizzle-orm";
import { authIdentities, contacts, rolePermissions, roles, userRoles, users, workers } from "../../shared/schema";
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { getEnvironmentVariable, registerEnvironmentVariables } from "../../server/config/env-registry";

registerEnvironmentVariables([
  { name: "ALLOW_WORKER_PAYMENT_FIXTURE", description: "Explicit opt-in to provision a non-production worker payment fixture.", secret: false, category: "core" },
  { name: "WORKER_PAYMENT_FIXTURE_PASSWORD", description: "Password to set or rotate for the non-production worker fixture.", secret: true, category: "core" },
]);

const EMAIL = "worker-payment-fixture@example.invalid";
const NAME = "Payment Fixture Worker";
const MARKER = "worker-payment-fixture-v1";
const REQUIRED_PERMISSIONS = ["worker", "worker.ledger", "worker.ledger.pay", "worker.ledger.methods"];

export function assertFixtureEnvironment(nodeEnv: string | undefined, optIn: string | undefined): void {
  if (!["development", "test"].includes(nodeEnv ?? "") || optIn !== "1") {
    throw new Error("Fixture writes require NODE_ENV=development/test and ALLOW_WORKER_PAYMENT_FIXTURE=1; refusing outside approved non-production environments");
  }
}

async function main(): Promise<void> {
  assertFixtureEnvironment(getEnvironmentVariable("NODE_ENV"), getEnvironmentVariable("ALLOW_WORKER_PAYMENT_FIXTURE"));
  const deactivate = process.argv[2] === "deactivate";
  if (process.argv.length > (deactivate ? 3 : 2)) throw new Error("Only the deactivate command is supported");
  const password = getEnvironmentVariable("WORKER_PAYMENT_FIXTURE_PASSWORD");
  const pepper = getEnvironmentVariable("AUTH_LOCAL_PEPPER") ?? "";
  if (!deactivate && (!password || password.length < 8 || password.length > 200 || Buffer.byteLength(password + pepper) > 72)) {
    throw new Error("Provide WORKER_PAYMENT_FIXTURE_PASSWORD via a secret (8–200 characters, password plus pepper at most 72 bytes)");
  }
  const hash = deactivate ? null : await bcrypt.hash(password! + pepper, 12);

  const result = await runInTransaction(async () => {
    const db = getClient();
    // Serialize concurrent reruns so both cannot decide the fixture is absent.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${MARKER}))`);
    const [contact] = await db.select().from(contacts).where(sql`lower(${contacts.email}) = ${EMAIL}`);
    const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${EMAIL}`);
    const [identity] = await db.select().from(authIdentities).where(and(eq(authIdentities.providerType, "local"), eq(authIdentities.externalId, EMAIL)));
    const [worker] = contact ? await db.select().from(workers).where(eq(workers.contactId, contact.id)) : [];
    const tagged = user?.data as Record<string, unknown> | null;
    const workerTag = worker?.data as Record<string, unknown> | null;
    const identityTag = identity?.metadata as Record<string, unknown> | null;
    if (contact || user || worker || identity) {
      if (!contact || !user || !worker || !identity ||
        contact.displayName !== NAME || contact.email !== EMAIL ||
        tagged?.fixture !== MARKER || workerTag?.fixture !== MARKER ||
        identityTag?.fixture !== MARKER || identityTag.workerId !== worker.id ||
        identity.userId !== user.id || identity.email !== EMAIL ||
        user.email !== EMAIL || user.firstName !== "Payment Fixture" || user.lastName !== "Worker") {
        throw new Error("Fixture address or records collide with an unmarked or inconsistent person/identity; no records changed");
      }
      const otherIdentities = await db.select().from(authIdentities).where(eq(authIdentities.userId, user.id));
      if (otherIdentities.length !== 1) throw new Error("Fixture user has another identity; refusing");
    } else if (deactivate) {
      throw new Error("Fixture has not been provisioned");
    }

    const [workerRole] = await db.select().from(roles).where(eq(roles.name, "worker"));
    if (!workerRole) throw new Error("Worker role is missing; initialize roles first");
    const permissions = await db.select({ key: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, workerRole.id));
    const keys = new Set(permissions.map(p => p.key));
    const missing = REQUIRED_PERMISSIONS.filter(key => !keys.has(key));
    if (missing.length) throw new Error(`Worker role lacks permissions: ${missing.join(", ")}; configure the role, not the fixture`);
    if (keys.has("staff") || keys.has("admin")) throw new Error("Worker role has elevated permissions; refusing");
    if (user) {
      const assigned = await db.select().from(userRoles).where(eq(userRoles.userId, user.id));
      if (assigned.some(r => r.roleId !== workerRole.id)) throw new Error("Fixture has a non-worker role; refusing");
    }
    if (deactivate) {
      await db.update(users).set({ isActive: false }).where(eq(users.id, user!.id));
      await db.update(authIdentities).set({ passwordHash: null }).where(eq(authIdentities.id, identity!.id));
      return { workerId: worker!.id, userId: user!.id, state: "deactivated" };
    }
    let contactId = contact?.id;
    let workerId = worker?.id;
    let userId = user?.id;
    if (!contactId) {
      const [createdContact] = await db.insert(contacts).values({ email: EMAIL, given: "Payment Fixture", family: "Worker", displayName: NAME }).returning();
      contactId = createdContact.id;
      const [createdWorker] = await db.insert(workers).values({ contactId, data: { fixture: MARKER } }).returning();
      workerId = createdWorker.id;
      const [createdUser] = await db.insert(users).values({ email: EMAIL, firstName: "Payment Fixture", lastName: "Worker", isActive: true, accountStatus: "linked", data: { fixture: MARKER } }).returning();
      userId = createdUser.id;
      await db.insert(userRoles).values({ userId, roleId: workerRole.id });
      await db.insert(authIdentities).values({
        userId, providerType: "local", externalId: EMAIL, email: EMAIL,
        metadata: { fixture: MARKER, workerId }, passwordHash: hash,
      });
    } else {
      await db.update(users).set({ isActive: true, accountStatus: "linked" }).where(eq(users.id, userId!));
      await db.insert(userRoles).values({ userId: userId!, roleId: workerRole.id }).onConflictDoNothing();
      await db.update(authIdentities).set({ passwordHash: hash }).where(eq(authIdentities.id, identity!.id));
    }
    return { workerId: workerId!, userId: userId!, state: "ready" };
  });
  console.log(`Fixture ${result.state}: userId=${result.userId} workerId=${result.workerId} email=${EMAIL}`);
}

if (process.argv[1]?.endsWith("worker-payment-fixture.ts")) {
  main().catch(() => {
    // Never print errors from DB/auth layers: driver diagnostics may include
    // SQL parameters, including the password hash. Keep the operator message generic.
    console.error("Worker fixture provisioning refused or failed. Check environment, role permissions and existing fixture ownership.");
    process.exitCode = 1;
  });
}