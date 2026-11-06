import { describe, expect, it } from "vitest";
import { createUnifiedOptionsStorage } from "../../server/storage/unified-options";
import { getOptionsType } from "../../server/modules/options-registry";
import {
  buildOptionCreateData, buildOptionUpdateData, validateOptionTypeSpecificData,
} from "../../server/modules/options-write-rules";
import { formDataToPayload } from "../../client/src/components/shared/options-form-payload";
import { isWorkerElectionRelationshipAvailable } from "@shared/utils/enrollment-relationship-choices";
import { findSystemHelpsForPath, getAllSystemHelps } from "../../server/help/system";

const key = "availableToWorkersInElectionWizards";
const type = "worker-relation-type";

describe("worker election relationship options", () => {
  it("declares a checked-by-default admin checkbox stored in per-type JSON", () => {
    const definition = createUnifiedOptionsStorage().getDefinition(type)!;
    expect(definition.fields.find(field => field.name === key)).toMatchObject({
      inputType: "checkbox", default: true, dataField: true, showInTable: true,
    });
    expect(definition.schema.properties?.[key]).toMatchObject({
      type: "boolean", default: true, "x-data-field": true,
    });
    const config = getOptionsType(type)!;
    for (const available of [false, true]) {
      const payload = formDataToPayload({ name: "Arbitrary configured type", [key]: available }, definition.schema);
      expect(payload.data).toEqual({ [key]: available });
      expect(buildOptionCreateData(config, payload)).toEqual({ data: payload });
      expect(buildOptionUpdateData(config, payload)).toEqual({ updates: payload });
    }
  });

  it.each([undefined, null, {}, { [key]: true }, { unrelated: false }])(
    "preserves legacy/default availability for data %j", data => {
      expect(isWorkerElectionRelationshipAvailable({ data })).toBe(true);
    },
  );
  it("only explicit false restricts a type, irrespective of its name", () => {
    expect(isWorkerElectionRelationshipAvailable({ data: { [key]: false } })).toBe(false);
  });
  it("validates saved values in the shared API/import write rules", async () => {
    for (const data of [undefined, null, {}, { [key]: true }, { [key]: false }]) {
      expect(await validateOptionTypeSpecificData(type, data)).toBeNull();
    }
    for (const value of ["false", 0, null, [], {}]) {
      expect(await validateOptionTypeSpecificData(type, { [key]: value })).toContain("boolean");
    }
  });
  it("registers sanitized built-in guidance on the intended pages without matching sibling lists", () => {
    const id = "system:worker-relationship-election-options";
    expect(getAllSystemHelps().find(help => help.id === id)).toMatchObject({
      source: "system", summary: expect.stringContaining("relationship types"),
      details: expect.stringContaining("<strong>Available to workers in election wizards</strong>"),
    });
    expect(findSystemHelpsForPath(`/config/options/${type}/list`).some(help => help.id === id)).toBe(true);
    for (const path of ["/config/options/gender/list", `/config/options/${type}/export`, "/config/helps"]) {
      expect(findSystemHelpsForPath(path).some(help => help.id === id)).toBe(false);
    }
    for (const path of ["/wizards/fictional", "/workers/fictional/elections/current", "/trust/enrollment-queue"]) {
      expect(findSystemHelpsForPath(path).some(help => help.details?.includes("Some relationship types may be staff-only"))).toBe(true);
    }
  });
});
