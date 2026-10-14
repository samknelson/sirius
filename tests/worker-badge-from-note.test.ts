import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  initialized: true,
  configs: [] as any[],
  notes: new Map<string, any>(),
  statuses: new Map<string, any>(),
  awards: new Map<string, any>(),
  handlers: new Map<string, ((payload: any) => Promise<void>)[]>(),
  nextId: 0,
  afterCommit: undefined as (() => void)[] | undefined,
  flash: vi.fn(),
  storage: {
    pluginConfigs: { get: vi.fn(), getByKindAndPlugin: vi.fn() },
    denorm: {
      deleteByEntityIdsForConfig: vi.fn(), upsertStatus: vi.fn(),
      clearForConfig: vi.fn(), insertStaleBatch: vi.fn(), getStaleBatchForConfig: vi.fn(),
    },
    workerBadgesDenorm: {
      getQualifyingNote: vi.fn(), validateNoteRule: vi.fn(), insertGrant: vi.fn(),
      getGrantState: vi.fn(),
      findNoteCandidates: vi.fn(), findNoteWidows: vi.fn(),
    },
  },
}));

vi.mock("../server/storage", () => ({ storage: state.storage }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/services/component-cache", () => ({
  isCacheInitialized: () => state.initialized,
}));
vi.mock("../server/storage/transaction-context", () => ({
  runInTransaction: async (fn: () => Promise<unknown>) => {
    if (state.afterCommit) return fn();
    const statuses = new Map(state.statuses);
    const awards = new Map(state.awards);
    const callbacks: (() => void)[] = [];
    state.afterCommit = callbacks;
    let result;
    try {
      result = await fn();
    } catch (error) {
      state.statuses = statuses;
      state.awards = awards;
      throw error;
    } finally {
      state.afterCommit = undefined;
    }
    for (const callback of callbacks) {
      try { callback(); } catch { /* best-effort, like the real commit flush */ }
    }
    return result;
  },
  onAfterCommit: (callback: () => void) => {
    if (state.afterCommit) state.afterCommit.push(callback);
    else callback();
  },
}));
vi.mock("../server/services/websocket", () => ({ broadcastBadgeGrant: state.flash }));
vi.mock("../server/plugins/_core/gating", () => ({
  isPluginComponentEnabledSync: (meta: any) => !meta.requiredComponent || state.enabled,
}));
vi.mock("../server/plugins/_core", async () => ({
  PluginRegistry: (await import("../server/plugins/_core/registry")).PluginRegistry,
  isPluginComponentEnabledSync: (meta: any) => !meta.requiredComponent || state.enabled,
}));
vi.mock("../server/services/event-bus", async importOriginal => ({
  ...await importOriginal<typeof import("../server/services/event-bus")>(),
  eventBus: {
    on: ({ event, handler }: any) => {
      state.handlers.set(event, [...state.handlers.get(event) ?? [], handler]);
      return `${event}:${state.handlers.get(event)!.length}`;
    },
    off: vi.fn(),
  },
}));

import "../server/plugins/system/denorm/plugins/workerBadgeFromNote";
import { getDenormPlugin, recomputeDenormEntity } from "../server/plugins/system/denorm/registry";
import { applyComputed } from "../server/plugins/system/denorm/apply";
import { backfillAllDenorm } from "../server/plugins/system/denorm/backfill";
import { recomputeStaleDenorm } from "../server/plugins/system/denorm/recompute";
import { EventType } from "../server/services/event-bus";
import { requestContext } from "../server/middleware/request-context";
import { runInTransaction } from "../server/storage/transaction-context";

const plugin = getDenormPlugin("workerBadgeFromNote")!;
const config = (id: string, noteTypeId = "note-type", badgeTypeId = "badge") =>
  ({ id, pluginId: plugin.metadata.id, enabled: true, data: { noteTypeId, badgeTypeId } });
const source = (id: string, typeId = "note-type", contextId = "worker", entityId = "worker") =>
  ({ id, typeId, contextId, entityId, timestamp: new Date("2026-10-01T12:00:00Z") });
