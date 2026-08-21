/**
 * Pure smoke for daily staging evidence, conservative payload refresh, and
 * bounded shard aggregation. It never connects to S1 or S2.
 */
import assert from "node:assert/strict";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { assessCountEvidence } from "../lib/stage-evidence";
import { validateStageResultPayload } from "../lib/stage-result-contract";
import { shouldRefreshNodePayload } from "../lib/incremental-node";
import {
  extractBundleIncrementalSharded,
  verifyBundleIdentityWorkset,
  type IncrementalBundleHooks,
} from "../lib/extract";
import type { StagedRecord, StagedRecordMetadata } from "../lib/staging";

function testEvidence() {
  assert.equal(
    assessCountEvidence("daily", {
      sourceCountBefore: 100,
      sourceCountAfter: 100,
      identitiesScanned: 100,
      stagedCount: 100,
    }).status,
    "pass",
  );
  const inserted = assessCountEvidence("daily", {
    sourceCountBefore: 100,
    sourceCountAfter: 108,
    identitiesScanned: 108,
    stagedCount: 108,
  });
  assert.equal(inserted.status, "pass");
  assert.equal(inserted.acceptedLiveDrift, true);
  const deleted = assessCountEvidence("daily", {
    sourceCountBefore: 100,
    sourceCountAfter: 92,
    identitiesScanned: 94,
    stagedCount: 94,
  });
  assert.equal(deleted.status, "pass");
  assert.equal(deleted.acceptedLiveDrift, true);
  assert.equal(
    assessCountEvidence("daily", {
      sourceCountBefore: 100,
      sourceCountAfter: 108,
      identitiesScanned: 90,
      stagedCount: 90,
    }).status,
    "fail",
  );
  assert.equal(
    assessCountEvidence("daily", {
      sourceCountBefore: 100,
      sourceCountAfter: 108,
      identitiesScanned: 108,
      stagedCount: 107,
    }).status,
    "fail",
  );
  assert.equal(
    assessCountEvidence("final-freeze", {
      sourceCountBefore: 100,
      sourceCountAfter: 101,
      identitiesScanned: 101,
      stagedCount: 101,
    }).status,
    "fail",
  );
}

function testStageResultContract() {
  const dailyEvidence = {
    source: "sirius_worker",
    sourceCountBefore: 100,
    sourceCountAfter: 101,
    identitiesScanned: 101,
    stagedCount: 101,
    integrity: "pass" as const,
    sourceDrift: true,
    acceptedLiveDrift: true,
    status: "pass" as const,
    identityVerified: true,
    identityVerificationAttempts: 2,
  };
  const validDaily = validateStageResultPayload("daily", {
    contractVersion: 2,
    step: "stage",
    mode: "daily",
    status: "pass",
    mismatches: 0,
    acceptedLiveDrifts: 1,
    countEvidence: [dailyEvidence],
  });
  assert.deepEqual(validDaily.errors, []);

  const forgedFreeze = validateStageResultPayload("final-freeze", {
    contractVersion: 2,
    step: "stage",
    mode: "final-freeze",
    status: "pass",
    mismatches: 0,
    acceptedLiveDrifts: 0,
    countEvidence: [{
      ...dailyEvidence,
      sourceCountAfter: 100,
      identitiesScanned: 99,
      stagedCount: 99,
      sourceDrift: false,
      acceptedLiveDrift: false,
    }],
  });
  assert.ok(forgedFreeze.errors.some((error) => error.includes("not exact/stable")));

  const forgedAggregate = validateStageResultPayload("daily", {
    contractVersion: 2,
    step: "stage",
    mode: "daily",
    status: "pass",
    mismatches: 1,
    acceptedLiveDrifts: 0,
    countEvidence: [dailyEvidence],
  });
  assert.ok(forgedAggregate.errors.some((error) => error.includes("mismatches=")));
  assert.ok(forgedAggregate.errors.some((error) => error.includes("acceptedLiveDrifts=")));
}

function node(changed = 100): StagedRecord {
  return {
    bundle: "test_bundle",
    nid: 1,
    vid: 2,
    title: "title",
    uid: 3,
    status: 1,
    created: 50,
    changed,
    fields: {},
  };
}

function metadata(overrides: Partial<StagedRecordMetadata> = {}): StagedRecordMetadata {
  return {
    nid: 1,
    vid: 2,
    title: "title",
    uid: 3,
    status: 1,
    created: 50,
    changed: 100,
    extractedAt: new Date(200_000),
    ...overrides,
  };
}

function testPayloadRefresh() {
  assert.equal(shouldRefreshNodePayload(node(), undefined), true, "new node refreshes");
  assert.equal(shouldRefreshNodePayload(node(101), metadata()), true, "changed marker refreshes");
  assert.equal(shouldRefreshNodePayload({ ...node(), title: "edited" }, metadata()), true, "scalar drift refreshes");
  assert.equal(
    shouldRefreshNodePayload(node(), metadata({ extractedAt: new Date(100_500) })),
    true,
    "same-second overlap refreshes conservatively",
  );
  assert.equal(
    shouldRefreshNodePayload(node(), metadata({ extractedAt: new Date(300_000) })),
    false,
    "old unchanged node skips its full payload",
  );
}

