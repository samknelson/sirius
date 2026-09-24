import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "../../server/app-init";

describe("payment provider response logging", () => {
  it("redacts SetupIntent and checkout client secrets from response previews", () => {
    const response = {
      clientSecret: "seti_example_secret",
      nested: [{ clientSecret: "pi_example_secret", passwordHash: "bcrypt_example" }],
      componentId: "stripe",
    };
    const result = redactSensitiveData(response);
    expect(result).toEqual({
      clientSecret: "[REDACTED]",
      nested: [{ clientSecret: "[REDACTED]", passwordHash: "[REDACTED]" }],
      componentId: "stripe",
    });
    expect(response.clientSecret).toBe("seti_example_secret");
  });
});