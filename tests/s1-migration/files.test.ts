import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCandidates, mergeResolver, D7_CATEGORIES, type SourceNode, type Owner } from "../../scripts/s1-migration/lib/file-candidates";
import { archiveKey, LocalArchive } from "../../scripts/s1-migration/lib/file-archive";

const owner = (nid: number): Owner => nid === 1 ? { kind: "worker", id: "worker-a" }
  : nid === 2 ? { kind: "employer", id: "employer-a" }
  : nid === 3 ? { kind: "payment", id: "payment-a" }
  : nid === 4 ? { kind: "worker", reason: "worker_ambiguous" }
  : nid === 5 ? { kind: "archive" } : { kind: "unstaged" };
const log = (category: string, handlers = [1], nid = 10): SourceNode => ({
  nid, bundle: "sirius_log", title: "FICTIONAL_TITLE_CANARY", fields: {
    field_sirius_category: { value: category }, field_sirius_log_handler: handlers,
    field_sirius_attachments: [{ fid: nid }],
  },
});
describe("file migration precedence", () => {
  it("supports scalar contracts and all six types", () => {
    const shop: SourceNode = { nid: 2, bundle: "grievance_shop", title: "", fields: {
      field_grievance_contract: { fid: 20 }, field_grievance_attachments: [{ fid: 21 }],
    } };
    const result = buildCandidates([shop, log("material"), log("trust:election_wizard", [1], 11),
      log("comment", [1], 12), log("comment", [3], 13)], owner, n => n);
    expect(new Set(result.map(c => c.typeKey)).size).toBe(6);
  });
  it("normalizes every D7 category and refuses new categories", () => {
    for (const category of D7_CATEGORIES) {
      expect(buildCandidates([log(` ${category.toUpperCase().replaceAll(" ", "  ")} `)], owner, n => n)[0].typeKey).toBe("note-attachment");
    }
    expect(buildCandidates([log("new category")], owner, n => n)[0].reason).toBe("category_unruled");
  });
  it("applies archive and worker/payment/employer precedence", () => {
    expect(buildCandidates([log("feed:prior", [1, 3])], owner, n => n)[0].archiveOnly).toBe(true);
    expect(buildCandidates([log("material", [2, 3, 1])], owner, n => n)[0].context).toBe("worker");
    expect(buildCandidates([log("comment", [2, 3])], owner, n => n)[0].context).toBe("ledger_payment");
    expect(buildCandidates([log("comment", [99])], owner, n => n)[0].archiveOnly).toBe(true);
    expect(buildCandidates([log("material", [])], owner, n => n)[0].reason).toBe("owner_unresolved");
    expect(buildCandidates([log("comment", [4])], owner, n => n)[0].reason).toBe("worker_ambiguous");
  });
  it("keeps election JSON fallback, drafts and dependent links", () => {
    const n = log("trust:election_wizard", []);
    n.fields.field_sirius_type = "draft";
    n.fields.field_sirius_json = JSON.stringify({ wizard: { trust_election: {
      policy: { worker_nid: 1 }, documents: [{ relationship_nid: 44, files: [{ fid: 10 }] }],
    } } });
    const result = buildCandidates([n], owner, n => n)[0];
    expect(result).toMatchObject({ ownerId: "worker-a", wizardStatus: "draft", relationshipNid: 44 });
  });
  it("follows fresh merge chains and refuses cycles", () => {
    const merge = (from: number, to: number): SourceNode => ({ nid: from + 100, bundle: "sirius_log", title: null,
      fields: { field_sirius_category: "sirius_worker", field_sirius_type: "merge",
        field_sirius_log_handler: [to], field_sirius_json: JSON.stringify({ nid: from }) } });
    expect(mergeResolver([merge(7, 8), merge(8, 1)])(7)).toBe(1);
    expect(mergeResolver([merge(7, 8), merge(8, 7)])(7)).toBeUndefined();
  });
  it("selects the lowest source nid deterministically", () => {
    const a = log("comment", [1], 11), b = log("comment", [3], 12);
    b.fields.field_sirius_attachments = [{ fid: 11 }];
    const result = buildCandidates([b, a], owner, n => n);
    expect(result[0].reason).toBeUndefined();
    expect(result[1].reason).toBe("duplicate_fid");
  });
  it("uses filename fallback instead of an unrelated node title", () => {
    expect(buildCandidates([log("material")], owner, n => n)[0].title).toBeUndefined();
  });
  it("rejects invalid source JSON per material/election candidate without aborting other files", () => {
    const nodes = [log("material", [1], 10), log("trust:election_wizard", [], 11), log("comment", [1], 12)];
    nodes[0].fields.field_sirius_json = "CANARY_INVALID_JSON";
    nodes[1].fields.field_sirius_json = "CANARY_INVALID_JSON";
    const result = buildCandidates(nodes, owner, n => n);
    expect(result.map(c => c.reason)).toEqual(["source_json_invalid", "source_json_invalid", undefined]);
  });
  it("isolates malformed merges, conflicts, cycles and their upstream handlers", () => {
    const merge = (from: number, handlers: number[]): SourceNode => ({
      ...log("sirius_worker", handlers, from + 100), fields: {
        field_sirius_category: "sirius_worker", field_sirius_type: "merge",
        field_sirius_log_handler: handlers, field_sirius_json: JSON.stringify({ nid: from }),
      },
    });
    const unreadable = merge(99, [1]); unreadable.fields.field_sirius_json = "CANARY_JSON";
    const resolver = mergeResolver([merge(7, []), merge(8, [7]), merge(9, [1]), merge(9, [2]),
      merge(10, [11]), merge(11, [10]), unreadable]);
    expect(resolver.invalidLogs).toBe(2);
    const result = buildCandidates([7, 8, 9, 10, 11, 1].map((handler, i) => log("comment", [handler], 200 + i)), owner, resolver);
    expect(result.map(c => c.reason)).toEqual([
      "merge_unresolved", "merge_unresolved", "merge_unresolved", "merge_unresolved", "merge_unresolved", undefined,
    ]);
    expect(resolver(99)).toBe(99); // Unknown from-nid cannot taint an arbitrary worker.
  });
});
describe("local archive containment", () => {
  it("rejects unsafe and nonprivate URI mappings", () => {
    for (const uri of ["temporary://file", "public://file", "private://../secret", "private:///file", "private://a\\b"]) expect(archiveKey(uri)).toBeNull();
    expect(archiveKey("private://attach_123")).toBe("private/attach_123");
  });
  it("distinguishes missing, bounds reads, refuses symlinks and leaves objects intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "file-archive-"));
    try {
      await mkdir(join(root, "private"));
      await writeFile(join(root, "private", "fixture"), "synthetic");
      await symlink(join(root, "private", "fixture"), join(root, "private", "link"));
      const reader = new LocalArchive(root);
      expect(await reader.head("private/missing")).toBeNull();
      expect(await reader.head("private/fixture")).toBe(9);
      expect((await reader.get("private/fixture", 9)).toString()).toBe("synthetic");
      await expect(reader.get("private/fixture", 8)).rejects.toThrow("archive_get_failed");
      await expect(reader.head("private/link")).rejects.toThrow("archive_head_failed");
      await expect(reader.head("../outside")).rejects.toThrow("archive_head_failed");
      expect(await reader.head("private/fixture")).toBe(9);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
