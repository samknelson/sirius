import { registerMigration } from "../../../server/services/migration-runner";
import { storage } from "../../../server/storage";

// Schema DDL is applied to development through Agent permissions and carried
// to managed production by Publish. Do not add startup-time production DDL.
registerMigration({
  version: 1115,
  name: "legal_payment_upload_link",
  description: "Verify the published unique Legal upload payment linkage",
  up: async () => {
    await storage.ledger.payments.verifyUploadLinkSchema();
  },
});
