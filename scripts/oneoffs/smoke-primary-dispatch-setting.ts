import { storage } from "../../server/storage";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
const unifiedOptions = createUnifiedOptionsStorage();

async function main() {
  const employers = await storage.employers.getAllEmployers();
  const employer = employers[0];
  if (!employer) throw new Error("Need at least one employer");
  const workersList = await storage.workers.getAllWorkers();
  const worker = workersList[0];
  if (!worker) throw new Error("Need at least one worker");

  const cleanup: Array<() => Promise<unknown>> = [];
  const results: string[] = [];
  const ok = (msg: string) => results.push(`PASS: ${msg}`);
  const fail = (msg: string) => results.push(`FAIL: ${msg}`);

  const mkJobType = async (primary: string | undefined, name: string) => {
    const jt = await unifiedOptions.create("dispatch-job-type", {
      name,
      data: primary ? { primary } : {},
    } as any);
    cleanup.push(() => unifiedOptions.delete("dispatch-job-type", jt.id));
    return jt;
  };
  const mkJob = async (jobTypeId: string, title: string) => {
    const job = await storage.dispatchJobs.create({
      employerId: employer.id,
      jobTypeId,
      title,
      status: "open",
      startYmd: "2026-07-24",
    } as any);
    cleanup.push(() => storage.dispatchJobs.delete(job.id));
    return job;
  };

  try {
    const jtPrimary = await mkJobType("primary", "SMOKE primary");
    const jtBoth = await mkJobType("both", "SMOKE both");
    const jtSecondary = await mkJobType("secondary", "SMOKE secondary");
    const jtUnset = await mkJobType(undefined, "SMOKE unset");

    const jobP = await mkJob(jtPrimary.id, "SMOKE job primary");
    const jobP2 = await mkJob(jtPrimary.id, "SMOKE job primary 2");
    const jobB = await mkJob(jtBoth.id, "SMOKE job both");
    const jobB2 = await mkJob(jtBoth.id, "SMOKE job both 2");
    const jobS = await mkJob(jtSecondary.id, "SMOKE job secondary");
    const jobU = await mkJob(jtUnset.id, "SMOKE job unset");

    // 1. Create on primary type → isPrimary true, no failure
    const dP = await storage.dispatches.create({ jobId: jobP.id, workerId: worker.id, status: "pending" } as any);
    cleanup.push(() => storage.dispatches.delete(dP.id));
    dP.isPrimary ? ok("create primary-type → isPrimary=true") : fail(`create primary-type → isPrimary=${dP.isPrimary}`);

    // 2. Create on secondary type → false
    const dS = await storage.dispatches.create({ jobId: jobS.id, workerId: worker.id, status: "pending" } as any);
    cleanup.push(() => storage.dispatches.delete(dS.id));
    !dS.isPrimary ? ok("create secondary-type → isPrimary=false") : fail("create secondary-type → isPrimary=true");

    // 3. Create on unset type → false (default secondary)
    const dU = await storage.dispatches.create({ jobId: jobU.id, workerId: worker.id, status: "pending" } as any);
    cleanup.push(() => storage.dispatches.delete(dU.id));
    !dU.isPrimary ? ok("create unset-type defaults secondary") : fail("create unset-type → isPrimary=true");

    // 4. Create on both type with no accepted primary → true
    const dB = await storage.dispatches.create({ jobId: jobB.id, workerId: worker.id, status: "pending" } as any);
    cleanup.push(() => storage.dispatches.delete(dB.id));
    dB.isPrimary ? ok("create both-type (no accepted primary) → isPrimary=true") : fail("create both-type → isPrimary=false");

    // 5. Accept primary-type dispatch → success, primary
    const accP = await storage.dispatches.setStatus(dP.id, "accepted");
    accP.success && accP.dispatch?.isPrimary
      ? ok("accept primary-type → accepted primary")
      : fail(`accept primary-type: ${JSON.stringify(accP)}`);

    // 6. Now worker HAS an accepted primary. Create on both type → secondary
    const dB2 = await storage.dispatches.create({ jobId: jobB2.id, workerId: worker.id, status: "pending" } as any);
    cleanup.push(() => storage.dispatches.delete(dB2.id));
    !dB2.isPrimary ? ok("create both-type (has accepted primary) → secondary") : fail("create both-type → primary despite existing");

    // 7. Accept both-type dispatch → falls back to secondary, succeeds
    const accB = await storage.dispatches.setStatus(dB.id, "accepted");
    accB.success && accB.dispatch?.isPrimary === false
      ? ok("accept both-type with existing primary → accepted secondary")
      : fail(`accept both-type: ${JSON.stringify(accB)}`);

    // 8. Create second primary-type dispatch (should NOT fail on create)
    const dP2 = await storage.dispatches.create({ jobId: jobP2.id, workerId: worker.id, status: "pending" } as any);
    cleanup.push(() => storage.dispatches.delete(dP2.id));
    ok("create second primary-type dispatch did not fail");

    // 9. Accept it → clean conflict error, not raw 500
    const accP2 = await storage.dispatches.setStatus(dP2.id, "accepted");
    !accP2.success && /accepted primary dispatch/.test(accP2.error || "")
      ? ok(`accept second primary-type → friendly conflict: "${accP2.error}"`)
      : fail(`accept second primary-type: ${JSON.stringify(accP2)}`);

    // 10. Accept secondary-type → stays not primary
    const accS = await storage.dispatches.setStatus(dS.id, "accepted");
    accS.success && accS.dispatch?.isPrimary === false
      ? ok("accept secondary-type → stays secondary")
      : fail(`accept secondary-type: ${JSON.stringify(accS)}`);
  } finally {
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch (e) { console.error("cleanup error:", (e as Error).message); }
    }
  }

  console.log(results.join("\n"));
  if (results.some(r => r.startsWith("FAIL"))) process.exit(1);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
