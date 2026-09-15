/**
 * DB-backed lifecycle coverage for the deferred worker benefit role history.
 * The fixture uses uniquely named rows and removes every row it creates, so it
 * can run against the integration database alongside the rest of the suite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import {
  contacts,
  denorm,
  employers,
  optionsWorkerRelationType,
  pluginConfigs,
  trustBenefits,
  trustWmb,
  workerBenefitRoleHistoryDenorm,
  workerRelations,
  workers,
} from "@shared/schema";
import { loadComponentCache } from "../../server/services/component-cache";
import { runInTransaction } from "../../server/storage/transaction-context";
import { applyComputed } from "../../server/plugins/system/denorm/apply";
import { getDenormPlugin } from "../../server/plugins/system/denorm/registry";
import "../../server/plugins/system/denorm/plugins/workerBenefitRoleHistory";

const run = `worker-benefit-role-history-${Date.now()}`;
const workerIds: string[] = [];
const contactIds: string[] = [];
let benefitId = "";
let employerId = "";
let relationTypeId = "";
let configId = "";
let createdConfigId: string | null = null;

async function worker(name: string): Promise<string> {
  const row = await storage.workers.createWorker(`${run} ${name}`);
  workerIds.push(row.id);
  const [stored] = await db
    .select({ contactId: workers.contactId })
    .from(workers)
    .where(eq(workers.id, row.id));
  contactIds.push(stored.contactId);
  return row.id;
}

async function payload(workerId: string) {
  const [row] = await db
    .select()
    .from(workerBenefitRoleHistoryDenorm)
    .where(eq(workerBenefitRoleHistoryDenorm.workerId, workerId));
  return row;
}

async function status(workerId: string) {
  const [row] = await db
    .select()
    .from(denorm)
    .where(and(eq(denorm.configId, configId), eq(denorm.entityId, workerId)));
  return row;
}

async function drain(): Promise<void> {
  // Claim exactly this test's fixtures. A shared singleton config may have an
  // unrelated corrective backlog, so the generic oldest-N sweep is not a
  // deterministic test harness.
  const plugin = getDenormPlugin("worker-benefit-role-history")!;
  for (const workerId of workerIds) {
    const claim = await storage.denorm.claimStaleForEntity(
      { entityId: workerId, configId },
      randomUUID(),
    );
    if (!claim) continue;
    const computed = await plugin.compute(workerId);
    await applyComputed(
      plugin,
      configId,
      workerId,
      computed,
      claim.generation,
      claim.claimToken,
    );
  }
}

beforeAll(async () => {
  await loadComponentCache();
  const [benefit] = await db
    .insert(trustBenefits)
    .values({ name: `${run} benefit`, siriusId: `${run}-benefit` })
    .returning();
  benefitId = benefit.id;
  const [employer] = await db
    .insert(employers)
    .values({ name: `${run} employer`, siriusId: `${run}-employer`, isActive: true })
    .returning();
  employerId = employer.id;
  const [relationType] = await db
    .insert(optionsWorkerRelationType)
    .values({ name: `${run} relation type`, siriusId: `${run}-relation-type` })
    .returning();
  relationTypeId = relationType.id;

  const existing = await db
    .select({ id: pluginConfigs.id })
    .from(pluginConfigs)
    .where(
      and(
        eq(pluginConfigs.pluginKind, "denorm"),
        eq(pluginConfigs.pluginId, "worker-benefit-role-history"),
      ),
    )
    .limit(1);
  if (existing[0]) {
    configId = existing[0].id;
  } else {
    const [config] = await db
      .insert(pluginConfigs)
      .values({
        pluginKind: "denorm",
        pluginId: "worker-benefit-role-history",
        enabled: true,
        name: `${run} role history`,
        data: {},
      })
      .returning();
    configId = config.id;
    createdConfigId = config.id;
  }
});

afterAll(async () => {
  if (workerIds.length) {
    await db
      .delete(denorm)
      .where(and(eq(denorm.configId, configId), inArray(denorm.entityId, workerIds)));
    await db.delete(trustWmb).where(inArray(trustWmb.workerId, workerIds));
    await db
      .delete(workerRelations)
      .where(
        and(
          inArray(workerRelations.worker1, workerIds),
          inArray(workerRelations.worker2, workerIds),
        ),
      );
    await db.delete(workers).where(inArray(workers.id, workerIds));
  }
  if (contactIds.length) {
    await db.delete(contacts).where(inArray(contacts.id, contactIds));
  }
  if (createdConfigId) {
    await db.delete(pluginConfigs).where(eq(pluginConfigs.id, createdConfigId));
  }
  if (relationTypeId) {
    await db.delete(optionsWorkerRelationType).where(eq(optionsWorkerRelationType.id, relationTypeId));
  }
  if (employerId) await db.delete(employers).where(eq(employers.id, employerId));
  if (benefitId) await db.delete(trustBenefits).where(eq(trustBenefits.id, benefitId));
});

describe("worker benefit role history denorm", () => {
  it("derives own, grantor, dependent, both, backdated, and deleted-role history", async () => {
    const subscriber = await worker("subscriber");
    const dependent = await worker("dependent");
    const upstreamSubscriber = await worker("upstream-subscriber");
    const subscriberToDependent = await storage.workerRelations.create({
      worker1: subscriber,
      worker2: dependent,
      relationType: relationTypeId,
      startYmd: "2020-01-01",
      endYmd: null,
    });
    const upstreamToSubscriber = await storage.workerRelations.create({
      worker1: upstreamSubscriber,
      worker2: subscriber,
      relationType: relationTypeId,
      startYmd: "2020-01-01",
      endYmd: null,
    });

    await storage.trust.wmb.createWorkerBenefit({
      workerId: subscriber, employerId, benefitId, year: 2024, month: 6,
    });
    await storage.trust.wmb.createWorkerBenefit({
      workerId: dependent, employerId, benefitId, year: 2023, month: 12,
      sourceRelationId: subscriberToDependent.id,
    });
    await storage.trust.wmb.createWorkerBenefit({
      workerId: subscriber, employerId, benefitId, year: 2024, month: 1,
      sourceRelationId: upstreamToSubscriber.id,
    });
    await drain();

    await expect(payload(subscriber)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2023, subscriberMonth: 12,
      dependent: true, dependentYear: 2024, dependentMonth: 1,
    });
    await expect(payload(dependent)).resolves.toMatchObject({
      subscriber: false, subscriberYear: null, subscriberMonth: null,
      dependent: true, dependentYear: 2023, dependentMonth: 12,
    });

    const backdated = await storage.trust.wmb.createWorkerBenefit({
      workerId: subscriber, employerId, benefitId, year: 2022, month: 5,
    });
    await drain();
    await expect(payload(subscriber)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2022, subscriberMonth: 5,
    });

    await storage.trust.wmb.deleteWorkerBenefit(backdated.id);
    await storage.workerRelations.delete(subscriberToDependent.id);
    await drain();
    await expect(payload(subscriber)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2024, subscriberMonth: 6,
      dependent: true, dependentYear: 2024, dependentMonth: 1,
    });
    // FK SET NULL turns the retained receiver WMB into own evidence, and the
    // relation delete invalidates that receiver before the source commit.
    await expect(payload(dependent)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2023, subscriberMonth: 12,
      dependent: false, dependentYear: null, dependentMonth: null,
    });
  });

  it("rolls invalidations back with a failed WMB write and refuses a stale concurrent apply", async () => {
    const rolledBackWorker = await worker("rollback");
    await expect(
      runInTransaction(async () => {
        await storage.trust.wmb.createWorkerBenefit({
          workerId: rolledBackWorker, employerId, benefitId, year: 2025, month: 7,
        });
        throw new Error("force source rollback");
      }),
    ).rejects.toThrow("force source rollback");
    const rolledBackRows = await db
      .select({ id: trustWmb.id })
      .from(trustWmb)
      .where(eq(trustWmb.workerId, rolledBackWorker));
    expect(rolledBackRows).toHaveLength(0);
    expect(await status(rolledBackWorker)).toBeUndefined();

    const concurrentWorker = await worker("concurrent");
    await storage.trust.wmb.createWorkerBenefit({
      workerId: concurrentWorker, employerId, benefitId, year: 2025, month: 7,
    });
    const observed = await storage.denorm.claimStaleForEntity(
      { entityId: concurrentWorker, configId },
      "test-concurrent-claim",
    );
    expect(observed?.status).toBe("stale");
    expect(
      await storage.denorm.claimStaleForEntity(
        { entityId: concurrentWorker, configId },
        "competing-processor-claim",
      ),
    ).toBeUndefined();
    const plugin = getDenormPlugin("worker-benefit-role-history")!;
    const oldPayload = await plugin.compute(concurrentWorker);

    await storage.trust.wmb.createWorkerBenefit({
      workerId: concurrentWorker, employerId, benefitId, year: 2024, month: 4,
    });
    expect(
      await applyComputed(
        plugin,
        configId,
        concurrentWorker,
        oldPayload,
        observed!.generation,
        observed!.claimToken,
      ),
    ).toBe(false);
    expect(await status(concurrentWorker)).toMatchObject({
      status: "stale",
      generation: observed!.generation + 1,
    });

    await drain();
    await expect(payload(concurrentWorker)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2024, subscriberMonth: 4,
      dependent: false, dependentYear: null, dependentMonth: null,
    });
  });

  it("invalidates surviving role evidence before employer, benefit, and worker FK cascades", async () => {
    const grantor = await worker("cascade-grantor");
    const receiver = await worker("cascade-receiver");
    const relation = await storage.workerRelations.create({
      worker1: grantor,
      worker2: receiver,
      relationType: relationTypeId,
      startYmd: "2020-01-01",
      endYmd: null,
    });

    const [cascadeBenefit] = await db
      .insert(trustBenefits)
      .values({ name: `${run} cascade benefit`, siriusId: `${run}-cascade-benefit` })
      .returning();
    await storage.trust.wmb.createWorkerBenefit({
      workerId: receiver, employerId, benefitId: cascadeBenefit.id, year: 2024, month: 3,
      sourceRelationId: relation.id,
    });
    await drain();
    await storage.trustBenefits.deleteTrustBenefit(cascadeBenefit.id);
    expect(await status(grantor)).toMatchObject({ status: "stale" });
    expect(await status(receiver)).toMatchObject({ status: "stale" });
    await drain();

    const [cascadeEmployer] = await db
      .insert(employers)
      .values({ name: `${run} cascade employer`, siriusId: `${run}-cascade-employer`, isActive: true })
      .returning();
    await storage.trust.wmb.createWorkerBenefit({
      workerId: receiver, employerId: cascadeEmployer.id, benefitId, year: 2024, month: 4,
      sourceRelationId: relation.id,
    });
    await drain();
    await storage.employers.deleteEmployer(cascadeEmployer.id);
    expect(await status(grantor)).toMatchObject({ status: "stale" });
    expect(await status(receiver)).toMatchObject({ status: "stale" });
    await drain();

    await storage.trust.wmb.createWorkerBenefit({
      workerId: receiver, employerId, benefitId, year: 2024, month: 5,
      sourceRelationId: relation.id,
    });
    await drain();
    await storage.workers.deleteWorker(grantor);
    expect(await status(receiver)).toMatchObject({ status: "stale" });
    await drain();
    await expect(payload(receiver)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2024, subscriberMonth: 5,
      dependent: false, dependentYear: null, dependentMonth: null,
    });
  });

  it("rebuilds identical retained history and recovers an abandoned claim", async () => {
    const rebuildWorker = await worker("rebuild-and-claim-recovery");
    await storage.trust.wmb.createWorkerBenefit({
      workerId: rebuildWorker, employerId, benefitId, year: 2022, month: 2,
    });
    await storage.trust.wmb.createWorkerBenefit({
      workerId: rebuildWorker, employerId, benefitId, year: 2024, month: 8,
    });
    await drain();
    const original = await payload(rebuildWorker);

    // Simulate an operator rebuild: status deletion cascades the sole-writer
    // payload, then the retained source facts seed and recreate exactly it.
    await db.delete(denorm).where(and(eq(denorm.configId, configId), eq(denorm.entityId, rebuildWorker)));
    await storage.denorm.insertStaleBatch([{
      entityId: rebuildWorker, entityType: "worker", configId,
    }]);
    await drain();
    expect(await payload(rebuildWorker)).toMatchObject({
      subscriber: original!.subscriber,
      subscriberYear: original!.subscriberYear,
      subscriberMonth: original!.subscriberMonth,
      dependent: original!.dependent,
      dependentYear: original!.dependentYear,
      dependentMonth: original!.dependentMonth,
    });

    await storage.trust.wmb.createWorkerBenefit({
      workerId: rebuildWorker, employerId, benefitId, year: 2021, month: 11,
    });
    const abandoned = await storage.denorm.claimStaleForEntity(
      { entityId: rebuildWorker, configId },
      "abandoned-claim",
    );
    expect(abandoned).toBeDefined();
    await db.update(denorm)
      .set({ claimAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(denorm.id, abandoned!.id));
    const recovered = await storage.denorm.claimStaleForEntity(
      { entityId: rebuildWorker, configId },
      "recovery-claim",
    );
    expect(recovered?.claimToken).toBe("recovery-claim");
    const plugin = getDenormPlugin("worker-benefit-role-history")!;
    const computed = await plugin.compute(rebuildWorker);
    expect(await applyComputed(
      plugin, configId, rebuildWorker, computed,
      recovered!.generation, recovered!.claimToken,
    )).toBe(true);
    await expect(payload(rebuildWorker)).resolves.toMatchObject({
      subscriber: true, subscriberYear: 2021, subscriberMonth: 11,
    });
  });
});