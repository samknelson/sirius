/**
 * One-off: repoint existing COBRA trust elections to the dedicated
 * "COBRA" employer and "COBRA" policy.
 *
 * COBRA elections must never be attributed to the worker's real employer
 * (the employment relationship ended — that's what triggered COBRA). The
 * enrollment wizard now get-or-creates a dedicated "COBRA" employer and
 * "COBRA" policy (sirius ID "COBRA") and always uses them. This script
 * backfills the same rule onto elections posted before the change.
 *
 * It is idempotent: the employer/policy are get-or-created by sirius ID,
 * and elections already pointing at them are skipped.
 *
 * Usage:
 *   npx tsx scripts/oneoffs/repoint-cobra-elections.ts
 */
import { storage } from "../../server/storage";

const COBRA_SIRIUS_ID = "COBRA";
const COBRA_NAME = "COBRA";

async function main() {
  let policy = await storage.policies.getPolicyBySiriusId(COBRA_SIRIUS_ID);
  if (!policy) {
    policy = await storage.policies.createPolicy({
      siriusId: COBRA_SIRIUS_ID,
      name: COBRA_NAME,
    });
    console.log(`Created COBRA policy ${policy.id}`);
  } else {
    console.log(`COBRA policy exists: ${policy.id}`);
  }

  let employer = await storage.employers.getBySiriusId(COBRA_SIRIUS_ID);
  if (!employer) {
    employer = await storage.employers.createEmployer({
      siriusId: COBRA_SIRIUS_ID,
      name: COBRA_NAME,
      denormPolicyId: policy.id,
    });
    console.log(`Created COBRA employer ${employer.id}`);
  } else {
    console.log(`COBRA employer exists: ${employer.id}`);
  }

  const elections = await storage.workerTrustElections.search({
    enrollmentType: "cobra",
  });
  let updated = 0;
  let skipped = 0;
  for (const election of elections) {
    if (
      election.employerId === employer.id &&
      election.policyId === policy.id
    ) {
      skipped++;
      continue;
    }
    await storage.workerTrustElections.update(election.id, {
      employerId: employer.id,
      policyId: policy.id,
    });
    console.log(
      `Repointed election ${election.id} (worker ${election.workerId})`,
    );
    updated++;
  }
  console.log(
    `Done: ${elections.length} COBRA election(s), ${updated} repointed, ${skipped} already correct.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
