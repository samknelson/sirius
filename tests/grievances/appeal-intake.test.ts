/**
 * S2 Appeals — grievance route integration tests.
 *
 * Covers:
 *   1. Component + authorization gating (appeal routes honour the same gates as
 *      ordinary grievance routes)
 *   2. Successful appeal creation: worker linked, appealMeta stored, status
 *      history written, response includes appeal data
 *   3. Input validation: missing/invalid fields each produce 400
 *   4. Reference validation: unknown worker / benefit / denial-reason / status
 *      each produce 400
 *   5. `kind=appeal` search filter returns only appeal grievances
 *   6. Benefits endpoint returns active benefits with provider name
 *   7. Ordinary (non-appeal) grievance creation is unaffected
 */
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerGrievanceRoutes } from "../../server/modules/grievances/grievances";
import { storage } from "../../server/storage";
import { getOptionsStorage } from "../../server/modules/options-registry";
import { updateComponentCache } from "../../server/services/component-cache";
// Import all grievance component migrations so the tables are present in the
// test database (they are idempotent and only create tables when absent).
import "../../scripts/migrate/components/grievance/001_create_options_grievance_status";
import "../../scripts/migrate/components/grievance/002_create_options_grievance_category";
import "../../scripts/migrate/components/grievance/003_create_grievances";
import "../../scripts/migrate/components/grievance/004_add_cardinality_to_grievances";
import "../../scripts/migrate/components/grievance/005_add_primary_to_grievance_workers";
import "../../scripts/migrate/components/grievance/006_add_class_description_to_grievances";
import "../../scripts/migrate/components/grievance/007_add_sirius_id_and_open_to_options_grievance_status";
import "../../scripts/migrate/components/grievance/008_add_sequence_to_options_grievance_status";
import "../../scripts/migrate/components/grievance/009_create_options_grievance_steps";
import "../../scripts/migrate/components/grievance/010_create_grievance_steps";
import "../../scripts/migrate/components/grievance/011_create_grievance_timeline_templates";
import "../../scripts/migrate/components/grievance/012_add_sequence_to_grievance_timeline_template_steps";
import "../../scripts/migrate/components/grievance/013_add_timeline_template_id_to_grievances";
import "../../scripts/migrate/components/grievance/014_create_options_grievance_complaints";
import "../../scripts/migrate/components/grievance/015_create_options_grievance_remedies";
import "../../scripts/migrate/components/grievance/016_create_grievance_complaints";
import "../../scripts/migrate/components/grievance/017_create_grievance_remedies";
import "../../scripts/migrate/components/grievance/018_drop_complaint_remedy_from_grievances";
import "../../scripts/migrate/components/grievance/019_create_options_grievance_roles";
import "../../scripts/migrate/components/grievance/020_create_grievance_users";
import "../../scripts/migrate/components/grievance/021_add_sirius_id_to_grievances";
import "../../scripts/migrate/components/grievance/022_create_grievance_name_denorm";
import "../../scripts/migrate/components/grievance/023_grievance_sirius_id_unique_constraint";
import "../../scripts/migrate/components/grievance/024_add_bargaining_unit_id_to_grievances";
import "../../scripts/migrate/components/grievance/025_make_grievance_sirius_id_not_null";
import "../../scripts/migrate/components/grievance/026_add_employer_contact_id_to_grievances";
import "../../scripts/migrate/components/grievance/027_create_grievance_status_history_drop_status_id";
import "../../scripts/migrate/components/grievance/028_replace_grievance_steps_with_denorm";
import "../../scripts/migrate/components/grievance/029_create_grievance_files";
import denialReasonMigration from "../../scripts/migrate/components/grievance/030_create_options_grievance_denial_reason";
import { getComponentMigrations } from "../../server/services/migration-runner";

// After all imports above run, the component migrations are registered and we
// can run them all in order inside beforeAll.

const run = `appeal-test-${Date.now()}`;

