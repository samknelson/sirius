/**
 * Task #315: Confirm the two-field worker search can't quietly break
 * (Name/ID vs Contact).
 *
 * Storage-level checks (against the dev DB, seeded + cleaned up here):
 *  - Name/ID terms match name fields, Sirius ID, and showOnLists worker-ID
 *    values — and do NOT match addresses/emails/phones.
 *  - Contact terms match email, phone (incl. digits-only), and postal
 *    address fields — and do NOT match names.
 *  - Both fields together are ANDed; multiple terms within a field are ANDed.
 *  - getWorkersWithDetailsPaginated, getAllMatchingContactIds, and
 *    getWorkersForExport interpret the two params identically.
 *
 * Route-level checks (require the dev server running on :5000):
 *  - /api/workers/with-details/paginated, /api/workers/with-details/all-ids,
 *    and /api/workers/export interpret nameIdSearch / contactSearch
 *    identically (same matching set for the same query string).
 *
 * Run:
 *   npx tsx scripts/oneoffs/verify-worker-two-field-search.ts
 *   SKIP_ROUTES=1 npx tsx scripts/oneoffs/verify-worker-two-field-search.ts   # storage only
 */
import { storage } from "../../server/storage";
import { db } from "../../server/storage/db";
import { optionsWorkerIdType } from "@shared/schema";
import { eq } from "drizzle-orm";
import { loadComponentCache } from "../../server/services/component-cache";
import {
  getEnvironmentVariable,
  registerEnvironmentVariables,
} from "../../server/config/env-registry";

registerEnvironmentVariables([
  {
    name: "SKIP_ROUTES",
    description: "Set to 1 to skip route-level worker search checks.",
    secret: false,
    category: "core",
  },
  {
    name: "INITIAL_ADMIN_PASSWORD",
    description: "Initial admin password used to seed/log in the bootstrap admin.",
    secret: true,
    category: "core",
  },
]);

// Unique marker so seeded rows can never collide with real data and search
// terms can never match pre-existing rows.
const M = `t315x${Date.now().toString(36)}`;

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
};

type Ids = { a: string; b: string; aContact: string; bContact: string };

async function storageSearchIds(params: { nameIdSearch?: string; contactSearch?: string }): Promise<{
  paginated: string[];
  allContactIds: string[];
  exportIds: string[];
}> {
  const [pag, allIds, exp] = await Promise.all([
    storage.workers.getWorkersWithDetailsPaginated({ page: 1, pageSize: 100, ...params }),
    storage.workers.getAllMatchingContactIds(params),
    storage.workers.getWorkersForExport(params),
  ]);
  return {
    paginated: pag.data.map((w) => w.id).sort(),
    allContactIds: allIds.sort(),
    exportIds: exp.map((w) => w.id).sort(),
  };
}

