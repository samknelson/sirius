/**
 * Task 415 — member-status hours threshold contract (unit level).
 *
 * The threshold lives canonically at
 * `options_worker_ms.data.sitespecific.bao.threshold`. These tests pin the
 * shared helpers every surface uses (S1 loader, options API, universal form,
 * BAO thresholds page, eligibility resolution):
 *   - decoding the threshold from an S1 taxonomy-term NAME (the only place
 *     the source system carries it),
 *   - the sibling-preserving deep merge with null-leaf deletes,
 *   - server-side validation of the threshold slot,
 *   - the schema/vendor-extension plumbing (`x-data-path`) and the form
 *     payload split that nests the field at its canonical path.
 */
import { describe, expect, it } from "vitest";
import {
  decodeThresholdFromTermName,
  isValidThreshold,
  mergeOptionData,
  readWorkerMsThreshold,
  thresholdPatch,
  validateWorkerMsDataThreshold,
} from "../../shared/worker-ms-threshold";
import { splitPayloadByDataField, VendorExtensions } from "../../shared/json-schema-form";
import { optionsMetadata, fieldsToJsonSchema } from "../../server/storage/unified-options";

describe("decodeThresholdFromTermName (S1 source decoding)", () => {
  // The real 7 production sirius_member_status term names (verified against
  // the live S1 database): the threshold exists ONLY in the name suffix.
  it.each([
    ["Event Center Worker - 100 hours", 100],
    ["Event Center Worker - 60 hours", 60],
    ["Event Center Worker - 80 hours", 80],
    ["UNITE HERE Worker - 60 hours", 60],
    ["Unite Here Restaurant Worker - 60 Hours", 60],
    ["UNITE HERE Worker - 40 Hours", 40],
  ])("decodes %s -> %d", (name, expected) => {
    expect(decodeThresholdFromTermName(name)).toBe(expected);
  });

  it("returns null for a name without a threshold suffix (PA Worker) — never invents a value", () => {
    expect(decodeThresholdFromTermName("PA Worker")).toBeNull();
  });

  it("accepts en/em dashes, singular 'hour', and trailing whitespace", () => {
    expect(decodeThresholdFromTermName("Worker – 55 hours")).toBe(55);
    expect(decodeThresholdFromTermName("Worker — 1 hour  ")).toBe(1);
  });

  it("does not decode numbers that are not a terminal hours suffix", () => {
    expect(decodeThresholdFromTermName("Local 100 Worker")).toBeNull();
    expect(decodeThresholdFromTermName("Worker - 60 hours (retired)")).toBeNull();
  });
});

describe("readWorkerMsThreshold / isValidThreshold", () => {
  it("reads a valid nested threshold", () => {
    expect(readWorkerMsThreshold({ sitespecific: { bao: { threshold: 60 } } })).toBe(60);
  });
  it("rejects invalid shapes and values", () => {
    expect(readWorkerMsThreshold(null)).toBeUndefined();
    expect(readWorkerMsThreshold({})).toBeUndefined();
    expect(readWorkerMsThreshold({ sitespecific: { bao: { threshold: "60" } } })).toBeUndefined();
    expect(readWorkerMsThreshold({ sitespecific: { bao: { threshold: -1 } } })).toBeUndefined();
    expect(readWorkerMsThreshold({ sitespecific: { bao: { threshold: 60.5 } } })).toBeUndefined();
    expect(isValidThreshold(0)).toBe(true);
  });
});

describe("mergeOptionData (sibling-preserving deep merge)", () => {
  it("sets the threshold without touching sibling JSON", () => {
    const existing = { s1Tid: 1667, sitespecific: { bao: { legacyFlag: true } }, other: { a: 1 } };
    const merged = mergeOptionData(existing, thresholdPatch(60));
    expect(merged).toEqual({
      s1Tid: 1667,
      sitespecific: { bao: { legacyFlag: true, threshold: 60 } },
      other: { a: 1 },
    });
    // input not mutated
    expect(existing.sitespecific.bao).toEqual({ legacyFlag: true });
  });

  it("null leaf deletes the key and prunes now-empty objects", () => {
    const merged = mergeOptionData(
      { sitespecific: { bao: { threshold: 60 } }, keep: 1 },
      thresholdPatch(null),
    );
    expect(merged).toEqual({ keep: 1 });
  });

  it("null leaf keeps non-empty parents", () => {
    const merged = mergeOptionData(
      { sitespecific: { bao: { threshold: 60, other: "x" } } },
      thresholdPatch(null),
    );
    expect(merged).toEqual({ sitespecific: { bao: { other: "x" } } });
  });

  it("treats non-object existing data as empty", () => {
    expect(mergeOptionData("garbage", thresholdPatch(40))).toEqual({
      sitespecific: { bao: { threshold: 40 } },
    });
  });
});

describe("validateWorkerMsDataThreshold", () => {
  it("accepts absent, null (clear), and valid values", () => {
    expect(validateWorkerMsDataThreshold(undefined)).toBeUndefined();
    expect(validateWorkerMsDataThreshold(null)).toBeUndefined();
    expect(validateWorkerMsDataThreshold({})).toBeUndefined();
    expect(validateWorkerMsDataThreshold(thresholdPatch(null))).toBeUndefined();
    expect(validateWorkerMsDataThreshold(thresholdPatch(0))).toBeUndefined();
    expect(validateWorkerMsDataThreshold(thresholdPatch(60))).toBeUndefined();
  });
  it("rejects negatives, fractions, and non-numbers", () => {
    for (const bad of [-1, 2.5, "60", true, [], {}]) {
      expect(
        validateWorkerMsDataThreshold({ sitespecific: { bao: { threshold: bad } } }),
      ).toMatch(/whole number/);
    }
    expect(validateWorkerMsDataThreshold("nonsense")).toMatch(/JSON object/);
  });
});

describe("worker-ms definition + payload split", () => {
  const meta = optionsMetadata["worker-ms"];
  const field = meta.fields.find((f) => f.name === "baoThreshold");

  it("exposes the threshold field at the canonical data path", () => {
    expect(field).toBeTruthy();
    expect(field!.dataPath).toEqual(["sitespecific", "bao", "threshold"]);
    expect(field!.inputType).toBe("number");
    expect(field!.min).toBe(0);
    expect(field!.required).toBe(false);
  });

  it("serializes x-data-path and minimum into the JSON schema", () => {
    const { schema } = fieldsToJsonSchema(meta.fields);
    const prop = schema.properties!.baoThreshold as Record<string, unknown>;
    expect(prop[VendorExtensions.dataPath]).toEqual(["sitespecific", "bao", "threshold"]);
    expect(prop.minimum).toBe(0);
    expect(prop.type).toBe("integer");
  });

  it("splitPayloadByDataField nests the value at the canonical path", () => {
    const { schema } = fieldsToJsonSchema(meta.fields);
    const { columnFields, dataFields } = splitPayloadByDataField(schema, {
      name: "Hospitality - 60 hours",
      baoThreshold: 60,
    });
    expect(columnFields.name).toBe("Hospitality - 60 hours");
    expect(columnFields.baoThreshold).toBeUndefined();
    expect(dataFields).toEqual({ sitespecific: { bao: { threshold: 60 } } });
  });

  it("splitPayloadByDataField emits an explicit null leaf when the field was cleared", () => {
    const { schema } = fieldsToJsonSchema(meta.fields);
    const { dataFields } = splitPayloadByDataField(schema, { name: "Hospitality" });
    expect(dataFields).toEqual({ sitespecific: { bao: { threshold: null } } });
  });
});
