import { describe, expect, it, vi } from "vitest";
import type { EventNotifierPlugin, EventNotifierEventContext } from "../../server/plugins/event-notifier/types";
import { buildRecipientTemplateContext, composeFromTemplates, defaultTemplatesFor, resolveTemplates } from "../../server/plugins/event-notifier/token-templates";
import { templatesSchemaBlock, stampNotifierTemplateIds, hideUnsupportedTemplateChannels } from "../../server/plugins/event-notifier/template-schema";
import { renderWorkerAssignmentSms, EDLS_REVIEW_NOTICE } from "@shared/edls-worker-assignment";
import { formatYmd } from "@shared/utils/date";

vi.mock("../../server/services/component-cache", () => ({ isComponentEnabledSync: () => true }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { edlsSheetWorkerSmsNotifier } from "../../server/plugins/event-notifier/plugins/edls-sheet-worker-sms-notifier";
import { createTokenEvalContext, renderTokens } from "../../server/plugins/tokens";

const context: EventNotifierEventContext = { event: edlsSheetWorkerSmsNotifier.subscribedEvents[0], payload: {} };
const plugin: EventNotifierPlugin = {
  ...edlsSheetWorkerSmsNotifier,
  tokenTemplates: {
    ...edlsSheetWorkerSmsNotifier.tokenTemplates!,
    roots: [{
      ...edlsSheetWorkerSmsNotifier.tokenTemplates!.roots[0],
      async build(_ctx, recipient) {
        if (!recipient || recipient.contactId === "missing") return null;
        return {
          kind: "edls",
          row: {
            date: "Monday, June 1, 2099",
            employer: { name: "Sheet employer" },
            worker: {
              schedule: { url: `https://example.invalid/edls-sched/token-${recipient.contactId}` },
              assignment: { render_sms: `Only ${recipient.contactId}'s covered assignments` },
            },
          },
        };
      },
    }],
    selectVariant: (_ctx, recipient) => recipient.contactId === "removed" ? "removed" : undefined,
  },
};

async function prepare(contactId: string, data: unknown = {}, cache = new Map<string, unknown>()) {
  return buildRecipientTemplateContext(plugin, context, { contactId }, data, {
    seeds: [], templates: resolveTemplates(plugin, data), cache,
  });
}
async function message(contactId: string, data: unknown = {}) {
  const prepared = await prepare(contactId, data);
  if (!prepared) return null;
  return (await composeFromTemplates(
    plugin, "sms", { contactId }, prepared.seeds, prepared.templates, prepared.cache,
  )).content?.body;
}

describe("recipient-scoped notifier templates", () => {
  it("isolates both requested token chains and render caches between recipients", async () => {
    const eventCache = new Map([["event", "shared"]]);
    const a = await prepare("a", {}, eventCache);
    const b = await prepare("b", {}, eventCache);
    expect(a!.cache).not.toBe(b!.cache);
    expect(a!.cache).not.toBe(eventCache);
    expect(eventCache.size).toBe(1);
    const bodyA = await message("a");
    const bodyB = await message("b");
    expect(bodyA).toContain("Updated work assignment from Sheet employer:");
    expect(bodyA).toContain("Only a's covered assignments");
    expect(bodyA).toContain("/edls-sched/token-a");
    expect(bodyA).not.toContain("token-b");
    expect(bodyB).toContain("Only b's covered assignments");
    expect(bodyB).not.toContain("Only a");
    expect(bodyB).not.toContain("token-a");
  });

  it("selects and resets each variant independently, across configurations", async () => {
    const data = { templates: { sms: { body: "Update {{edls.worker.schedule.url}}" }, removed_sms: { body: "Removal {{edls.worker.schedule.url}}" } } };
    expect(await message("a", data)).toBe("Update https://example.invalid/edls-sched/token-a");
    expect(await message("removed", data)).toBe("Removal https://example.invalid/edls-sched/token-removed");
    const reset = { templates: { sms: { body: "" }, removed_sms: { body: "  " } } };
    expect(await message("a", reset)).toContain("Updated work assignment");
    const removed = await message("removed", reset);
    expect(removed).toContain("no longer scheduled");
    expect(removed).toContain("June 1, 2099");
    expect(removed).toContain("token-removed");
    expect(removed).not.toMatch(/accept|decline|covered assignments/i);
    expect(await prepare("missing")).toBeNull();
    expect(() => defaultTemplatesFor(plugin, {}, "unknown")).toThrow("Unknown notifier template variant");
  });

  it("leaves existing event-wide notifiers on their existing roots and cache", async () => {
    const base = { seeds: [], templates: { sms: { body: "Old default" } }, cache: new Map() };
    const ordinary = { ...plugin, tokenTemplates: { roots: [], defaultTemplates: () => base.templates } };
    const result = await buildRecipientTemplateContext(ordinary, context, { contactId: "a" }, {}, base);
    expect(result!.cache).toBe(base.cache);
    expect(result!.seeds).toBe(base.seeds);
    expect(result!.templates).toBe(base.templates);
  });

  it("offers coherent fictional previews without reading a worker or issuing an access link", async () => {
    const headings: Record<string, string> = {
      martian: "=== FRIDAY, MAR 14, 2031 ===",
      historical: "=== SUNDAY, DEC 10, 1843 ===",
      mythological: "=== FRIDAY, MAR 2, 1184 ===",
    };
    for (const persona of ["martian", "historical", "mythological"]) {
      for (const variant of [undefined, "removed"]) {
        const template = defaultTemplatesFor(plugin, {}, variant).sms!.body;
        const result = await renderTokens(template, createTokenEvalContext({} as never, undefined, {
          sample: true, sampleSetIds: { edls: persona },
        }), { strictUnknown: true });
        expect(result.unknownTokens).toEqual([]);
        expect(result.emptyValues).toEqual([]);
        expect(result.output).toContain(`example.invalid/edls-sched/sample-${persona}`);
        expect(result.output).not.toContain("token-a");
        expect(result.output).not.toMatch(/Response:|Rev\. #|Updated:|Revision unavailable|Update time unavailable|Awaiting your response/);
        if (!variant) {
          expect(result.output).toContain(`:\n\n${headings[persona]}\n\nEvent:`);
          expect(result.output).toContain("Job #: SAMPLE-204");
          expect(result.output).toContain("Checkin Location: Sample check-in desk\n\nAccept or decline:\n");
        }
        else expect(result.output).not.toMatch(/accept|decline/i);
      }
    }
  });

  it("declares both cards and preserves hidden overrides in the shared schema", () => {
    const schema = { type: "object", properties: { templates: templatesSchemaBlock({
      variants: [{ id: "removed", label: "Removal", channels: ["sms"] }],
    }) } };
    expect(stampNotifierTemplateIds(schema, plugin.id)).toBe(4);
    const hidden = hideUnsupportedTemplateChannels(schema, ["sms"])!;
    const groups = ((hidden.properties as any).templates.properties);
    expect(groups.sms["x-token-hidden"]).toBeUndefined();
    expect(groups.removed_sms["x-token-hidden"]).toBeUndefined();
    expect(groups.email["x-token-hidden"]).toBe(true);
    expect(groups.inapp["x-token-hidden"]).toBe(true);
    expect(groups.removed_sms["x-token-channel"]).toBe("sms");
    expect(groups.removed_sms["x-token-variant"]).toBe("removed");
    expect(groups.removed_sms.properties.body).toBeDefined();
    expect(groups.removed_sms["x-token-context-id"]).toBe(groups.sms["x-token-context-id"]);
  });
});

describe("worker-facing assignment SMS projection", () => {
  const details = {
    ymd: "2099-06-01", sheetStatus: "lock", sheetTitle: "JOB-7", crewTitle: "Rigging",
    startTime: "07:00", location: "North entrance",
    facility: { name: "Arena" }, jobGroup: { name: "Exhibition" },
    showStatus: { name: "Confirmed" }, department: { name: "Operations" },
    task: { name: "Setup" }, classification: { name: "Rigger", code: "RIG" },
    accepted: false, data: { startTime: "13:30", private: "staff-only" },
    revision: 4, updatedAt: "2099-05-31T12:00:00.000Z",
  };
  it.each(["lock", "reserved"])("keeps ordered assignment fields and overrides without response or metadata for %s", sheetStatus => {
    const expectedLines = [
      "", "=== MONDAY, JUN 1, 2099 ===", "",
      "Event: Exhibition", "Event Status: Confirmed", "Department: Operations", "Job #: JOB-7",
      "Facility: Arena", "Crew: Rigging", "Task: Setup", "Classification: RIG",
      "Start Time: 1:30 PM", "Checkin Location: North entrance",
    ];
    for (const accepted of [true, false, null, undefined]) {
      for (const metadata of [
        { revision: 4, updatedAt: details.updatedAt },
        { revision: null, updatedAt: null },
        { revision: undefined, updatedAt: undefined },
      ]) {
        const text = renderWorkerAssignmentSms({ ...details, sheetStatus, accepted, ...metadata });
        expect(text.split("\n")).toEqual(expectedLines);
        expect(text).not.toMatch(/Response:|Accepted|Declined|Awaiting your response|Rev\. #|Updated:|Revision unavailable|Update time unavailable/);
        expect(text).not.toContain(details.updatedAt);
        expect(text).not.toContain("staff-only");
      }
    }
    const withoutOverrides = renderWorkerAssignmentSms({
      ...details, sheetStatus, data: null, classification: { name: "Rigger", code: null },
      revision: null, updatedAt: null,
    });
    expect(withoutOverrides.split("\n")).toEqual(expectedLines.map(line =>
      line === "Classification: RIG" ? "Classification: Rigger" :
        line === "Start Time: 1:30 PM" ? "Start Time: 7:00 AM" : line,
    ));
  });
  it.each(["draft", "request", "trash", "unexpected"])("never exposes unconfirmed details for %s", sheetStatus => {
    const text = renderWorkerAssignmentSms({ ...details, sheetStatus });
    expect(text).toBe(`\n=== MONDAY, JUN 1, 2099 ===\n\n${
      sheetStatus === "draft" || sheetStatus === "request"
        ? EDLS_REVIEW_NOTICE
        : "This assignment is not currently published. Please check your current schedule."
    }`);
  });

  it("keeps prominent dates separated in the composed default message with multiple assignments", async () => {
    const assignments = [
      renderWorkerAssignmentSms({ ...details, ymd: "2026-10-19" }),
      renderWorkerAssignmentSms({ ...details, ymd: "2026-10-20", sheetStatus: "request" }),
    ].join("\n");
    const result = await composeFromTemplates(
      edlsSheetWorkerSmsNotifier, "sms", { contactId: "fixture" },
      [{
        name: "edls", entity: { kind: "edls", row: {
          employer: { name: "Sheet employer" },
          worker: {
            schedule: { url: "https://example.invalid/edls-sched/fixture" },
            assignment: { render_sms: assignments },
          },
        } },
      }],
      defaultTemplatesFor(edlsSheetWorkerSmsNotifier, {}), new Map(),
    );
    expect(result.content?.body).toBe(
      "Updated work assignment from Sheet employer:\n\n=== MONDAY, OCT 19, 2026 ===\n\n" +
      "Event: Exhibition\nEvent Status: Confirmed\nDepartment: Operations\nJob #: JOB-7\n" +
      "Facility: Arena\nCrew: Rigging\nTask: Setup\nClassification: RIG\n" +
      "Start Time: 1:30 PM\nCheckin Location: North entrance\n\n" +
      `=== TUESDAY, OCT 20, 2026 ===\n\n${EDLS_REVIEW_NOTICE}\n\n` +
      "Accept or decline:\nhttps://example.invalid/edls-sched/fixture",
    );
  });

  it("does not change existing date formats used outside the assignment render", () => {
    expect(formatYmd("2026-10-19", "weekday-long")).toBe("Mon, October 19, 2026");
    expect(formatYmd("2026-10-19", "weekday-short")).toBe("Mon, Oct 19, 2026");
    expect(formatYmd("2026-10-19", "long")).toBe("October 19, 2026");
    expect(formatYmd("2026-10-19", "short")).toBe("Oct 19, 2026");
  });
});