function fakePool(rows: RowDataPacket[]): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("MIN(nid)")) {
        const nids = rows.map((row) => Number(row.nid));
        return [[{ n: rows.length, min_nid: Math.min(...nids), max_nid: Math.max(...nids) }], []];
      }
      if (sql.includes("COUNT(*)")) return [[{ n: rows.length }], []];
      if (sql.includes("nid <= ?")) {
        const after = Number(params?.[1]);
        const through = Number(params?.[2]);
        return [
          rows
            .filter((row) => Number(row.nid) > after && Number(row.nid) <= through)
            .sort((a, b) => Number(a.nid) - Number(b.nid)),
          [],
        ];
      }
      throw new Error(`unexpected SQL in fake pool: ${sql}`);
    },
  } as unknown as Pool;
}

async function testShards() {
  const rows = [1, 2, 3, 4].map((nid) => ({
    nid,
    vid: nid,
    title: `node-${nid}`,
    uid: 1,
    status: 1,
    created: 10,
    changed: 20,
  })) as RowDataPacket[];
  const seen: number[] = [];
  const written: number[] = [];
  const hooks: IncrementalBundleHooks = {
    selectPayloadIds: async (records) => {
      seen.push(...records.map((record) => record.nid));
      return new Set(records.map((record) => record.nid));
    },
    onPayload: async (records) => {
      written.push(...records.map((record) => record.nid));
    },
  };
  const report = await extractBundleIncrementalSharded(fakePool(rows), "test_bundle", [], 50, hooks, 2);
  assert.equal(report.identitiesScanned, 4);
  assert.equal(report.payloadExtracted, 4);
  assert.equal(report.shards?.length, 2);
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepEqual(written.sort((a, b) => a - b), [1, 2, 3, 4]);
  const stableVerification = await verifyBundleIdentityWorkset(fakePool(rows), "test_bundle", 50, report.shards);
  assert.equal(stableVerification.identityHash, report.identityHash);
  assert.equal(stableVerification.identitiesScanned, report.identitiesScanned);

  rows.push({
    nid: 5,
    vid: 5,
    title: "node-5",
    uid: 1,
    status: 1,
    created: 10,
    changed: 20,
  } as RowDataPacket);
  const insertedVerification = await verifyBundleIdentityWorkset(fakePool(rows), "test_bundle", 50, report.shards);
  assert.notEqual(insertedVerification.identityHash, report.identityHash, "insert above initial max invalidates workset");
  assert.equal(insertedVerification.identitiesScanned, 5);

  rows.splice(0, 1);
  const churnVerification = await verifyBundleIdentityWorkset(fakePool(rows), "test_bundle", 50, report.shards);
  assert.equal(churnVerification.identitiesScanned, report.identitiesScanned, "equal-count churn preserves the count");
  assert.notEqual(churnVerification.identityHash, report.identityHash, "equal-count churn invalidates identity fingerprint");

  const lowerRows = [2, 3, 4, 5].map((nid) => ({
    nid,
    vid: nid,
    title: `node-${nid}`,
    uid: 1,
    status: 1,
    created: 10,
    changed: 20,
  })) as RowDataPacket[];
  const lowerReport = await extractBundleIncrementalSharded(fakePool(lowerRows), "test_bundle", [], 50, hooks, 2);
  lowerRows.push({
    nid: 1,
    vid: 1,
    title: "node-1-type-corrected",
    uid: 1,
    status: 1,
    created: 10,
    changed: 20,
  } as RowDataPacket);
  const lowerVerification = await verifyBundleIdentityWorkset(fakePool(lowerRows), "test_bundle", 50, lowerReport.shards);
  assert.equal(lowerVerification.identitiesScanned, 5, "verification covers NIDs below the initially observed minimum");
  assert.notEqual(lowerVerification.identityHash, lowerReport.identityHash, "lower-NID type correction invalidates workset");

  const settledSeen: number[] = [];
  await assert.rejects(
    () =>
      extractBundleIncrementalSharded(
        fakePool(rows),
        "test_bundle",
        [],
        50,
        {
          selectPayloadIds: async (records) => {
            settledSeen.push(...records.map((record) => record.nid));
            if (records.some((record) => record.nid === 3)) throw new Error("injected shard failure");
            return new Set(records.map((record) => record.nid));
          },
          onPayload: async () => undefined,
        },
        2,
      ),
    /staging shard\(s\) failed/,
  );
  assert.deepEqual(settledSeen.sort((a, b) => a - b), [2, 3, 4, 5], "all shards settle before failure returns");
}

testEvidence();
testStageResultContract();
testPayloadRefresh();
await testShards();
console.log("PASS smoke-stage-optimization");