async function main() {
  await loadComponentCache();

  // ---- Seed ------------------------------------------------------------
  // Worker A: name contains "<M>angela"; NO address/phone; email neutral.
  // Worker B: name "<M>bravo"; email contains "<M>bob"; phone 617555XXXX;
  //           address city contains "<M>angela" (the classic Los Angeles trap).
  const workerA = await storage.workers.createWorkerWithNameParts({
    given: `${M}angela`,
    family: `${M}smith`,
    displayName: `${M}angela ${M}smith`,
  });
  const workerB = await storage.workers.createWorkerWithNameParts({
    given: `${M}bravo`,
    family: `${M}jones`,
    displayName: `${M}bravo ${M}jones`,
  });
  await storage.workers.updateWorkerContactEmail(workerB.id, `${M}bob@example.test`);

  const phoneDigits = "6175550315";
  await storage.contacts.phoneNumbers.createPhoneNumber({
    contactId: workerB.contactId,
    phoneNumber: "(617) 555-0315",
    isPrimary: true,
    isActive: true,
  } as any);

  await storage.contacts.addresses.createContactPostal({
    contactId: workerB.contactId,
    street: `123 ${M}angela Ave`,
    city: `Los ${M}angela`,
    state: "CA",
    postalCode: "90315",
    country: "US",
    isPrimary: true,
    isActive: true,
  } as any);

  // Worker-ID types: one shown on lists (searchable), one not.
  const [shownType] = await db
    .insert(optionsWorkerIdType)
    .values({ name: `${M} Badge`, sequence: 9999, data: { showOnLists: true } })
    .returning();
  const [hiddenType] = await db
    .insert(optionsWorkerIdType)
    .values({ name: `${M} Hidden`, sequence: 9999, data: { showOnLists: false } })
    .returning();
  const widShown = await storage.workerIds.createWorkerId({
    workerId: workerB.id,
    typeId: shownType.id,
    value: `${M}badge77`,
  });
  const widHidden = await storage.workerIds.createWorkerId({
    workerId: workerA.id,
    typeId: hiddenType.id,
    value: `${M}hidden88`,
  });

  const freshA = await storage.workers.getWorker(workerA.id);
  const siriusA = String(freshA!.siriusId);

  const ids: Ids = { a: workerA.id, b: workerB.id, aContact: workerA.contactId, bContact: workerB.contactId };

  try {
    // ---- Storage-level assertions -------------------------------------
    const cases: Array<{
      label: string;
      params: { nameIdSearch?: string; contactSearch?: string };
      expectA: boolean;
      expectB: boolean;
    }> = [
      // Field isolation
      { label: "name term matches name (A), not B's address city", params: { nameIdSearch: `${M}angela` }, expectA: true, expectB: false },
      { label: "contact term matches address city (B), not A's name", params: { contactSearch: `${M}angela` }, expectA: false, expectB: true },
      { label: "contact term matches email (B) only", params: { contactSearch: `${M}bob` }, expectA: false, expectB: true },
      { label: "email term in Name/ID field matches nobody", params: { nameIdSearch: `${M}bob` }, expectA: false, expectB: false },
      { label: "name term in Contact field matches nobody", params: { contactSearch: `${M}bravo` }, expectA: false, expectB: false },
      // IDs in Name/ID
      { label: "Sirius ID matches in Name/ID (A)", params: { nameIdSearch: siriusA }, expectA: true, expectB: false },
      { label: "showOnLists worker-ID value matches in Name/ID (B)", params: { nameIdSearch: `${M}badge77` }, expectA: false, expectB: true },
      { label: "non-showOnLists worker-ID value does NOT match", params: { nameIdSearch: `${M}hidden88` }, expectA: false, expectB: false },
      { label: "worker-ID value in Contact field matches nobody", params: { contactSearch: `${M}badge77` }, expectA: false, expectB: false },
      // Phone digits in Contact
      { label: "formatted phone matches in Contact (B)", params: { contactSearch: "617-555-0315" }, expectA: false, expectB: true },
      { label: "bare phone digits match in Contact (B)", params: { contactSearch: phoneDigits }, expectA: false, expectB: true },
      // AND across fields
      { label: "nameId(A-name) AND contact(B-email) → empty", params: { nameIdSearch: `${M}angela`, contactSearch: `${M}bob` }, expectA: false, expectB: false },
      { label: "nameId(B-name) AND contact(B-email) → B", params: { nameIdSearch: `${M}bravo`, contactSearch: `${M}bob` }, expectA: false, expectB: true },
      { label: "nameId(B-name) AND contact(B-city) → B", params: { nameIdSearch: `${M}jones`, contactSearch: `${M}angela` }, expectA: false, expectB: true },
      // AND within a field
      { label: "two name terms both required (A)", params: { nameIdSearch: `${M}angela ${M}smith` }, expectA: true, expectB: false },
      { label: "mixed name terms across workers → empty", params: { nameIdSearch: `${M}angela ${M}jones` }, expectA: false, expectB: false },
      { label: "two contact terms both required (B)", params: { contactSearch: `${M}bob ${M}angela` }, expectA: false, expectB: true },
    ];

    for (const c of cases) {
      const r = await storageSearchIds(c.params);
      const hasA = r.paginated.includes(ids.a);
      const hasB = r.paginated.includes(ids.b);
      check(`storage: ${c.label}`, hasA === c.expectA && hasB === c.expectB, { hasA, hasB, ...c.params });

      // Parity: export returns the same worker set; all-ids returns the
      // matching contact ids for the same worker set.
      const exportSame = JSON.stringify(r.exportIds) === JSON.stringify(r.paginated);
      const expectedContacts = [
        ...(hasA ? [ids.aContact] : []),
        ...(hasB ? [ids.bContact] : []),
      ];
      const contactsOk = expectedContacts.every((cid) => r.allContactIds.includes(cid)) &&
        (!r.allContactIds.includes(ids.aContact) || hasA) &&
        (!r.allContactIds.includes(ids.bContact) || hasB);
      check(`storage parity (paginated=export, all-ids consistent): ${c.label}`, exportSame && contactsOk);
    }

    // ---- Route-level parity --------------------------------------------
    if (getEnvironmentVariable("SKIP_ROUTES") === "1") {
      console.log("SKIP route-level checks (SKIP_ROUTES=1)");
    } else {
      await routeChecks(ids, siriusA);
    }
  } finally {
    // ---- Cleanup --------------------------------------------------------
    try {
      await storage.workerIds.deleteWorkerId(widShown.id);
      await storage.workerIds.deleteWorkerId(widHidden.id);
      await db.delete(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, shownType.id));
      await db.delete(optionsWorkerIdType).where(eq(optionsWorkerIdType.id, hiddenType.id));
      await storage.workers.deleteWorker(workerA.id);
      await storage.workers.deleteWorker(workerB.id);
      await storage.contacts.deleteContact(workerA.contactId);
      await storage.contacts.deleteContact(workerB.contactId);
      console.log("cleanup: done");
    } catch (e) {
      console.error("cleanup FAILED — seeded rows may remain:", e);
      failures++;
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

async function routeChecks(ids: Ids, siriusA: string) {
  const base = "http://127.0.0.1:5000";
  // Login via the dev-default local provider as the seeded admin.
  const adminPassword = getEnvironmentVariable("INITIAL_ADMIN_PASSWORD");
  if (!adminPassword) {
    check("routes: INITIAL_ADMIN_PASSWORD available", false);
    return;
  }
  // Try EVERY user that has a local credential until the seeded admin
  // password works. getAllUsers() has no ordering guarantee and multiple
  // users may hold local credentials, so no candidate cap and no
  // first-created assumption. The three routes need worker.list access,
  // staff permission (all-ids + export), and authentication; require a
  // candidate that has staff (which the access policies build on) so an
  // authorization failure is reported as a precondition, not a search bug.
  const allUsers = await storage.users.getAllUsers();
  const candidates: any[] = [];
  for (const u of allUsers) {
    const ident = await storage.authIdentities.getByUserIdAndProvider(u.id, "local");
    if (ident?.passwordHash) candidates.push(u);
  }
  check("routes: at least one local credential exists", candidates.length > 0);
  if (candidates.length === 0) return;

  let cookie = "";
  let loggedInUser: any = null;
  try {
    for (const u of candidates) {
      // Only accounts with the permissions the routes require are usable;
      // skip others so a 403 later can't masquerade as a search regression.
      const [hasStaff, hasAdmin] = await Promise.all([
        storage.users.userHasPermission(u.id, "staff"),
        storage.users.userHasPermission(u.id, "admin"),
      ]);
      if (!hasStaff && !hasAdmin) continue;
      const loginRes = await fetch(`${base}/api/auth/local/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: u.email, password: adminPassword }),
      });
      if (loginRes.ok) {
        loggedInUser = u;
        cookie = (loginRes.headers.getSetCookie?.() ?? [loginRes.headers.get("set-cookie") ?? ""])
          .map((c) => c.split(";")[0])
          .filter(Boolean)
          .join("; ");
        break;
      }
    }
    check("routes: local login as staff/admin user succeeds (precondition)", cookie !== "");
    if (!cookie) return;
  } catch (e) {
    check("routes: dev server reachable on :5000", false, String(e));
    return;
  }

  // Authorization precondition: the session must reach all three routes
  // (200, not 401/403) before any search assertion is made against them.
  {
    const probes = await Promise.all([
      fetch(`${base}/api/workers/with-details/paginated?page=1&pageSize=1`, { headers: { cookie } }),
      fetch(`${base}/api/workers/with-details/all-ids?nameIdSearch=zz-precondition-probe`, { headers: { cookie } }),
      fetch(`${base}/api/workers/export?nameIdSearch=zz-precondition-probe`, { headers: { cookie } }),
    ]);
    const statuses = probes.map((r) => r.status);
    check(
      "routes: session authorized for paginated/all-ids/export (precondition)",
      statuses.every((s) => s === 200),
      { user: loggedInUser?.id, statuses },
    );
    if (!statuses.every((s) => s === 200)) return;
  }

  const get = (path: string) => fetch(`${base}${path}`, { headers: { cookie } });

  const routeCases: Array<{ label: string; qs: string; expectA: boolean; expectB: boolean }> = [
    { label: "nameIdSearch name term", qs: `nameIdSearch=${encodeURIComponent(`${M}angela`)}`, expectA: true, expectB: false },
    { label: "contactSearch address term", qs: `contactSearch=${encodeURIComponent(`${M}angela`)}`, expectA: false, expectB: true },
    { label: "nameIdSearch sirius id", qs: `nameIdSearch=${encodeURIComponent(siriusA)}`, expectA: true, expectB: false },
    { label: "both fields ANDed", qs: `nameIdSearch=${encodeURIComponent(`${M}bravo`)}&contactSearch=${encodeURIComponent(`${M}bob`)}`, expectA: false, expectB: true },
  ];

  for (const c of routeCases) {
    // Paginated
    const pagRes = await get(`/api/workers/with-details/paginated?page=1&pageSize=100&${c.qs}`);
    const pag = pagRes.ok ? await pagRes.json() : null;
    const pagIds: string[] = pag ? pag.data.map((w: any) => w.id) : [];
    const pagOk = pagRes.ok && pagIds.includes(ids.a) === c.expectA && pagIds.includes(ids.b) === c.expectB;
    check(`route paginated: ${c.label}`, pagOk, { status: pagRes.status });

    // All-ids (contact ids)
    const allRes = await get(`/api/workers/with-details/all-ids?${c.qs}`);
    const all = allRes.ok ? await allRes.json() : null;
    const cids: string[] = all ? all.contactIds : [];
    const allOk = allRes.ok && cids.includes(ids.aContact) === c.expectA && cids.includes(ids.bContact) === c.expectB;
    check(`route all-ids: ${c.label}`, allOk, { status: allRes.status });

    // Export CSV — check marker presence by worker display names.
    const expRes = await get(`/api/workers/export?${c.qs}`);
    const csv = expRes.ok ? (await expRes.text()).toLowerCase() : "";
    const csvHasA = csv.includes(`${M}smith`.toLowerCase());
    const csvHasB = csv.includes(`${M}jones`.toLowerCase());
    const expOk = expRes.ok && csvHasA === c.expectA && csvHasB === c.expectB;
    check(`route export: ${c.label}`, expOk, { status: expRes.status, csvHasA, csvHasB });
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
