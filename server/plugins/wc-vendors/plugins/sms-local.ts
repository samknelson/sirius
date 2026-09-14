import { parsePhoneNumber } from "libphonenumber-js";
import type { GatewayConnectionTest, WcVendorPlugin } from "../types";
import { registerWcVendorPlugin } from "../registry";
import type { SmsValidatePhoneResult } from "../sms-types";
import "../sms-types";

const localSmsPlugin: WcVendorPlugin = {
  id: "sms-local",
  name: "Local SMS",
  description: "Local SMS provider for phone-number validation; it does not deliver messages.",
  credential: { secretName: "none" },
  operations: {
    "service.test-connection": {
      description: "test local SMS provider",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      async run(): Promise<GatewayConnectionTest> {
        return {
          connected: true,
          account: { id: "sms-local", type: "local" },
        };
      },
    },
    "communications.phone.validate": {
      description: "validate a phone number locally",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: { phoneNumber: { type: "string", minLength: 1 } },
          required: ["phoneNumber"],
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(_ctx, { phoneNumber }): Promise<SmsValidatePhoneResult> {
        const parsed = parsePhoneNumber(phoneNumber, "US");
        if (!parsed || !parsed.isValid()) {
          return { valid: false, error: "Invalid phone number format." };
        }
        return {
          valid: true,
          formatted: parsed.format("E.164"),
          countryCode: parsed.country,
          nationalNumber: parsed.nationalNumber,
          type: parsed.getType() || "unknown",
          smsPossible: true,
          voicePossible: true,
        };
      },
    },
  },
};

registerWcVendorPlugin(localSmsPlugin);