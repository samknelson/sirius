import { registerTokenPlugin } from "../registry";
import { tokenEntityOf, type TokenEntity } from "../types";
import { employers } from "@shared/schema";
import { renderWorkerAssignmentSms } from "@shared/edls-worker-assignment";
import { formatYmd } from "@shared/utils/date";

// These are message-context kinds, NOT aliases for workers or edls_sheets.
// They resolve only from an explicitly seeded recipient context. In particular
// evaluation never looks up or creates a bearer credential.
const personas = [
  { id: "martian", label: "Martian", date: "2031-03-14", employer: "Olympus Mons Freight", crew: "Sector 7 Regolith Crew" },
  { id: "historical", label: "Historical", date: "1843-12-10", employer: "Difference Engine Works", crew: "Analytical Shift" },
  { id: "mythological", label: "Mythological", date: "1184-03-02", employer: "Ithaka Shipping Company", crew: "Fleet Navigation Crew" },
];
registerTokenPlugin({
  metadata: {
    id: "token.edls_notification", name: "EDLS worker notification",
    description: "Recipient-scoped EDLS notification context",
    segmentName: "__edls_notification", inputTypes: [], outputType: "edls",
    hiddenFromPicker: true, requiredComponent: "edls", entityFields: ["date"],
    sampleSets: personas.map(p => ({
      id: p.id, label: p.label, values: { date: formatYmd(p.date, "weekday-long") },
    })),
  },
  async resolve() { return null; },
});

function relation(segment: string, from: string, to: string, opts: {
  defaultLeaf?: string;
  entityTable?: TokenEntity["table"];
  entityFields?: string[];
  sampleSets?: Array<{ id: string; label: string; values: Record<string, string> }>;
} = {}) {
  registerTokenPlugin({
    metadata: {
      id: `token.${from}.${segment}`, name: segment === "employer" ? "Sheet employer" : segment,
      description: `The notification recipient's ${segment}`,
      segmentName: segment, inputTypes: [from], outputType: to,
      requiredComponent: "edls", ...opts,
    },
    async resolve(entity) {
      const value = tokenEntityOf(entity, from)?.row[segment];
      return value && typeof value === "object"
        ? { kind: to, row: value as Record<string, unknown>, ...(opts.entityTable ? { table: opts.entityTable } : {}) }
        : null;
    },
  });
}
relation("worker", "edls", "edls_worker", { entityFields: ["id"] });
relation("employer", "edls", "employer", { defaultLeaf: "name", entityTable: employers });
relation("schedule", "edls_worker", "edls_worker_schedule", {
  defaultLeaf: "url",
  entityFields: ["url"],
  sampleSets: personas.map(p => ({
    id: p.id, label: p.label,
    values: { url: `https://example.invalid/edls-sched/sample-${p.id}` },
  })),
});
relation("assignment", "edls_worker", "edls_worker_assignment", {
  defaultLeaf: "render_sms",
  entityFields: ["render_sms"],
  sampleSets: personas.map(p => ({
    id: p.id, label: p.label,
    values: { render_sms: renderWorkerAssignmentSms({
      ymd: p.date, sheetStatus: "lock", sheetTitle: "SAMPLE-204",
      crewTitle: p.crew, startTime: "08:30", location: "Sample check-in desk",
      facility: { name: "Sample Exhibition Hall" }, jobGroup: { name: p.crew },
      showStatus: { name: "Confirmed" }, department: { name: "Sample Operations" },
      task: { name: "Setup" }, classification: { name: "Sample Rigger", code: "RIG" },
      accepted: null, data: null, revision: 2, updatedAt: `${p.date}T12:00:00.000Z`,
    }) },
  })),
});

for (const [segment, kind, label] of [
  ["url", "edls_worker_schedule", "Worker schedule URL"],
  ["render_sms", "edls_worker_assignment", "Assignment (SMS)"],
  ["date", "edls", "Triggering sheet date"],
] as const) {
  registerTokenPlugin({
    metadata: {
      id: `token.${kind}.${segment}`, name: label,
      description: label, segmentName: segment, inputTypes: [kind], outputType: "value",
      requiredComponent: "edls",
    },
    async resolve(entity) {
      const value = tokenEntityOf(entity, kind)?.row[segment];
      return typeof value === "string" ? value : null;
    },
    sampleValue: () => segment === "date" ? "Friday, March 14, 2031" : "",
  });
}
