/**
 * Development-only, rollback-only fixture:
 * RUN_WORKER_DIRECTORY_DB=1 npx vitest run tests/workers/worker-directory-db.test.ts
 * Exercises the real PostgreSQL predicate and all three storage entry points.
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { normalizeWorkerDirectoryFilters } from "@shared/worker-directory-filters";

const { flags } = vi.hoisted(() => ({ flags: new Set(["bargainingunits", "cardcheck"]) }));
vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  isComponentEnabledSync: (id: string) => flags.has(id),
}));
import { createWorkerStorage, type WorkersPaginationParams, type WorkerExportCursor } from "../../server/storage/workers";
import { createWorkerIdStorage } from "../../server/storage/workers/ids";
import { createBtuTerritoriesStorage } from "../../server/storage/sitespecific/btu/territories";
import { getClient, runInTransaction } from "../../server/storage/transaction-context";
import { pool } from "../../server/storage/db";

const enabled = process.env.RUN_WORKER_DIRECTORY_DB === "1";
const rollback = Symbol("rollback directory fixture");

describe.skipIf(!enabled)("directory PostgreSQL population parity", () => {
  it("scopes latest employment, leave, worker-wide status, bargaining units and list IDs consistently", async () => {
    const prefix = `directory-fixture-${crypto.randomUUID()}`;
    const id = (suffix: string) => `${prefix}-${suffix}`;
    const store = createWorkerStorage({} as any);
    try {
      await runInTransaction(async () => {
        const db = getClient();
        await db.execute(sql`INSERT INTO employers(id, name) VALUES (${id("A")}, 'Fixture A'), (${id("B")}, 'Fixture B')`);
        await db.execute(sql`INSERT INTO options_employment_status(id,name,code,employed)
          VALUES (${id("employed")},'Not a hardcoded active name',${id("code-active")},true),
            (${id("leave")},'Fixture leave',${id("code-leave")},true),
            (${id("terminated")},'Fixture terminated',${id("code-term")},false)`);
        await db.execute(sql`INSERT INTO bargaining_units(id,sirius_id,name) VALUES (${id("unit")},${id("unit-code")},'Fixture unit')`);
        const labels = ["A-current-B-terminated", "B-leave", "B-old-active", "wA-none", "unit-only"];
        for (const label of labels) {
          await db.execute(sql`INSERT INTO contacts(id,display_name,given,family)
            VALUES (${id(label)},${prefix + " " + label},'Fixture',${label})`);
          await db.execute(sql`INSERT INTO workers(id,contact_id,sirius_id,bargaining_unit_id)
            VALUES (${id(label)},${id(label)},NULL,${label === "unit-only" || label === "B-leave" ? id("unit") : null})`);
        }
        const hours = async (worker: string, employer: string, status: string, month: number) => {
          await db.execute(sql`INSERT INTO worker_hours(year,month,day,worker_id,employer_id,employment_status_id,hours)
            VALUES (2026,${month},1,${id(worker)},${id(employer)},${id(status)},8)`);
        };
        await hours(labels[0], "A", "employed", 2);
        await hours(labels[0], "B", "employed", 1);
        await hours(labels[0], "B", "terminated", 2);
        await hours(labels[1], "B", "leave", 2);
        await hours(labels[2], "B", "employed", 1);
        await hours(labels[2], "B", "terminated", 2);
        await hours(labels[3], "A", "employed", 2);

        await db.execute(sql`INSERT INTO plugin_configs(id,plugin_kind,plugin_id) VALUES (${id("config")},'denorm','fixture')`);
        await db.execute(sql`INSERT INTO denorm(id,entity_id,entity_type,config_id,status)
          VALUES (${id("denorm")},${id(labels[0])},'worker',${id("config")},'ok')`);
        await db.execute(sql`INSERT INTO options_worker_ws(id,name,data) VALUES (${id("ws")},'Fixture active','{"isActive":true}')`);
        await db.execute(sql`INSERT INTO worker_wsh_denorm(denorm_id,worker_id,ws_id)
          VALUES (${id("denorm")},${id(labels[0])},${id("ws")})`);
        await db.execute(sql`INSERT INTO options_industries(id,name) VALUES (${id("industry")},'Fixture industry')`);
        await db.execute(sql`INSERT INTO options_worker_ms(id,name,industry_id) VALUES (${id("ms")},'Fixture member',${id("industry")})`);
        await db.execute(sql`INSERT INTO worker_msh_denorm(denorm_id,worker_id,ms_id)
          VALUES (${id("denorm")},${id(labels[0])},${id("ms")})`);

        const parity = async (filters: WorkersPaginationParams, expected: string[]) => {
          const params = { nameIdSearch: prefix, ...filters };
          const page = await store.getWorkersWithDetailsPaginated({ ...params, page: 1, pageSize: 100 });
          const ids = await store.getAllMatchingContactIds(params);
          const exported: string[] = [];
          let cursor: WorkerExportCursor | null = null;
          do {
            const batch = await store.getWorkersForExportBatch(params, cursor, 1);
            exported.push(...batch.rows.map(row => row.id));
            cursor = batch.nextCursor;
          } while (cursor);
          const expectedIds = expected.map(id).sort();
          expect(page.total).toBe(expected.length);
          expect(page.data.map(row => row.id).sort()).toEqual(expectedIds);
          expect(ids.sort()).toEqual(expectedIds);
          expect(exported.sort()).toEqual(expectedIds);
          expect(page.data.every(row => !("ssn" in row))).toBe(true);
        };
        await parity({ employerIds: [id("B")], employmentMode: "current" }, [labels[1]]);
        await parity({ employerIds: [id("A"), id("B")], employmentMode: "current" }, [labels[0], labels[1], labels[3]]);
        await parity({ employerIds: [id("B")], employmentMode: "ever" }, labels.slice(0, 3));
        await parity({ employerId: id("B") }, labels.slice(0, 3));
        await parity({ employerIds: [id("B")], employmentMode: "custom", employmentStatusIds: [id("terminated")] }, [labels[0], labels[2]]);
        await parity({ employerIds: [id("B")], employmentMode: "current", workStatusActive: "yes" }, []);
        await parity({ workStatusIds: [id("ws")] }, [labels[0]]);
        await parity({ workStatusActive: "no" }, labels.slice(1));
        await parity({ memberStatusIds: [id("ms")] }, [labels[0]]);
        // The archive's wA-none failure was a singular-input fixture calling
        // an array-only storage API. Both spellings must narrow, not widen.
        await parity({ bargainingUnitId: id("unit") }, [labels[1], labels[4]]);
        await parity({ bargainingUnitIds: [id("unit")] }, [labels[1], labels[4]]);
        await parity({ bargainingUnitIds: ["none"] }, [labels[0], labels[2], labels[3]]);
        await parity(normalizeWorkerDirectoryFilters({ employerIds: [], employmentMode: "current", employmentStatusIds: [id("leave")] }), labels);
        flags.delete("bargainingunits");
        flags.delete("cardcheck");
        await parity({ bargainingUnitIds: [id("unit")], memberStatusIds: [id("ms")], benefitIds: ["disabled"], representativeIds: ["disabled"] }, labels);
        flags.add("bargainingunits");
        flags.add("cardcheck");

        // Optional feature fixtures are transaction-local where the deployment
        // has not installed those component tables. Never enable components.
        await db.execute(sql`CREATE TEMP TABLE worker_steward_assignments (worker_id varchar) ON COMMIT DROP`);
        await db.execute(sql`CREATE TEMP TABLE btu_territory_workers (worker_id varchar, territory_id varchar) ON COMMIT DROP`);
        await db.execute(sql`CREATE TEMP TABLE btu_territory_reps (territory_id varchar, contact_id varchar) ON COMMIT DROP`);
        await db.execute(sql`CREATE TEMP TABLE sitespecific_btu_political_worker_reps (worker_id varchar, official_id varchar) ON COMMIT DROP`);
        await db.execute(sql`INSERT INTO worker_steward_assignments VALUES (${id(labels[0])})`);
        await db.execute(sql`INSERT INTO contacts(id,display_name) VALUES (${id("rep")},'Fixture field representative')`);
        await db.execute(sql`INSERT INTO btu_territory_workers VALUES (${id(labels[1])},${id("territory")})`);
        await db.execute(sql`INSERT INTO btu_territory_reps VALUES (${id("territory")},${id("rep")})`);
        await db.execute(sql`INSERT INTO btu_territory_reps VALUES (${id("other-territory")},${id("rep")})`);
        expect(await createBtuTerritoriesStorage().getFieldRepOptions()).toEqual([{ id: id("rep"), name: "Fixture field representative" }]);
        await db.execute(sql`INSERT INTO sitespecific_btu_political_worker_reps VALUES (${id(labels[2])},${id("official")})`);
        flags.add("worker.steward");
        flags.add("sitespecific.btu");
        flags.add("sitespecific.btu.political");
        await parity({ isSteward: "yes" }, [labels[0]]);
        await parity({ isSteward: "no" }, labels.slice(1));
        await parity({ fieldRepIds: [id("rep")] }, [labels[1]]);
        await parity({ representativeIds: [id("official")] }, [labels[2]]);
        await parity({ employerIds: [id("B")], employmentMode: "current", fieldRepIds: [id("rep")], isSteward: "no" }, [labels[1]]);
        flags.delete("worker.steward");
        flags.delete("sitespecific.btu");
        flags.delete("sitespecific.btu.political");
        await parity({ isSteward: "yes", fieldRepIds: [id("rep")], representativeIds: [id("official")] }, labels);

        await db.execute(sql`INSERT INTO trust_benefits(id,name) VALUES (${id("benefit")},'Fixture benefit'), (${id("benefit2")},'Fixture second benefit')`);
        const now = new Date();
        await db.execute(sql`INSERT INTO trust_wmb(worker_id,employer_id,benefit_id,month,year)
          VALUES (${id(labels[1])},${id("B")},${id("benefit")},${now.getMonth() + 1},${now.getFullYear()}),
            (${id(labels[2])},${id("B")},${id("benefit2")},${now.getMonth() + 1},${now.getFullYear()})`);
        flags.add("trust.benefits");
        await parity({ benefitIds: [id("benefit"), id("benefit2")] }, [labels[1], labels[2]]);
        await parity({ benefitIds: [id("benefit")], employerIds: [id("B")], employmentMode: "current" }, [labels[1]]);
        flags.delete("trust.benefits");

        const types = [
          { name: "Fixture second", sequence: 2, enabled: true },
          { name: "Fixture first", sequence: 1, enabled: true },
          { name: "Fixture hidden", sequence: 0, enabled: false },
        ];
        for (let index = 0; index < types.length; index++) {
          const type = types[index];
          await db.execute(sql`INSERT INTO options_worker_id_type(id,name,sequence,data)
            VALUES (${id("type" + index)},${type.name},${type.sequence},${JSON.stringify({ showOnLists: type.enabled })}::jsonb)`);
          await db.execute(sql`INSERT INTO worker_ids(worker_id,type_id,value)
            VALUES (${id(labels[0])},${id("type" + index)},${id("value" + index)})`);
        }
        const idsStore = createWorkerIdStorage();
        const configured = (await idsStore.getShowOnListsIdTypes()).filter(type => type.id.startsWith(prefix));
        expect(configured.map(type => type.name)).toEqual(["Fixture first", "Fixture second"]);
        const values = await idsStore.getWorkerIdsForListByWorkerIds([id(labels[0])]);
        expect(values).toHaveLength(2);
        expect(values.every(value => value.workerId === id(labels[0]) && value.typeId !== id("type2"))).toBe(true);
        expect(await idsStore.getWorkerIdsForListByWorkerIds([id(labels[1])])).toEqual([]);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await pool.end();
    }
  });
});
