/**
 * Smoke test for the sitespecific-bao-start-dental (service area) plugin.
 * Stubs the storage singleton: facilities, addresses, and the persistent
 * distance cache (driving rows, so no Google API call happens). No DB needed.
 * Run: npx tsx scripts/oneoffs/smoke-bao-start-dental.ts
 */
import { storage } from "../../server/storage/database";
import { BaoStartDentalPlugin } from "../../server/plugins/trust/eligibility/plugins/sitespecific-bao-start-dental";
import type { EligibilityContext } from "../../server/plugins/trust/eligibility/types";

const SITE_A = "site-a";
const SITE_B = "site-b";

const facilities: Record<string, any> = {
  [SITE_A]: { id: SITE_A, name: "Clinic A", contactId: "contact-site-a" },
  [SITE_B]: { id: SITE_B, name: "Clinic B", contactId: "contact-site-b" },
};
(storage as any).facilities = { get: async (id: string) => facilities[id] ?? null };

// Coordinates by contact: worker at (0,0); sites at distinct points.
const coordsByContact: Record<string, { latitude: number; longitude: number } | "none" | "raw"> = {
  "contact-near": { latitude: 0, longitude: 0 },
  "contact-far": { latitude: 50, longitude: 50 },
  "contact-noaddr": "none",
  "contact-ungeo": "raw",
  "contact-site-a": { latitude: 1, longitude: 1 },
  "contact-site-b": { latitude: 2, longitude: 2 },
};
(storage as any).contacts = {
  addresses: {
    getContactPostalByContact: async (contactId: string) => {
      const c = coordsByContact[contactId];
      if (!c || c === "none") return [];
      if (c === "raw") return [{ isPrimary: true, isActive: true, latitude: null, longitude: null }];
      return [{ isPrimary: true, isActive: true, latitude: c.latitude, longitude: c.longitude }];
    },
  },
};

// Persistent distance cache: pre-seeded DRIVING rows keyed by origin lat.
// near worker: 5 mi to site A, 12 mi to site B. far worker: 500/510 mi.
(storage as any).baoDistanceCache = {
  getByCoords: async (c: { originLat: number; destLat: number }) => {
    const table: Record<string, number> = {
      "0->1": 5,
      "0->2": 12,
      "50->1": 500,
      "50->2": 510,
    };
    const miles = table[`${c.originLat}->${c.destLat}`];
    return miles === undefined ? null : { distanceMiles: String(miles), method: "driving" };
  },
  upsert: async () => {},
};

function ctx(contactId: string): EligibilityContext {
  const w = { id: `w-${contactId}`, contactId } as any;
  return {
    scanType: "start",
    asOfYear: 2026,
    asOfMonth: 7,
    subscriberWorker: w,
    subscriberContact: null,
    dependentWorker: w,
    dependentContact: null,
  };
}

const config = (miles: number, sites: string[]) => ({
  appliesTo: ["start"] as ("start" | "continue")[],
  geographic: { distanceMiles: miles, facilityIds: sites },
});

const plugin = new BaoStartDentalPlugin();
let failures = 0;

async function check(name: string, c: EligibilityContext, cfg: any, expectEligible: boolean, reasonPart?: string) {
  const res = await plugin.evaluate(c, cfg);
  const ok =
    res.eligible === expectEligible &&
    (!reasonPart || (res.reason ?? "").toLowerCase().includes(reasonPart.toLowerCase()));
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: eligible=${res.eligible}`);
  console.log(`     reason=${res.reason}\n`);
}

(async () => {
  await check("within 10 mi of site A → eligible", ctx("contact-near"), config(10, [SITE_A, SITE_B]), true, "within the 10 mile");
  await check("nearest site 5 mi, limit 4 → NOT eligible", ctx("contact-near"), config(4, [SITE_A, SITE_B]), false, "beyond the 4 mile");
  await check("far worker (500+ mi) → NOT eligible", ctx("contact-far"), config(10, [SITE_A, SITE_B]), false, "beyond the 10 mile");
  await check("no primary address → NOT eligible", ctx("contact-noaddr"), config(10, [SITE_A]), false, "no primary address");
  await check("address not geocoded → NOT eligible", ctx("contact-ungeo"), config(10, [SITE_A]), false, "not been geocoded");
  await check("unconfigured rule → NOT eligible", ctx("contact-near"), { appliesTo: ["start"] }, false, "not fully configured");

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
