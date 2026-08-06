/**
 * Smoke test for T27 bulk Okta pre-provisioning (lib/okta-provision.ts)
 * against a STUBBED Okta admin client — no real Okta calls ever.
 * Covers: dry-run creates nothing; execute creates + records identity with
 * workerId metadata; resume skips already-provisioned; --only filter;
 * existing-Okta reuse; ambiguous Okta duplicate surfaces (exit-1 condition);
 * inactive users skipped.
 *
 * Run: npx tsx scripts/oneoffs/s1-t27-provision-okta-smoke.ts
 */
import { db, pool as pgPool } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import { storage } from "../../server/storage/database";
import { ensureStagingSchema } from "../s1-migration/lib/staging";
import { ensureIdMap, putMapping } from "../s1-migration/lib/idmap";
import { provisionMigratedUsers, type OktaAdminClient } from "../s1-migration/lib/okta-provision";

const UIDS = { linked: 998001, reuse: 998002, dupOkta: 998003, inactive: 998004 };
const EMAILS = {
  linked: "t27.prov.linked@example.test",
  reuse: "t27.prov.reuse@example.test",
  dupOkta: "t27.prov.dup@example.test",
  inactive: "t27.prov.inactive@example.test",
};

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log(`  ok: ${name}`);
  else {
    failures++;
    console.error(`  FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

function makeStub() {
  const created: Array<{ email: string }> = [];
  const client: OktaAdminClient = {
    async findByEmail(email: string) {
      if (email === EMAILS.reuse) return [{ id: "okta-existing-1", status: "ACTIVE", email }];
      if (email === EMAILS.dupOkta)
        return [
          { id: "okta-dup-1", status: "ACTIVE", email },
          { id: "okta-dup-2", status: "STAGED", email },
        ];
      return [];
    },
    async createUser({ email }) {
      created.push({ email });
      return { id: `okta-created-${created.length}`, status: "PROVISIONED" };
    },
  };
  return { client, created };
}

const seededUserIds: string[] = [];
async function seed() {
  await ensureStagingSchema();
  await ensureIdMap();
  const worker = await storage.workers.createWorkerWithNameParts({ given: "Prov", family: "T27Smoke", displayName: "Prov T27Smoke" });
  const mk = async (uid: number, email: string, isActive: boolean, withWorker: boolean) => {
    const u = await storage.users.createUser({
      email,
      firstName: "T27",
      lastName: "Prov",
      isActive,
      accountStatus: "pending",
      data: { s1: { uid }, ...(withWorker ? { migratedWorkerId: worker.id } : {}) },
    });
    seededUserIds.push(u.id);
    await putMapping("user", uid, u.id, { stub: false, loader: "t27-prov-smoke" });
    return u;
  };
  const linked = await mk(UIDS.linked, EMAILS.linked, true, true);
  await mk(UIDS.reuse, EMAILS.reuse, true, false);
  await mk(UIDS.dupOkta, EMAILS.dupOkta, true, false);
  await mk(UIDS.inactive, EMAILS.inactive, false, false);
  return { worker, linked };
}

async function cleanup() {
  console.log("cleanup...");
  for (const id of seededUserIds) {
    await db.execute(sql`DELETE FROM auth_identities WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM user_roles WHERE user_id = ${id}`);
    await db.execute(sql`DELETE FROM users WHERE id = ${id}`);
  }
  await db.execute(
    sql`DELETE FROM s1_staging.id_map WHERE entity = 'user' AND s1_id IN (${sql.join(Object.values(UIDS).map((n) => sql`${n}`), sql`, `)})`,
  );
  const workers = await db.execute(sql`SELECT w.id, w.contact_id FROM workers w JOIN contacts c ON c.id = w.contact_id WHERE c.family = 'T27Smoke' AND c.given = 'Prov'`);
  for (const r of (workers as any).rows) {
    await db.execute(sql`DELETE FROM workers WHERE id = ${r.id}`);
    await db.execute(sql`DELETE FROM contacts WHERE id = ${r.contact_id}`);
  }
}

async function main() {
  const { worker, linked } = await seed();
  const onlyEmails = Object.values(EMAILS);

  console.log("1: dry-run");
  {
    const { client, created } = makeStub();
    const rep = await provisionMigratedUsers({ dryRun: true, onlyEmails, client });
    check("dry-run creates no okta users", created.length === 0);
    check("dry-run creates no identities", rep.identitiesCreated === 0);
    check("dry-run reports would-create for actives", rep.dryRunWouldCreate.length === 2, rep.dryRunWouldCreate);
    check("dry-run flags ambiguous okta", rep.ambiguousOkta.length === 1, rep.ambiguousOkta);
    check("dry-run skips inactive", rep.skippedInactive >= 1);
    check("dry-run would-create carries worker-link flag", rep.dryRunWouldCreate.some((d) => d.hasWorkerLink));
  }

  console.log("2: execute (stub)");
  {
    const { client, created } = makeStub();
    const rep = await provisionMigratedUsers({ dryRun: false, onlyEmails, client });
    check("execute creates one okta user", created.length === 1 && rep.createdOkta === 1, { created, rep: rep.createdOkta });
    check("execute reuses existing okta", rep.reusedExistingOkta === 1);
    check("execute records identities", rep.identitiesCreated === 2, rep.identitiesCreated);
    check("ambiguous NOT provisioned", rep.ambiguousOkta.length === 1);
    const ids = await storage.authIdentities.getByUserId(linked.id);
    const okta = ids.find((i) => i.providerType === "okta");
    check("identity externalId is okta id", okta?.externalId === "okta-created-1", okta?.externalId);
    const meta = (okta?.metadata as Record<string, unknown> | null) ?? {};
    check("identity metadata carries workerId", meta.workerId === worker.id, meta);
    check("identity metadata preProvisioned", meta.preProvisioned === true);
  }

  console.log("3: resume (re-run skips provisioned)");
  {
    const { client, created } = makeStub();
    const rep = await provisionMigratedUsers({ dryRun: false, onlyEmails, client });
    check("resume creates nothing new", created.length === 0 && rep.identitiesCreated === 0, rep);
    check("resume counts already-provisioned", rep.skippedAlreadyProvisioned === 2, rep.skippedAlreadyProvisioned);
  }

  console.log("4: --only filter");
  {
    const { client } = makeStub();
    const rep = await provisionMigratedUsers({ dryRun: true, onlyEmails: [EMAILS.dupOkta], client });
    check("filter processes only the targeted user", rep.candidates === 1 && rep.skippedFiltered >= 2, {
      candidates: rep.candidates,
      filtered: rep.skippedFiltered,
    });
  }

  await cleanup();
  console.log(failures === 0 ? "\nT27 PROVISION SMOKE PASS" : `\nT27 PROVISION SMOKE FAIL (${failures})`);
  await pgPool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
  } catch (e) {
    console.error("cleanup failed", e);
  }
  await pgPool.end();
  process.exit(1);
});