let base = "";
let closeServer: (() => Promise<void>) | undefined;
let workerId = "";
let staffId = "";
let categoryId = "";
let statusId = "";
let benefitId = "";
let denialReasonId = "";
// The deployment's real BAO component state, captured at file start and
// restored at file end. The non-BAO describes below require it off.
let fileOriginalBaoEnabled = false;

async function request(
  path: string,
  init: RequestInit & { user?: string; staff?: boolean } = {},
) {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (init.user) headers.set("x-user", init.user);
  if (init.staff === false) headers.set("x-staff", "0");
  if (init.body && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  // Run all registered grievance component migrations in order (each is
  // idempotent: they skip creation when the table already exists).
  const grievanceMigrations = getComponentMigrations("grievance").sort((a, b) => a.version - b.version);
  for (const mig of grievanceMigrations) {
    await mig.up();
  }

  // Ensure grievance component is enabled.
  await updateComponentCache("grievance", true);

  // Force a non-BAO baseline for the generic-grievance suites; the BAO
  // describe toggles it on for itself and returns to this baseline. The
  // deployment's original state is restored in the file-level afterAll.
  const componentsVariable = await storage.variables.getByName("components");
  fileOriginalBaoEnabled = Boolean((componentsVariable?.value as any)?.["sitespecific.bao"]);
  await updateComponentCache("sitespecific.bao", false);

  // Resolve prerequisites from the real database.
  const allWorkers = await storage.workers.getAllWorkers();
  const allStaff = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
  if (!allWorkers[0] || !allStaff[0]) {
    throw new Error("appeal-intake.test: prerequisites unavailable — need at least one worker and one staff user");
  }
  workerId = allWorkers[0].id;
  staffId = allStaff[0].id;

  const options = getOptionsStorage();
  categoryId = (await options.create("grievance-category", { name: `${run}-cat` })).id;
  statusId = (await options.create("grievance-status", { name: `${run}-status`, isOpen: true })).id;
  denialReasonId = (await options.create("grievance-denial-reason", { name: `${run}-denial-reason` })).id;

  // Create an active trust benefit. We use the raw options storage rather than
  // the trust-benefit storage so the test doesn't need the trust component
  // enabled — the appeal route only needs the row to exist.
  const { db } = await import("../../server/db");
  const { sql } = await import("drizzle-orm");
  // Insert an active trust_benefit row directly.
  const benefitResult = await db.execute(
    sql`INSERT INTO trust_benefits (id, name, is_active)
        VALUES (gen_random_uuid(), ${`${run}-benefit`}, true)
        RETURNING id`,
  );
  const benefit = benefitResult.rows?.[0];
  if (!benefit) throw new Error("appeal-intake.test: failed to insert test benefit");
  benefitId = (benefit as any).id as string;

  // Build the express app.
  const app = express();
  app.use(express.json());

  const requireAuth: any = (req: any, res: any, next: any) => {
    if (!req.header("x-user"))
      return res.status(401).json({ message: "auth required" });
    // Minimal session needed for buildContext / masquerade check.
    req.session = { masqueradeUserId: req.header("x-user") };
    next();
  };
  const requireAccess: any =
    () => (req: any, res: any, next: any) =>
      req.header("x-staff") === "0"
        ? res.status(403).json({ message: "staff required" })
        : next();

  registerGrievanceRoutes(app, requireAuth, requireAccess);

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () =>
    new Promise((resolve, reject) =>
      server.close((e: Error) => (e ? reject(e) : resolve())),
    );
});

