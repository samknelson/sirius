import { configuredNotifierMedia } from "../../server/plugins/event-notifier/config-media";

describe("configured notifier media", () => {
  it.each(["inapp", ["inapp"]])("honors the edited envelope over stale data.media: %j", media => {
    expect(configuredNotifierMedia({ media, data: { media: ["email", "inapp"] } })).toEqual(["inapp"]);
  });
  it.each(["", [], null])("allows clearing every channel: %j", media => {
    expect(configuredNotifierMedia({ media, data: { media: ["email"] } })).toEqual([]);
  });
  it("retains the legacy fallback only when the caller omitted the envelope", () => {
    expect(configuredNotifierMedia({ data: { media: ["email", "inapp"] } })).toEqual(["email", "inapp"]);
    expect(configuredNotifierMedia({})).toEqual([]);
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideUnsupportedTemplateChannels,
  stampNotifierTemplateIds,
  templatesSchemaBlock,
} from "../../server/plugins/event-notifier/template-schema";
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { getPluginKind } from "../../server/plugins/_core/kinds";
import type { EventNotifierManifestEntry } from "../../server/plugins/event-notifier/types";

const configReads = vi.hoisted(() => vi.fn());
vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: { getByKind: configReads },
  },
}));

beforeEach(() => {
  configReads.mockReset();
  configReads.mockImplementation(async (kind: string) => {
    if (kind !== "event-notifier") throw new Error(`Unexpected provider lookup: ${kind}`);
    return [];
  });
});

// Authoring must not consult delivery routing, even to diagnose it.
vi.mock("../../server/services/webclient/wc-vendor-context", () => {
  throw new Error("Template authoring must not load the delivery-provider resolver");
});

function schema() {
  const result = {
    type: "object",
    properties: {
      templates: templatesSchemaBlock({
        variants: [{ id: "removed", label: "Removal", channels: ["sms"] }],
      }),
    },
  };
  stampNotifierTemplateIds(result, "fixture-notifier");
  return result;
}

function groupsOf(value: ReturnType<typeof hideUnsupportedTemplateChannels>) {
  return ((value!.properties as Record<string, Record<string, unknown>>).templates
    .properties as Record<string, Record<string, unknown>>);
}

describe("notifier template authoring eligibility", () => {
  it("offers all supported media without loading delivery-provider resolution", () => {
    const original = schema();
    const decorated = hideUnsupportedTemplateChannels(original, ["email", "sms", "inapp"]);
    expect(decorated).toBe(original);
    for (const group of Object.values(groupsOf(decorated))) {
      expect(group["x-token-hidden"]).toBeUndefined();
      expect(group["x-token-unavailable-reason"]).toBeUndefined();
    }
  });

  it("keeps SMS variants editable while hiding only unsupported media without removing their fields", () => {
    const original = schema();
    const snapshot = structuredClone(original);
    const decorated = hideUnsupportedTemplateChannels(original, ["sms"]);
    const groups = groupsOf(decorated);
    for (const key of ["sms", "removed_sms"]) {
      expect(groups[key]["x-token-hidden"]).toBeUndefined();
      expect(groups[key]["x-token-plugin-id"]).toBe("fixture-notifier");
    }
    for (const key of ["email", "inapp"]) {
      expect(groups[key]["x-token-hidden"]).toBe(true);
      expect(groups[key].properties).toEqual(groupsOf(original)[key].properties);
      expect(groups[key]["x-token-unavailable-reason"]).toBeUndefined();
    }
    expect(original).toEqual(snapshot);
    expect(groups.removed_sms["x-token-variant"]).toBe("removed");
  });

  it("handles a notifier supporting none of the templated media without pruning stored groups", () => {
    const groups = groupsOf(hideUnsupportedTemplateChannels(schema(), ["postal"]));
    expect(Object.keys(groups)).toEqual(["email", "sms", "inapp", "removed_sms"]);
    for (const group of Object.values(groups)) {
      expect(group["x-token-hidden"]).toBe(true);
      expect(group.properties).toBeDefined();
    }
  });

  it("leaves schemas without template groups alone", () => {
    expect(hideUnsupportedTemplateChannels(undefined, ["sms"])).toBeUndefined();
    const ordinary = { type: "object", properties: { threshold: { type: "number" } } };
    expect(hideUnsupportedTemplateChannels(ordinary, ["sms"])).toBe(ordinary);
  });

  it("serves the actual notifier manifest without consulting providers and retains its admin gate", async () => {
    initializeEventNotifierPluginSystem();
    const kind = getPluginKind("event-notifier")!;
    expect(kind.requiredPolicy).toBe("admin");
    const entries = await kind.decorateEntries!([
      { id: "edls-sheet-worker-sms-notifier", name: "Worker" },
    ], {} as never) as EventNotifierManifestEntry[];
    expect(configReads.mock.calls).toEqual([["event-notifier"]]);
    const worker = entries.find(entry => entry.id === "edls-sheet-worker-sms-notifier")!;
    const groups = groupsOf(worker.configSchema as Record<string, unknown>);
    expect(groups.sms["x-token-hidden"]).toBeUndefined();
    expect(groups.removed_sms["x-token-hidden"]).toBeUndefined();
    expect(groups.email["x-token-hidden"]).toBe(true);
    expect(groups.inapp["x-token-hidden"]).toBe(true);
  });
});
