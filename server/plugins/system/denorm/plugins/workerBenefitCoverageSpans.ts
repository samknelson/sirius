import { COVERAGE_SPAN_PLUGIN, type CoverageSpanPayload } from "@shared/coverage-span";
import { storage } from "../../../../storage";
import { createDenormSpansStorage } from "../../../../storage/system/denorm-spans";
import { createCoverageSpanSourceStorage } from "../../../../storage/trust/coverage-span-source";
import { deriveCoverageSpans } from "../../../../services/coverage-spans/derive";
import { registerDenormPlugin } from "../registry";
import type { DenormPlugin } from "../types";

const source = createCoverageSpanSourceStorage();
const payloadStorage = createDenormSpansStorage();

const plugin: DenormPlugin<CoverageSpanPayload> = {
  metadata: {
    id: COVERAGE_SPAN_PLUGIN,
    name: "Worker benefit coverage spans",
    description: "Maintains continuous coverage and explainable issues for carrier feeds. Rebuilds never change eligibility.",
    singleton: true,
    requiredComponent: "trust.benefits",
  },
  entityType: "worker",
  invalidateOnConfigChange: true,
  reads: ["workers", "coverageSpanSource"],
  writes: [{ storage: "denormSpans", soleWriter: true }],
  // Do not replace the status row: preserve its monotonically increasing
  // generation. replace() replaces BOTH payload stores within guarded apply.
  async compute(workerId) {
    const { coverage, families, events } = await source.read(workerId);
    return deriveCoverageSpans(workerId, coverage, families, events);
  },
  async write(_workerId, payload, denormId) {
    await payloadStorage.replace(denormId,
      payload.spans.map(span => ({
        subjectId: span.benefitId, startMonth: span.startMonth, lastMonth: span.lastCoveredMonth,
        terminationMonth: span.ending?.month ?? null, data: span,
      })),
      payload.issues.map(issue => ({
        subjectId: issue.benefitId, month: issue.month, reason: issue.reason, data: issue,
      })));
  },
  backfill: (configId, limit) => storage.workers.findIdsMissingDenorm(configId, limit),
  findWidows: (configId, limit) => storage.workers.findDenormWidowIds(configId, limit),
};
registerDenormPlugin(plugin);