afterAll(async () => {
  await closeServer?.();
  // Restore the deployment's real BAO state (shared dev database).
  await updateComponentCache("sitespecific.bao", fileOriginalBaoEnabled).catch(() => {});
  const options = getOptionsStorage();
  await options.delete("grievance-category", categoryId).catch(() => {});
  await options.delete("grievance-status", statusId).catch(() => {});
  await options.delete("grievance-denial-reason", denialReasonId).catch(() => {});
  // Remove the test benefit row.
  if (benefitId) {
    const { db } = await import("../../server/db");
    const { sql } = await import("drizzle-orm");
    await db
      .execute(sql`DELETE FROM trust_benefits WHERE id = ${benefitId}`)
      .catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// 1. Authorization / component gating
// ---------------------------------------------------------------------------

describe("appeal route authorization", () => {
  it("rejects unauthenticated requests to the appeal intake endpoint", async () => {
    const res = await request("/api/grievances/appeal", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects non-staff authenticated requests", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      staff: false,
    });
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests to the appeal/benefits endpoint", async () => {
    const res = await request("/api/grievances/appeal/benefits");
    expect(res.status).toBe(401);
  });

  it("disabling the grievance component blocks appeal routes", async () => {
    await updateComponentCache("grievance", false);
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId, statusId, workerId, benefitId, denialReasonId,
      }),
    });
    expect(res.status).toBe(403);
    await updateComponentCache("grievance", true);
  });
});

// ---------------------------------------------------------------------------
// 2. Successful appeal creation
// ---------------------------------------------------------------------------

describe("successful appeal creation", () => {
  it("creates an individual grievance with appealMeta and links the worker", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, statusId, workerId, benefitId, denialReasonId }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    // The grievance is an individual appeal.
    expect(body.cardinality).toBe("individual");

    // Appeal metadata is stored in data.appealMeta.
    expect(body.data?.appealMeta?.kind).toBe("appeal");
    expect(body.data?.appealMeta?.benefitId).toBe(benefitId);
    expect(body.data?.appealMeta?.denialReasonId).toBe(denialReasonId);

    // The worker is linked.
    const workers = body.workers ?? [];
    expect(workers.some((w: any) => w.workerId === workerId)).toBe(true);

    // The grievance is returned with a category.
    expect(body.categoryId).toBe(categoryId);

    // The grievance has an id that can be fetched.
    const fetchRes = await request(`/api/grievances/${body.id}`, { user: staffId });
    expect(fetchRes.status).toBe(200);
    const fetched = await fetchRes.json();
    expect(fetched.data?.appealMeta?.kind).toBe("appeal");
  }, 20_000);
});

// ---------------------------------------------------------------------------
// 3. Input validation
// ---------------------------------------------------------------------------

describe("appeal intake input validation", () => {
  it("rejects missing required fields", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-UUID benefitId", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId, statusId, workerId,
        benefitId: "not-a-uuid",
        denialReasonId,
      }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-UUID denialReasonId", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId, statusId, workerId, benefitId,
        denialReasonId: "not-a-uuid",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 4. Reference validation
// ---------------------------------------------------------------------------

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

describe("appeal intake reference validation", () => {
  it("returns 400 when worker does not exist", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId, statusId,
        workerId: ZERO_UUID,
        benefitId, denialReasonId,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/worker/i);
  });

  it("returns 400 when benefit does not exist", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId, statusId, workerId,
        benefitId: ZERO_UUID,
        denialReasonId,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/benefit/i);
  });

  it("returns 400 when denial reason does not exist", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId, statusId, workerId, benefitId,
        denialReasonId: ZERO_UUID,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/denial reason/i);
  });

  it("returns 400 when status does not exist", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({
        categoryId,
        statusId: ZERO_UUID,
        workerId, benefitId, denialReasonId,
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/status/i);
  });
});

// ---------------------------------------------------------------------------
// 5. kind=appeal search filter
// ---------------------------------------------------------------------------