async function emit(event: EventType, payload: unknown) {
  for (const handler of state.handlers.get(event) ?? []) await handler(payload);
}
function remove(configId: string, ids: string[]) {
  let deleted = 0;
  for (const id of ids) {
    const key = `${configId}:${id}`;
    const status = state.statuses.get(key);
    if (!status) continue;
    for (const [pair, award] of state.awards) {
      if (award.denormId === status.id) state.awards.delete(pair);
    }
    state.statuses.delete(key);
    deleted++;
  }
  return deleted;
}
const qualifies = (note: any, rule: any) =>
  note?.contextId === "worker" && note.typeId === rule.noteTypeId;

beforeEach(() => {
  vi.clearAllMocks();
  state.flash.mockReset();
  state.afterCommit = undefined;
  state.enabled = state.initialized = true;
  state.configs = [config("rule")];
  state.notes.clear(); state.statuses.clear(); state.awards.clear(); state.nextId = 0;
  state.storage.pluginConfigs.getByKindAndPlugin.mockImplementation(async (_kind, id) =>
    state.configs.filter(c => c.pluginId === id));
  state.storage.pluginConfigs.get.mockImplementation(async id => state.configs.find(c => c.id === id));
  state.storage.denorm.deleteByEntityIdsForConfig.mockImplementation(async (id, ids) => remove(id, ids));
  state.storage.denorm.clearForConfig.mockImplementation(async id =>
    remove(id, [...state.statuses.values()].filter(s => s.configId === id).map(s => s.entityId)));
  state.storage.denorm.upsertStatus.mockImplementation(async row => {
    const key = `${row.configId}:${row.entityId}`;
    const value = { id: state.statuses.get(key)?.id ?? `status-${++state.nextId}`, ...row };
    state.statuses.set(key, value);
    return value;
  });
  state.storage.denorm.insertStaleBatch.mockImplementation(async rows => {
    for (const row of rows) await state.storage.denorm.upsertStatus({ ...row, status: "stale" });
    return rows.length;
  });
  state.storage.denorm.getStaleBatchForConfig.mockImplementation(async (id, limit) =>
    [...state.statuses.values()].filter(s => s.configId === id && s.status === "stale").slice(0, limit));
  state.storage.workerBadgesDenorm.validateNoteRule.mockResolvedValue([]);
  state.storage.workerBadgesDenorm.getQualifyingNote.mockImplementation(async (id, rule) =>
    qualifies(state.notes.get(id), rule) ? state.notes.get(id) : undefined);
  state.storage.workerBadgesDenorm.insertGrant.mockImplementation(async (denormId, grant) => {
    const key = `${grant.workerId}:${grant.badgeTypeId}`;
    if (state.awards.has(key)) return false;
    state.awards.set(key, { denormId, ...grant });
    return true;
  });
  state.storage.workerBadgesDenorm.getGrantState.mockImplementation(async grant => ({
    existed: state.awards.has(`${grant.workerId}:${grant.badgeTypeId}`),
    badgeName: grant.badgeTypeId === "badge" ? "Helpful Worker" : "Another Badge",
  }));
  state.storage.workerBadgesDenorm.findNoteCandidates.mockImplementation(async (rule, limit) =>
    [...state.notes.values()].filter(n => qualifies(n, rule) &&
      !state.awards.has(`${n.entityId}:${rule.badgeTypeId}`)).map(n => n.id).slice(0, limit));
  state.storage.workerBadgesDenorm.findNoteWidows.mockImplementation(async (id, rule, limit) =>
    [...state.statuses.values()].filter(s => s.configId === id &&
      !qualifies(state.notes.get(s.entityId), rule)).map(s => s.entityId).slice(0, limit));
});

