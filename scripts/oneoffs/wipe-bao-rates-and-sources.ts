/**
 * One-off: wipe ALL BAO employer rate history and ALL benefit rate sources.
 *
 * Goes through the storage layer:
 *   1. Deletes every sitespecific_bao_employer_rates row (full history).
 *   2. Deletes every rate source (junction rows cascade; attachments —
 *      object-storage blobs are cleaned up by the source delete path in the
 *      route; here we delete the file rows via storage.files after removing
 *      the source, mirroring that behavior).
 *
 * Usage: npx tsx scripts/oneoffs/wipe-bao-rates-and-sources.ts
 */

import { storage } from "../../server/storage";
import { objectStorageService } from "../../server/services/objectStorage";

async function main() {
  const rates = await storage.baoEmployerRates.list({ mode: "history" });
  console.log(`Deleting ${rates.length} rate entries…`);
  for (const r of rates) {
    await storage.baoEmployerRates.delete(r.id);
  }

  const sources = await storage.baoRateSources.list();
  console.log(`Deleting ${sources.length} rate sources…`);
  for (const s of sources) {
    const result = await storage.baoRateSources.delete(s.id);
    if (result.deleted) {
      const files = await storage.files.list({
        entityType: "bao_rate_source",
        entityId: s.id,
      });
      for (const f of files) {
        try {
          await objectStorageService.deleteFile(f.storagePath);
        } catch (e) {
          console.error("Failed to delete attachment blob:", e);
        }
        await storage.files.delete(f.id);
      }
    }
    console.log(`  ${s.name}: deleted=${result.deleted} referenced=${result.referenced}`);
  }

  const remainingRates = await storage.baoEmployerRates.list({ mode: "history" });
  const remainingSources = await storage.baoRateSources.list();
  console.log(
    `Done. Remaining: ${remainingRates.length} rate entries, ${remainingSources.length} sources.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
