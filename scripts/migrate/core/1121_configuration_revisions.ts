import { sql } from "drizzle-orm";
import { db } from "../../../server/db";
import { CONFIGURATION_REVISION_DDL } from "../../../server/storage/configuration-revision-ddl";
import { registerMigration, type Migration } from "../../../server/services/migration-runner";

const migration: Migration = {
  version: 1121,
  name: "configuration_revisions",
  description: "Transactional shared configuration revisions and mutation triggers",
  async up() {
    await db.transaction(tx => tx.execute(sql.raw(CONFIGURATION_REVISION_DDL)).then(() => undefined));
  },
};
registerMigration(migration);
export default migration;
