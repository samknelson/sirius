/**
 * BAO note tags: unified-options registration + component gating wiring, tag
 * CRUD through the generic options storage, and note ↔ tag assignment
 * including FK cascade behavior (tag delete and note delete both remove
 * assignments).
 *
 * Needs the dev database with the sitespecific.bao component tables present;
 * every DB-touching block skips itself when the tables are absent so the
 * suite stays green on non-BAO databases.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storage } from "../../server/storage";
import { getOptionsStorage, getOptionsType } from "../../server/modules/options-registry";
import { getComponentById } from "@shared/components";

const RUN_TAG = `test-bao-note-tags-${Date.now()}`;

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

describe("registration and gating wiring", () => {
  it("registers both option types in the explicit registry", () => {
    expect(getOptionsType("bao-notes-tag-type")).toBeTruthy();
    expect(getOptionsType("bao-notes-tag")).toBeTruthy();
  });

  it("requires the sitespecific.bao component on both types", () => {
    // requireOptionTypeComponent() 403s (and the client hides the pages)
    // off this metadata — if it goes missing, gating silently disappears.
    expect(getOptionsType("bao-notes-tag-type")?.requiredComponent).toBe("sitespecific.bao");
    expect(getOptionsType("bao-notes-tag")?.requiredComponent).toBe("sitespecific.bao");
  });

  it("lists the three tables in the BAO component schema manifest", () => {
    const manifest = getComponentById("sitespecific.bao")?.schemaManifest;
    for (const t of [
      "options_sitespecific_bao_notes_tag_types",
      "options_sitespecific_bao_notes_tags",
      "sitespecific_bao_notes_tags",
    ]) {
      expect(manifest?.tables).toContain(t);
    }
  });
});

describe("tag CRUD via unified options and note assignment cascades", () => {
  it("creates, updates, assigns, and cascades", async (ctx) => {
    if (!tablesPresent) return ctx.skip();
    const options = getOptionsStorage();

    // Tag type + two tags under it.
    const tagType = await options.create("bao-notes-tag-type", { name: `${RUN_TAG}-type` });
    created.tagTypeIds.push(tagType.id);
    const tagA = await options.create("bao-notes-tag", {
      name: `${RUN_TAG}-a`,
      tagTypeId: tagType.id,
    });
    const tagB = await options.create("bao-notes-tag", {
      name: `${RUN_TAG}-b`,
      tagTypeId: tagType.id,
    });
    created.tagIds.push(tagA.id, tagB.id);

    const renamed = await options.update("bao-notes-tag", tagA.id, { name: `${RUN_TAG}-a2` });
    expect(renamed?.name).toBe(`${RUN_TAG}-a2`);

    // A note to hang assignments off. Any registered entity works for the
    // join table; the FK only cares about notes.id.
    const noteType = (await options.list("note-type"))[0];
    if (!noteType) return ctx.skip();
    const worker = (await storage.workers.getAllWorkers())[0];
    if (!worker?.id) return ctx.skip();

    const note = await storage.notes.create({
      entityType: "worker",
      entityId: worker.id,
      typeId: noteType.id,
      subject: `${RUN_TAG} subject`,
      body: null,
      data: null,
      userId: null,
    });
    created.noteIds.push(note.id);

    // Replace-set semantics.
    let rows = await storage.baoNoteTags.setForNote(note.id, [tagA.id, tagB.id]);
    expect(rows.map((r) => r.tagId).sort()).toEqual([tagA.id, tagB.id].sort());
    rows = await storage.baoNoteTags.setForNote(note.id, [tagB.id]);
    expect(rows.map((r) => r.tagId)).toEqual([tagB.id]);
    rows = await storage.baoNoteTags.setForNote(note.id, [tagA.id, tagB.id]);
    expect(rows).toHaveLength(2);
    // Enrichment carries the tag type for grouping.
    expect(rows[0]?.tagTypeId).toBe(tagType.id);

    // Deleting a TAG cascades its assignment away.
    await options.delete("bao-notes-tag", tagA.id);
    rows = await storage.baoNoteTags.listByNote(note.id);
    expect(rows.map((r) => r.tagId)).toEqual([tagB.id]);

    // Deleting the NOTE cascades the remaining assignment away.
    await storage.notes.delete(note.id);
    rows = await storage.baoNoteTags.listByNote(note.id);
    expect(rows).toHaveLength(0);
  });
});