describe("note-owned badge rule and shared denorm lifecycle", () => {
  it("offers real options pickers and allows normal configurable records", () => {
    expect(plugin.metadata.requiredComponent).toBe("worker.badges");
    expect(plugin.metadata.singleton).toBe(false);
    expect(plugin.entityType).toBe("entity_note");
    expect(plugin.configSchema?.properties?.noteTypeId).toMatchObject({ "x-options-resource": "note-type" });
    expect(plugin.configSchema?.properties?.badgeTypeId).toMatchObject({ "x-options-resource": "worker-badge-type" });
  });
  it("validates required references and refuses disabled-component validation without a query", async () => {
    expect((await plugin.validateConfig!({})).valid).toBe(false);
    state.storage.workerBadgesDenorm.validateNoteRule.mockResolvedValue(["Must apply to Workers"]);
    expect((await plugin.validateConfig!(config("rule").data)).valid).toBe(false);
    state.enabled = false;
    state.storage.workerBadgesDenorm.validateNoteRule.mockClear();
    expect((await plugin.validateConfig!(config("rule").data)).valid).toBe(false);
    expect(state.storage.workerBadgesDenorm.validateNoteRule).not.toHaveBeenCalled();
  });
  it("grants on save with the supplied note date and leaves an existing award's owner alone", async () => {
    state.notes.set("first", source("first"));
    state.notes.set("second", source("second"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "first" });
    const owner = state.awards.get("worker:badge").denormId;
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "second" });
    expect(state.awards.size).toBe(1);
    expect(state.awards.get("worker:badge").denormId).toBe(owner);
    expect(state.awards.get("worker:badge").grantedTimestamp).toEqual(source("first").timestamp);
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "first" });
    expect(state.awards.size).toBe(1);
  });
  it("removing a non-owner does not remove the owner's award", async () => {
    for (const id of ["first", "second"]) {
      state.notes.set(id, source(id));
      await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: id });
    }
    state.notes.delete("second");
    await emit(EventType.ENTITY_NOTE_DELETE_AFTER, { noteId: "second" });
    expect(state.awards.size).toBe(1);
  });
  it("cascades the owner's removal and backfills an already-processed surviving note", async () => {
    for (const id of ["first", "second"]) {
      state.notes.set(id, source(id));
      await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: id });
    }
    expect(state.statuses.get("rule:second").status).toBe("ok");
    state.notes.delete("first");
    await emit(EventType.ENTITY_NOTE_DELETE_AFTER, { noteId: "first" });
    expect(state.awards.size).toBe(0);
    await backfillAllDenorm({ pluginId: plugin.metadata.id });
    await recomputeStaleDenorm({ pluginId: plugin.metadata.id });
    expect(state.awards.get("worker:badge").denormId).toBe(state.statuses.get("rule:second").id);
  });
  it.each(["type", "context", "worker"])("replaces the old derivation after a note's %s changes", async field => {
    state.notes.set("note", source("note"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note" });
    state.notes.set("note", field === "type" ? source("note", "other-type")
      : field === "context" ? source("note", "note-type", "employer")
      : source("note", "note-type", "worker", "other-worker"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note" });
    expect(state.awards.has("worker:badge")).toBe(false);
    expect(state.awards.size).toBe(field === "worker" ? 1 : 0);
  });
  it("cleans a deleted source when its event was missed", async () => {
    state.notes.set("note", source("note"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note" });
    state.notes.delete("note");
    expect((await backfillAllDenorm({ pluginId: plugin.metadata.id })).totalDeleted).toBe(1);
    expect(state.awards.size).toBe(0);
  });
  it("uses each enabled config's own rule on events, backfill, and recompute", async () => {
    state.configs.push(config("another", "another-type", "another-badge"),
      { ...config("disabled"), enabled: false });
    state.notes.set("a", source("a"));
    state.notes.set("b", source("b", "another-type"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "b" });
    expect(state.awards.has("worker:another-badge")).toBe(true);
    expect(state.statuses.has("disabled:b")).toBe(false);
    await backfillAllDenorm({ pluginId: plugin.metadata.id });
    await recomputeStaleDenorm({ pluginId: plugin.metadata.id });
    expect([...state.awards.keys()].sort()).toEqual(["worker:another-badge", "worker:badge"]);
  });
  it("keeps overlapping rules from stealing ownership", async () => {
    state.configs.push(config("another"));
    state.notes.set("note", source("note"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note" });
    expect(state.awards.size).toBe(1);
    expect(state.awards.get("worker:badge").denormId).toBe(state.statuses.get("rule:note").id);
  });
  it("invalidates source-owned config saves and lets normal backfill apply new choices", async () => {
    state.notes.set("note", source("note"));
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note" });
    state.configs[0].data.badgeTypeId = "new-badge";
    await emit(EventType.PLUGIN_CONFIG_SAVED, { kind: "denorm", id: "rule", operation: "update" });
    expect(state.awards.size).toBe(0);
    await backfillAllDenorm({ pluginId: plugin.metadata.id });
    await recomputeStaleDenorm({ pluginId: plugin.metadata.id });
    expect(state.awards.has("worker:new-badge")).toBe(true);
  });
  it("skips all feature queries while the component is off", async () => {
    state.enabled = false;
    await emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note" });
    await recomputeDenormEntity(plugin.metadata.id, "note");
    await backfillAllDenorm({ pluginId: plugin.metadata.id });
    await recomputeStaleDenorm({ pluginId: plugin.metadata.id });
    expect(state.storage.pluginConfigs.getByKindAndPlugin).not.toHaveBeenCalled();
    expect(state.storage.workerBadgesDenorm.getQualifyingNote).not.toHaveBeenCalled();
  });
  it("preserves existing plugins' in-place semantics, including null payloads", async () => {
    const legacy = { ...plugin, beforeApply: undefined, replaceOnCompute: undefined, write: vi.fn() };
    await applyComputed(legacy, "legacy-rule", "entity", null);
    expect(state.storage.denorm.deleteByEntityIdsForConfig).not.toHaveBeenCalled();
    expect(legacy.write).toHaveBeenCalledWith("entity", null, expect.any(String));
  });
  it("shares each sweep's existing per-plugin limit across configurations", async () => {
    state.configs.push(config("another", "another-type", "another-badge"));
    state.notes.set("a", source("a"));
    state.notes.set("b", source("b", "another-type"));
    const result = await backfillAllDenorm({ pluginId: plugin.metadata.id, limit: 1, mode: "test" });
    expect(result.totalEnqueued).toBe(1);
    expect(result.perPlugin).toHaveLength(1);
    expect(state.statuses.size).toBe(0);
  });
});

describe("commit-only badge grant flashes", () => {
  const asActor = (fn: () => Promise<void>) =>
    requestContext.run({ userId: "effective-user", originalUserId: "real-user" }, fn);
  const save = () => emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "note", authorUserId: "note-author" });

  it("captures the effective actor and flashes only after the outermost commit", async () => {
    state.notes.set("note", source("note"));
    await runInTransaction(async () => {
      await asActor(save);
      expect(state.awards.size).toBe(1);
      expect(state.flash).not.toHaveBeenCalled();
    });
    expect(state.flash).toHaveBeenCalledExactlyOnceWith("effective-user", "Helpful Worker");
  });

  it("does not flash unchanged replacements, date edits, removals, or losing claims", async () => {
    state.notes.set("note", source("note"));
    await asActor(save);
    state.flash.mockClear();
    await asActor(save);
    state.notes.get("note").timestamp = new Date("2026-10-02T12:00:00Z");
    await asActor(save);
    state.notes.set("loser", source("loser"));
    await asActor(() => emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "loser" }));
    state.notes.delete("note");
    await asActor(save);
    expect(state.flash).not.toHaveBeenCalled();
  });

  it("uses actual insertion outcome when an absent pair loses a uniqueness claim", async () => {
    state.notes.set("note", source("note"));
    state.storage.workerBadgesDenorm.insertGrant.mockResolvedValueOnce(false);
    await asActor(save);
    expect(state.storage.workerBadgesDenorm.getGrantState).toHaveReturned();
    expect(state.flash).not.toHaveBeenCalled();
  });

  it("flashes a different newly awarded badge", async () => {
    state.notes.set("note", source("note"));
    await asActor(save);
    state.configs[0].data.badgeTypeId = "another-badge";
    await asActor(save);
    expect(state.flash.mock.calls).toEqual([
      ["effective-user", "Helpful Worker"], ["effective-user", "Another Badge"],
    ]);
  });

  it("keeps background grants silent without an actor", async () => {
    state.notes.set("note", source("note"));
    await save();
    expect(state.awards.size).toBe(1);
    expect(state.flash).not.toHaveBeenCalled();
  });

  it("discards feedback and awards when the surrounding transaction rolls back", async () => {
    state.notes.set("note", source("note"));
    await expect(runInTransaction(async () => {
      await asActor(save);
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(state.awards.size).toBe(0);
    expect(state.flash).not.toHaveBeenCalled();
  });

  it("keeps a committed award successful when feedback fails or no browser is connected", async () => {
    state.notes.set("note", source("note"));
    state.flash.mockImplementationOnce(() => { throw new Error("socket failure"); });
    await asActor(save);
    expect(state.awards.size).toBe(1);
    expect(state.statuses.get("rule:note").status).toBe("ok");
    state.notes.set("other", source("other", "note-type", "worker", "other-worker"));
    await asActor(() => emit(EventType.ENTITY_NOTE_SAVE_AFTER, { noteId: "other" }));
    expect(state.awards.size).toBe(2);
  });
});
