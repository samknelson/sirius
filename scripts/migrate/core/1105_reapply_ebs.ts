import { registerMigration, type Migration } from "../../../server/services/migration-runner";
import createEbs from "./1044_create_ebs";
import ebsSubjectAndPurge from "./1045_ebs_subject_and_purge";

/**
 * Re-apply the EBS migrations (1044 + 1045) at a high version number.
 *
 * Why: this deployment's migrations_version counter was already past 1044/1045
 * (it sat at 1104 from a parallel branch) when the EBS migrations merged in,
 * so the runner skipped them and the startup drift gate refused to boot
 * (missing ebs_denorm / ebs_status). Both source migrations are fully
 * idempotent (IF NOT EXISTS guards), so re-running them here is safe on
 * databases that already have the tables.
 */
async function up(): Promise<void> {
  await createEbs.up();
  await ebsSubjectAndPurge.up();
}

const migration: Migration = {
  version: 1105,
  name: "reapply_ebs",
  description:
    "Idempotently re-apply skipped EBS migrations 1044 (create ebs_denorm/ebs_status + enum) and 1045 (subject_id/purge_after) for deployments whose migration counter was already past those versions at merge time.",
  up,
};

registerMigration(migration);

export default migration;