describe("kind=appeal search filter", () => {
  it("returns only appeal grievances when kind=appeal is specified", async () => {
    // Create one appeal.
    const appealRes = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, statusId, workerId, benefitId, denialReasonId }),
    });
    expect(appealRes.status).toBe(201);
    const appeal = await appealRes.json();

    // Create a plain grievance.
    const plainRes = await request("/api/grievances", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, cardinality: "individual" }),
    });
    expect(plainRes.status).toBe(201);
    const plain = await plainRes.json();

    // Search with kind=appeal.
    const filterRes = await request("/api/grievances?kind=appeal", { user: staffId });
    expect(filterRes.status).toBe(200);
    const filtered = await filterRes.json();
    const ids = filtered.map((g: any) => g.id);
    expect(ids).toContain(appeal.id);
    expect(ids).not.toContain(plain.id);

    // Search without filter returns both.
    const allRes = await request("/api/grievances", { user: staffId });
    const all = await allRes.json();
    const allIds = all.map((g: any) => g.id);
    expect(allIds).toContain(appeal.id);
    expect(allIds).toContain(plain.id);
  }, 20_000);
});

// ---------------------------------------------------------------------------
// 6. /appeal/benefits endpoint
// ---------------------------------------------------------------------------

describe("appeal/benefits endpoint", () => {
  it("returns active benefits with provider name fields", async () => {
    const res = await request("/api/grievances/appeal/benefits", { user: staffId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Our test benefit should be in the list.
    const found = body.find((b: any) => b.id === benefitId);
    expect(found).toBeDefined();
    expect(typeof found.name).toBe("string");
    // providerName may be null when no provider is linked — that's OK.
    expect("providerName" in found).toBe(true);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// 7. Ordinary grievance creation is unaffected
// ---------------------------------------------------------------------------

describe("ordinary grievance creation unaffected", () => {
  it("can still create a plain individual grievance without appeal fields", async () => {
    const res = await request("/api/grievances", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, cardinality: "individual" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    // Must NOT have appealMeta.
    expect(body.data?.appealMeta).toBeUndefined();
  }, 10_000);
});

// ---------------------------------------------------------------------------
// 8. Current-status refresh (server side of the edit-card sync)
// ---------------------------------------------------------------------------

describe("current status refresh after status-history write", () => {
  it("detail and list reflect the newly current status immediately", async () => {
    // Create an appeal (non-BAO path: explicit statusId).
    const createRes = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, statusId, workerId, benefitId, denialReasonId }),
    });
    expect(createRes.status).toBe(201);
    const appeal = await createRes.json();

    // Add a second, newer status via the status-history endpoint (the same
    // call the edit card's Save makes — server stamps "now").
    const options = getOptionsStorage();
    const second = await options.create("grievance-status", {
      name: `${run}-status-refresh`,
      isOpen: false,
    });
    try {
      const histRes = await request(`/api/grievances/${appeal.id}/status-history`, {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ statusId: second.id }),
      });
      expect(histRes.status).toBe(201);

      // Detail endpoint now reports the new current status.
      const detail = await (await request(`/api/grievances/${appeal.id}`, { user: staffId })).json();
      expect(detail.statusId).toBe(second.id);
      expect(detail.statusName).toBe(`${run}-status-refresh`);

      // List endpoint also reflects it.
      const list = await (await request(`/api/grievances?kind=appeal`, { user: staffId })).json();
      const row = list.find((g: any) => g.id === appeal.id);
      expect(row?.statusId).toBe(second.id);

      // History has both entries and the newest is current.
      const history = await (
        await request(`/api/grievances/${appeal.id}/status-history`, { user: staffId })
      ).json();
      const current = history.find((h: any) => h.isCurrent);
      expect(current?.statusId).toBe(second.id);
      expect(history.filter((h: any) => h.statusId === statusId).length).toBe(1);
    } finally {
      await options.delete("grievance-status", second.id).catch(() => {});
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------
// 9. BAO appeal-only mode
// ---------------------------------------------------------------------------

describe("BAO appeal-only mode", () => {
  const BAO = "sitespecific.bao";
  const VARIABLE = "sitespecific.bao.appeal_workflow";
  let submittedStatusId = "";
  let closedStatusId = "";
  let stepOptionId = "";
  let templateId = "";
  let variableId = "";
  let originalBaoEnabled = false;
  let stashedSettings: unknown = null;
  let stashedSettingsId = "";

  beforeAll(async () => {
    // Capture the deployment's real BAO state so we can restore it — this
    // suite runs against the shared dev database and must not clobber it.
    const componentsVariable = await storage.variables.getByName("components");
    originalBaoEnabled = Boolean((componentsVariable?.value as any)?.[BAO]);

    // Stash any real appeal-workflow settings so the "missing settings" test
    // starts from a clean slate; restored in afterAll.
    const existingSettings = await storage.variables.getByName(VARIABLE);
    if (existingSettings) {
      stashedSettings = existingSettings.value;
      stashedSettingsId = existingSettings.id;
      await storage.variables.delete(existingSettings.id);
    }

    const options = getOptionsStorage();
    submittedStatusId = (
      await options.create("grievance-status", { name: `${run}-submitted`, isOpen: true })
    ).id;
    closedStatusId = (
      await options.create("grievance-status", { name: `${run}-closed`, isOpen: false })
    ).id;
    stepOptionId = (
      await options.create("grievance-step", { name: `${run}-step`, actor: "union" })
    ).id;

    const template = await storage.grievanceTimelineTemplates.create({
      title: `${run}-appeal-template`,
    } as any);
    templateId = template.id;
    await storage.grievanceTimelineTemplates.createStep({
      templateId,
      stepId: stepOptionId,
      fromStatuses: [submittedStatusId],
      toStatuses: [closedStatusId],
      days: 30,
      dayType: "calendar",
    } as any);

    await updateComponentCache(BAO, true);
  });

  afterAll(async () => {
    // Always restore the deployment's original state: these tests run
    // against the shared dev database.
    await updateComponentCache(BAO, originalBaoEnabled);
    if (variableId) await storage.variables.delete(variableId).catch(() => {});
    if (stashedSettingsId) {
      // Restore the deployment's real appeal-workflow settings.
      await storage.variables
        .create({ name: VARIABLE, value: stashedSettings } as any)
        .catch(() => {});
    }
    if (templateId) await storage.grievanceTimelineTemplates.delete(templateId).catch(() => {});
    const options = getOptionsStorage();
    await options.delete("grievance-step", stepOptionId).catch(() => {});
    await options.delete("grievance-status", submittedStatusId).catch(() => {});
    await options.delete("grievance-status", closedStatusId).catch(() => {});
  });

  it("rejects generic grievance creation with 403", async () => {
    const res = await request("/api/grievances", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, cardinality: "individual" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/appeal-only/i);
  });

  it("refuses appeal intake with an actionable error when settings are missing", async () => {
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, workerId, benefitId, denialReasonId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/appeal workflow settings/i);
  });

  it("applies the configured initial status and timeline template to new appeals", async () => {
    const variable = await storage.variables.create({
      name: VARIABLE,
      value: { initialStatusId: submittedStatusId, timelineTemplateId: templateId },
    } as any);
    variableId = variable.id;

    // No statusId in the body: the configuration supplies it.
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, workerId, benefitId, denialReasonId }),
    });
    expect(res.status).toBe(201);
    const appeal = await res.json();

    // Configured Submitted status became the current status via history.
    const detail = await (await request(`/api/grievances/${appeal.id}`, { user: staffId })).json();
    expect(detail.statusId).toBe(submittedStatusId);
    expect(detail.timelineTemplateId).toBe(templateId);
    expect(detail.data?.appealMeta?.kind).toBe("appeal");

    const history = await (
      await request(`/api/grievances/${appeal.id}/status-history`, { user: staffId })
    ).json();
    expect(history.length).toBe(1);
    expect(history[0].statusId).toBe(submittedStatusId);
    expect(history[0].isCurrent).toBe(true);

    // Timeline computation: the plugin derives a started (uncompleted) step
    // occurrence from the appeal's status history + assigned template.
    const { grievanceTimelinePlugin } = await import(
      "../../server/plugins/system/denorm/plugins/grievanceTimeline"
    );
    const payload = await grievanceTimelinePlugin.compute(appeal.id);
    expect(payload.rows.length).toBe(1);
    const rowStep = payload.rows[0];
    expect(rowStep.stepId).toBe(stepOptionId);
    expect(rowStep.completedYmd).toBeNull();
    expect(rowStep.isCurrent).toBe(true);
    // Due date = started + 30 calendar days.
    const started = new Date(`${rowStep.startedYmd}T00:00:00Z`);
    const due = new Date(`${rowStep.dueYmd}T00:00:00Z`);
    expect((due.getTime() - started.getTime()) / 86_400_000).toBe(30);
  }, 30_000);

  it("stale configuration (deleted template) yields an actionable conflict", async () => {
    // Point the settings at a template that no longer exists.
    await storage.variables.update(variableId, {
      value: {
        initialStatusId: submittedStatusId,
        timelineTemplateId: ZERO_UUID,
      },
    } as any);
    const res = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, workerId, benefitId, denialReasonId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/timeline template/i);
    // Restore valid settings.
    await storage.variables.update(variableId, {
      value: { initialStatusId: submittedStatusId, timelineTemplateId: templateId },
    } as any);
  });

  it("worker-scoped list with kind=appeal hides legacy generic grievances", async () => {
    // A legacy generic grievance can predate BAO enablement. Create one via
    // the generic route with BAO briefly off (the route is 403 in BAO mode).
    await updateComponentCache(BAO, false);
    const legacyRes = await request("/api/grievances", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, cardinality: "individual" }),
    });
    expect(legacyRes.status).toBe(201);
    const legacy = await legacyRes.json();
    const linkRes = await request(`/api/grievances/${legacy.id}/workers`, {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ workerId }),
    });
    expect(linkRes.status).toBe(201);
    await updateComponentCache(BAO, true);

    // An appeal for the same worker via the BAO intake path.
    const appealRes = await request("/api/grievances/appeal", {
      method: "POST",
      user: staffId,
      body: JSON.stringify({ categoryId, workerId, benefitId, denialReasonId }),
    });
    expect(appealRes.status).toBe(201);
    const appeal = await appealRes.json();

    // The worker tab's BAO query (workerId + kind=appeal) shows only appeals.
    const filtered = await (
      await request(`/api/grievances?workerId=${workerId}&kind=appeal`, { user: staffId })
    ).json();
    expect(filtered.some((g: any) => g.id === appeal.id)).toBe(true);
    expect(filtered.some((g: any) => g.id === legacy.id)).toBe(false);

    // Without the kind filter the legacy record is still reachable (data is
    // hidden from the appeal surface, not lost).
    const unfiltered = await (
      await request(`/api/grievances?workerId=${workerId}`, { user: staffId })
    ).json();
    expect(unfiltered.some((g: any) => g.id === legacy.id)).toBe(true);
  }, 30_000);

  it("non-BAO behavior is restored when the component is disabled", async () => {
    await updateComponentCache(BAO, false);
    try {
      // Generic creation works again.
      const generic = await request("/api/grievances", {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ categoryId, cardinality: "individual" }),
      });
      expect(generic.status).toBe(201);

      // Appeal intake requires an explicit statusId again.
      const noStatus = await request("/api/grievances/appeal", {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ categoryId, workerId, benefitId, denialReasonId }),
      });
      expect(noStatus.status).toBe(400);

      const withStatus = await request("/api/grievances/appeal", {
        method: "POST",
        user: staffId,
        body: JSON.stringify({ categoryId, statusId, workerId, benefitId, denialReasonId }),
      });
      expect(withStatus.status).toBe(201);
      const appeal = await withStatus.json();
      // No template auto-assignment outside BAO mode.
      expect(appeal.timelineTemplateId ?? null).toBeNull();
    } finally {
      await updateComponentCache(BAO, true);
    }
  }, 30_000);
});
