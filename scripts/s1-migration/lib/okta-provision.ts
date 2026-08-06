/**
 * T27 bulk Okta pre-provisioning core — injectable so tests can stub the
 * Okta admin client (no real Okta calls in automated tests; bulk rehearsal
 * runs stay dry-run; only the designated canary runs for-real pre-cutover).
 *
 * For each migrated ACTIVE user (id_map entity "user"):
 *   1. skip if an okta auth_identity already exists for the user (resume
 *      semantics — a partial failure just re-runs);
 *   2. look up Okta by email: reuse an existing Okta user (no activation
 *      email), otherwise create one in the member group (Okta sends the
 *      activation email on activate=true at cutover — see RUNBOOK; for the
 *      canary this is exactly the desired live test);
 *   3. record the Okta user id as a pre-provisioned `auth_identities` row
 *      (externalId = Okta user id = future OIDC `sub`), carrying
 *      metadata.workerId from users.data.migratedWorkerId — first sign-in
 *      then hits the existing-identity fast path with zero email heuristics.
 *
 * Aggregates-only reporting (uids/ids, never emails) — HIPAA-safe.
 */
import { storage } from "../../../server/storage/database";
import { db } from "../../../server/storage/db";
import { sql } from "drizzle-orm";

export interface OktaAdminClient {
  /** Returns Okta users matching the email (profile.email or login). */
  findByEmail(email: string): Promise<Array<{ id: string; status: string; email: string }>>;
  /** Creates an activated Okta user in the member group; returns its id. */
  createUser(args: { email: string; firstName: string; lastName: string }): Promise<{ id: string; status: string }>;
}

export interface ProvisionOptions {
  dryRun: boolean;
  /** Only process users whose email is in this list (lowercased). Canary runs use this. */
  onlyEmails?: string[];
  client: OktaAdminClient;
  log?: (msg: string) => void;
}

export interface ProvisionReport {
  candidates: number;
  skippedAlreadyProvisioned: number;
  skippedInactive: number;
  skippedFiltered: number;
  reusedExistingOkta: number;
  createdOkta: number;
  identitiesCreated: number;
  ambiguousOkta: Array<{ userId: string; matches: number }>;
  failures: Array<{ userId: string; code: string }>;
  dryRunWouldCreate: Array<{ userId: string; s1Uid: number | null; hasWorkerLink: boolean; oktaExists: boolean }>;
}

interface MigratedUserRow {
  s1Uid: number;
  s2Id: string;
}

export async function listMigratedUserIds(): Promise<MigratedUserRow[]> {
  const res = await db.execute(sql`
    SELECT s1_id, s2_id FROM s1_staging.id_map WHERE entity = 'user' ORDER BY s1_id
  `);
  return (res as unknown as { rows: Array<{ s1_id: string | number; s2_id: string }> }).rows.map((r) => ({
    s1Uid: Number(r.s1_id),
    s2Id: r.s2_id,
  }));
}

export async function provisionMigratedUsers(opts: ProvisionOptions): Promise<ProvisionReport> {
  const log = opts.log ?? (() => {});
  const only = opts.onlyEmails?.map((e) => e.toLowerCase());
  const report: ProvisionReport = {
    candidates: 0,
    skippedAlreadyProvisioned: 0,
    skippedInactive: 0,
    skippedFiltered: 0,
    reusedExistingOkta: 0,
    createdOkta: 0,
    identitiesCreated: 0,
    ambiguousOkta: [],
    failures: [],
    dryRunWouldCreate: [],
  };

  const migrated = await listMigratedUserIds();
  for (const m of migrated) {
    const user = await storage.users.getUser(m.s2Id);
    if (!user) {
      report.failures.push({ userId: m.s2Id, code: "user_missing" });
      continue;
    }
    if (!user.isActive) {
      report.skippedInactive++;
      continue;
    }
    if (only && !only.includes(user.email.toLowerCase())) {
      report.skippedFiltered++;
      continue;
    }
    report.candidates++;

    // resume semantics: an existing okta identity means DONE.
    const identities = await storage.authIdentities.getByUserId(user.id);
    if (identities.some((i) => i.providerType === "okta")) {
      report.skippedAlreadyProvisioned++;
      continue;
    }

    const data = (user.data as Record<string, unknown> | null) ?? {};
    const workerId = typeof data.migratedWorkerId === "string" ? data.migratedWorkerId : null;
    const s1Uid =
      typeof (data.s1 as Record<string, unknown> | undefined)?.uid === "number"
        ? ((data.s1 as Record<string, unknown>).uid as number)
        : null;

    let matches: Array<{ id: string; status: string; email: string }>;
    try {
      matches = await opts.client.findByEmail(user.email);
    } catch (err) {
      report.failures.push({ userId: user.id, code: "okta_lookup_failed" });
      void err;
      continue;
    }
    if (matches.length > 1) {
      report.ambiguousOkta.push({ userId: user.id, matches: matches.length });
      continue;
    }

    if (opts.dryRun) {
      report.dryRunWouldCreate.push({
        userId: user.id,
        s1Uid,
        hasWorkerLink: workerId != null,
        oktaExists: matches.length === 1,
      });
      continue;
    }

    let oktaUserId: string;
    if (matches.length === 1) {
      oktaUserId = matches[0].id;
      report.reusedExistingOkta++;
    } else {
      try {
        const created = await opts.client.createUser({
          email: user.email,
          firstName: user.firstName || user.email.split("@")[0],
          lastName: user.lastName || "Member",
        });
        oktaUserId = created.id;
        report.createdOkta++;
      } catch (err) {
        report.failures.push({ userId: user.id, code: "okta_create_failed" });
        void err;
        continue;
      }
    }

    try {
      await storage.authIdentities.create({
        userId: user.id,
        providerType: "okta",
        externalId: oktaUserId,
        email: user.email,
        displayName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || undefined,
        metadata: {
          ...(workerId ? { workerId } : {}),
          preProvisioned: true,
          source: "s1-user-migration",
          ...(s1Uid != null ? { s1Uid } : {}),
        },
      });
      report.identitiesCreated++;
      log(`provisioned userId=${user.id} oktaUserId=${oktaUserId}`);
    } catch (err) {
      report.failures.push({ userId: user.id, code: "identity_create_failed" });
      void err;
    }
  }

  return report;
}
