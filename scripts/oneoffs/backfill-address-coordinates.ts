/**
 * Backfill latitude/longitude/accuracy for active addresses that are
 * missing coordinates (saved while GOOGLE_MAPS_API_KEY was absent or
 * geocoding failed).
 *
 * Safe to re-run: only touches addresses still missing coordinates and
 * never overwrites existing ones.
 *
 * Usage: npx tsx scripts/oneoffs/backfill-address-coordinates.ts
 */
import { storage } from "../../server/storage";
import { addressValidationService } from "../../server/services/comm/validators/address";

const DELAY_MS = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const apiKey = await addressValidationService.getGoogleMapsApiKey();
  if (!apiKey) {
    console.error(
      "GOOGLE_MAPS_API_KEY is not configured. Set the secret and re-run this script.",
    );
    process.exit(1);
  }

  const addresses = await storage.contacts.addresses.listActiveMissingCoordinates();
  console.log(`Found ${addresses.length} active address(es) missing coordinates.\n`);

  let geocoded = 0;
  let failed = 0;
  let skipped = 0;
  const failures: { id: string; address: string; reason: string }[] = [];

  for (const addr of addresses) {
    const label = [addr.street, addr.city, addr.state, addr.postalCode]
      .filter(Boolean)
      .join(", ");

    if (!addr.street && !addr.city && !addr.state && !addr.postalCode) {
      console.log(`SKIP  ${addr.id} — empty address`);
      skipped++;
      continue;
    }

    try {
      const result = await addressValidationService.geocodeAddress({
        street: addr.street ?? "",
        city: addr.city ?? "",
        state: addr.state ?? "",
        postalCode: addr.postalCode ?? "",
        country: addr.country ?? "",
      });

      if (result.success && result.latitude != null && result.longitude != null) {
        // Never overwrite an existing value: only fill fields that are missing.
        await storage.contacts.addresses.updateContactPostal(addr.id, {
          ...(addr.latitude == null ? { latitude: result.latitude } : {}),
          ...(addr.longitude == null ? { longitude: result.longitude } : {}),
          ...(addr.accuracy == null ? { accuracy: result.accuracy } : {}),
        });
        console.log(
          `OK    ${label} -> (${result.latitude}, ${result.longitude}) [${result.accuracy ?? "unknown"}]`,
        );
        geocoded++;
      } else {
        const reason = result.error ?? "No coordinates returned";
        console.log(`FAIL  ${label} — ${reason}`);
        failures.push({ id: addr.id, address: label, reason });
        failed++;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`FAIL  ${label} — ${reason}`);
      failures.push({ id: addr.id, address: label, reason });
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log("\n=== Summary ===");
  console.log(`Total candidates: ${addresses.length}`);
  console.log(`Geocoded:         ${geocoded}`);
  console.log(`Failed:           ${failed}`);
  console.log(`Skipped:          ${skipped}`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  - ${f.address} (${f.id}): ${f.reason}`);
    }
  }

  process.exit(failed > 0 ? 2 : 0);
}

main().catch((error) => {
  console.error("Backfill script crashed:", error);
  process.exit(1);
});
