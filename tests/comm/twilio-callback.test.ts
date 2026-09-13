import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

const state = vi.hoisted(() => ({
  configs: [] as any[],
  secrets: {} as Record<string, string>,
}));

const getEnvironmentVariable = vi.hoisted(() =>
  vi.fn((name: string) => state.secrets[name]),
);
const registerEnvironmentVariable = vi.hoisted(() => vi.fn());
const validateRequest = vi.hoisted(() => vi.fn(() => true));

vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable,
  registerEnvironmentVariable,
}));

vi.mock("../../server/storage", () => ({
  storage: {
    pluginConfigs: {
      getByKindAndPlugin: vi.fn(async () => state.configs),
    },
  },
}));

vi.mock("twilio", () => ({
  default: { validateRequest },
}));

function request(accountSid: string): Request {
  return {
    body: { AccountSid: accountSid },
    headers: {
      "x-twilio-signature": "valid-signature",
      host: "example.test",
    },
    protocol: "https",
    originalUrl: "/api/comm/statuscallback/comm-1",
  } as unknown as Request;
}

function config(
  id: string,
  accountSid: string,
  enabled: boolean,
  secretName: string,
) {
  return {
    id,
    enabled,
    data: { accountSid, secretName },
  };
}

describe("Twilio callback configuration matching", () => {
  beforeEach(() => {
    state.configs = [];
    state.secrets = {};
    getEnvironmentVariable.mockClear();
    registerEnvironmentVariable.mockClear();
    validateRequest.mockClear();
    validateRequest.mockReturnValue(true);
  });

  it("accepts an in-flight callback through a disabled matching Twilio config", async () => {
    state.configs = [config("old-twilio", "AC_old", false, "TWILIO_OLD_TOKEN")];
    state.secrets.TWILIO_OLD_TOKEN = "old-auth-token";
    const { TwilioStatusHandler } = await import(
      "../../server/services/comm/callback-handlers/twilio"
    );

    const result = await new TwilioStatusHandler().validateRequest(request("AC_old"));

    expect(result).toEqual({ valid: true });
    expect(getEnvironmentVariable).toHaveBeenCalledWith("TWILIO_OLD_TOKEN");
    expect(validateRequest).toHaveBeenCalledWith(
      "old-auth-token",
      "valid-signature",
      "https://example.test/api/comm/statuscallback/comm-1",
      { AccountSid: "AC_old" },
    );
  });

  it("rejects a callback whose account SID matches no enabled or disabled config", async () => {
    state.configs = [config("old-twilio", "AC_old", false, "TWILIO_OLD_TOKEN")];
    state.secrets.TWILIO_OLD_TOKEN = "old-auth-token";
    const { TwilioStatusHandler } = await import(
      "../../server/services/comm/callback-handlers/twilio"
    );

    const result = await new TwilioStatusHandler().validateRequest(request("AC_other"));

    expect(result).toEqual({
      valid: false,
      error: "No Twilio SMS configuration matches callback account",
    });
    expect(getEnvironmentVariable).not.toHaveBeenCalled();
    expect(validateRequest).not.toHaveBeenCalled();
  });

  it("rejects ambiguous matching account configurations fail-closed", async () => {
    state.configs = [
      config("active-twilio", "AC_same", true, "TWILIO_ACTIVE_TOKEN"),
      config("old-twilio", "AC_same", false, "TWILIO_OLD_TOKEN"),
    ];
    state.secrets.TWILIO_ACTIVE_TOKEN = "active-auth-token";
    state.secrets.TWILIO_OLD_TOKEN = "old-auth-token";
    const { TwilioStatusHandler } = await import(
      "../../server/services/comm/callback-handlers/twilio"
    );

    const result = await new TwilioStatusHandler().validateRequest(request("AC_same"));

    expect(result).toEqual({
      valid: false,
      error: "Ambiguous Twilio SMS configuration for callback account",
    });
    expect(getEnvironmentVariable).not.toHaveBeenCalled();
    expect(validateRequest).not.toHaveBeenCalled();
  });
});