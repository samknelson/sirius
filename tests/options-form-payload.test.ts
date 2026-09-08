import { describe, expect, it } from "vitest";
import { formDataToPayload } from "../client/src/components/shared/options-form-payload";
import type { JsonSchema } from "@shared/json-schema-form";

describe("generic options edit payload", () => {
  it("sends explicit nulls when optional deadline controls are cleared", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["name", "caseTypeId"],
      properties: {
        name: { type: "string" },
        caseTypeId: { type: "string" },
        durationDays: { type: "integer" },
        lapseStatusId: { type: "string", "x-options-resource": "bao-case-status" },
      },
    };
    const initial = {
      name: "Trustee Review",
      caseTypeId: "appeal",
      durationDays: 30,
      lapseStatusId: "auto-denied",
    };

    expect(formDataToPayload(
      { name: "Trustee Review", caseTypeId: "appeal" },
      schema,
      initial,
    )).toEqual({
      name: "Trustee Review",
      caseTypeId: "appeal",
      durationDays: null,
      lapseStatusId: null,
    });
  });
});