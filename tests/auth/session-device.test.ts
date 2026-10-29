import { describe, expect, it } from "vitest";
import { sessionDeviceUserAgent, withSessionUserAgent } from "@shared/session-device";

describe("supplied session device JSON", () => {
  it("merges only user_agent and leaves all other metadata intact", () => {
    const original = {
      authenticationSessionReference: "a".repeat(64),
      extra: { preserved: true },
      device: { browser_id: "synthetic-future-value", user_agent: "Old/1" },
    };
    const result = withSessionUserAgent(original, "Supplied/2 <not HTML>");
    expect(result).toEqual({
      ...original, device: { ...original.device, user_agent: "Supplied/2 <not HTML>" },
    });
    expect(original.device.user_agent).toBe("Old/1");
    expect(sessionDeviceUserAgent(result)).toBe("Supplied/2 <not HTML>");
  });

  it.each([null, undefined, "", {}, [], 123])("absent or invalid supplied details do not erase stored data: %j", value => {
    const original = { device: { user_agent: "Known/1" }, extra: true };
    expect(withSessionUserAgent(original, value)).toBe(original);
    expect(withSessionUserAgent(null, value)).toBeNull();
  });

  it.each([null, undefined, [], 4, "legacy", {}, { device: [] }, { device: "bad" },
    { device: { user_agent: {} } }, { device: { user_agent: 123 } },
    { device: { user_agent: "" } }])("reads missing or malformed JSON safely: %j", data => {
    expect(sessionDeviceUserAgent(data)).toBeNull();
  });
});
