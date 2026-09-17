import { describe, expect, it } from "vitest";

import { requireWorkerSiriusId } from "../../server/plugins/trust/provider-edi/base";

describe("required EDI worker Sirius IDs", () => {
  it.each([null, -1, 1.5])("rejects an invalid worker Sirius ID (%s)", (workerSiriusId) => {
    expect(() =>
      requireWorkerSiriusId(
        {
          contactId: "contact-without-sid",
          workerSiriusId,
          givenName: "Shell",
          familyName: "Worker",
        },
        "Hinge",
      ),
    ).toThrow(
      'Hinge EDI report cannot be generated: worker "Shell Worker" (contact-without-sid) has no Sirius ID.',
    );
  });

  it("returns the numeric Sirius ID as the carrier identifier", () => {
    expect(
      requireWorkerSiriusId(
        {
          contactId: "contact-4172",
          workerSiriusId: 4172,
          givenName: "Covered",
          familyName: "Worker",
        },
        "MLK",
      ),
    ).toBe("4172");
  });
});