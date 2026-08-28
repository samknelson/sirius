/**
 * bulkReconcileForMigration: exact tag-set replacement including the
 * tagged → tagless transition (an empty desired set must DELETE existing
 * assignments — `NOT (tag_id = ANY(ARRAY[NULL]))` evaluates NULL, so the
 * empty case needs a true empty typed array), mixed batches with empty and
 * non-empty targets, ownership fail-closed behavior, and provenance
 * adoption.
 *
 * Needs the dev database with the sitespecific.bao component tables present;
 * DB-touching blocks skip themselves when the tables are absent.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storage } from "../../server/storage";
import { getOptionsStorage } from "../../server/modules/options-registry";

const RUN_TAG = `test-bulk-reconcile-${Date.now()}`;
const LOADER = `${RUN_TAG}-loader`;
const NID_BASE = 987_650_000; // synthetic, far outside any staged range

let tablesPresent = false;
const created = {
  tagTypeIds: [] as string[],
  tagIds: [] as string[],
  noteIds: [] as string[],
};

async function cleanup() {
  for (const id of created.noteIds) {
    await storage.notes.delete(id).catch(() => {});
  }
  const options = getOptionsStorage();
  for (const id of created.tagIds) {
    await options.delete("bao-notes-tag", id).catch(() => {});
  }
  for (const id of created.tagTypeIds) {
    await options.delete("bao-notes-tag-type", id).catch(() => {});
  }
}

beforeAll(async () => {
  tablesPresent = await storage.baoNoteTags.tableExists();
});

afterAll(cleanup);

function migrationNote(worker: { id: string }, typeId: string, nid: number, body: string) {
  return {
    entityType: "worker",
    entityId: worker.id,
    typeId,
    subject: `${RUN_TAG} subject ${nid}`,
    body,
    data: { s1Loader: LOADER, s1: { nid } },
    timestamp: new Date("2026-01-01T00:00:00Z"),
    userId: null,
  };
}

describe("bulk migration reconcile — tag replacement and ownership", () => {
  it("replaces tag sets exactly, including tagged → tagless in a mixed batch", async (ctx) => {
    if (!tablesPresent) return ctx.skip();
    const options = getOptionsStorage();
    const noteType = (await options.list("note-type"))[0];
    const worker = (await storage.workers.getAllWorkers())[0];
    if (!noteType || !worker?.id) return ctx.skip();

    const tagType = await options.create("bao-notes-tag-type", { name: `${RUN_TAG}-type` });
    created.tagTypeIds.push(tagType.id);
    const tagA = await options.create("bao-notes-tag", { name: `${RUN_TAG}-a`, tagTypeId: tagType.id });
    const tagB = await options.create("bao-notes-tag", { name: `${RUN_TAG}-b`, tagTypeId: tagType.id });
    created.tagIds.push(tagA.id, tagB.id);

    // Create two notes in one batch: A with two tags, B tagless.
    const first = await storage.notes.bulkReconcileForMigration({
      loader: LOADER,
      rows: [
        { ref: NID_BASE + 1, note: migrationNote(worker, noteType.id, NID_BASE + 1, "note A") as any, tagIds: [tagA.id, tagB.id] },
        { ref: NID_BASE + 2, note: migrationNote(worker, noteType.id, NID_BASE + 2, "note B") as any, tagIds: [] },
      ],
    });
    expect(first.failed.size).toBe(0);
    const aId = first.saved.get(NID_BASE + 1)!.noteId;
    const bId = first.saved.get(NID_BASE + 2)!.noteId;
    created.noteIds.push(aId, bId);
    expect(first.saved.get(NID_BASE + 1)!.created).toBe(true);
    expect((await storage.baoNoteTags.listByNote(aId)).map((r) => r.tagId).sort())
      .toEqual([tagA.id, tagB.id].sort());
    expect(await storage.baoNoteTags.listByNote(bId)).toHaveLength(0);

    // Mixed update batch: A goes tagged → TAGLESS (stale tags must be
    // deleted), B goes tagless → tagged; bodies overwritten in place.
    const second = await storage.notes.bulkReconcileForMigration({
      loader: LOADER,
      rows: [
        { ref: NID_BASE + 1, noteId: aId, note: migrationNote(worker, noteType.id, NID_BASE + 1, "note A v2") as any, tagIds: [] },
        { ref: NID_BASE + 2, noteId: bId, note: migrationNote(worker, noteType.id, NID_BASE + 2, "note B v2") as any, tagIds: [tagB.id] },
      ],
    });
    expect(second.failed.size).toBe(0);
    expect(second.saved.get(NID_BASE + 1)!.created).toBe(false);
    expect(await storage.baoNoteTags.listByNote(aId)).toHaveLength(0);
    expect((await storage.baoNoteTags.listByNote(bId)).map((r) => r.tagId)).toEqual([tagB.id]);
    expect((await storage.notes.get(aId))?.body).toBe("note A v2");
  });

  it("adopts by provenance and fail-closes on foreign ownership", async (ctx) => {
    if (!tablesPresent) return ctx.skip();
    const options = getOptionsStorage();
    const noteType = (await options.list("note-type"))[0];
    const worker = (await storage.workers.getAllWorkers())[0];
    if (!noteType || !worker?.id) return ctx.skip();

    // Adoption: a create (no noteId) whose nid already exists under this
    // loader updates the existing note instead of duplicating it.
    const seeded = await storage.notes.bulkReconcileForMigration({
      loader: LOADER,
      rows: [{ ref: NID_BASE + 3, note: migrationNote(worker, noteType.id, NID_BASE + 3, "orig") as any, tagIds: [] }],
    });
    const seededId = seeded.saved.get(NID_BASE + 3)!.noteId;
    created.noteIds.push(seededId);
    const adopted = await storage.notes.bulkReconcileForMigration({
      loader: LOADER,
      rows: [{ ref: NID_BASE + 3, note: migrationNote(worker, noteType.id, NID_BASE + 3, "adopted") as any, tagIds: [] }],
    });
    expect(adopted.saved.get(NID_BASE + 3)).toEqual({ noteId: seededId, created: false });

    // Ownership: an update aimed at a note owned by another loader is a
    // per-row failure, and the foreign note is untouched.
    const foreign = await storage.notes.create({
      entityType: "worker",
      entityId: worker.id,
      typeId: noteType.id,
      subject: `${RUN_TAG} foreign`,
      body: "foreign body",
      data: { s1Loader: "someone-else" },
      userId: null,
    });
    created.noteIds.push(foreign.id);
    const res = await storage.notes.bulkReconcileForMigration({
      loader: LOADER,
      rows: [
        { ref: NID_BASE + 4, noteId: foreign.id, note: migrationNote(worker, noteType.id, NID_BASE + 4, "hijack") as any, tagIds: [] },
        { ref: NID_BASE + 5, noteId: "no-such-note-id", note: migrationNote(worker, noteType.id, NID_BASE + 5, "gone") as any, tagIds: [] },
      ],
    });
    expect(res.failed.get(NID_BASE + 4)).toBe("owner_mismatch");
    expect(res.failed.get(NID_BASE + 5)).toBe("missing");
    expect(res.saved.size).toBe(0);
    expect((await storage.notes.get(foreign.id))?.body).toBe("foreign body");
  });
});
