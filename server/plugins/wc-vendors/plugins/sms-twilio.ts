import twilio from "twilio";
import { parsePhoneNumber } from "libphonenumber-js";
import type { GatewayConnectionTest, WcVendorContext, WcVendorPlugin } from "../types";
import {
  registerWcVendorPlugin,
} from "../registry";
import type {
  SmsPhoneNumber,
  SmsSendResult,
  SmsValidatePhoneResult,
} from "../sms-types";
import "../sms-types";
import type { WcAnswer } from "../../../services/webclient";
import {
  getPhoneValidationSettings,
  revalidateAfterDays,
} from "../../../services/comm/validators/phone-validation-settings";

const DAY_MS = 24 * 60 * 60 * 1000;

function data(ctx: WcVendorContext): Record<string, unknown> {
  return ctx.config.data && typeof ctx.config.data === "object"
    ? (ctx.config.data as Record<string, unknown>)
    : {};
}

function accountSid(ctx: WcVendorContext): string {
  return typeof data(ctx).accountSid === "string"
    ? (data(ctx).accountSid as string).trim()
    : "";
}

function fromNumber(ctx: WcVendorContext): string {
  return typeof data(ctx).fromNumber === "string"
    ? (data(ctx).fromNumber as string).trim()
    : "";
}

function client(ctx: WcVendorContext) {
  const sid = accountSid(ctx);
  if (!sid) throw new Error("Twilio account SID is not configured");
  if (!ctx.credential.value) throw new Error("Twilio auth token is not configured");
  return twilio(sid, ctx.credential.value);
}

const twilioSmsPlugin: WcVendorPlugin = {
  id: "twilio",
  name: "Twilio SMS",
  description:
    "Twilio SMS delivery. The account SID and sending number are configuration values; the named secret contains the auth token.",
  credential: {
    secretName: "required",
    setupGuidance:
      "The named secret must contain the Twilio auth token. Account SID and the Twilio sending phone number are entered as configuration values.",
  },
  configFields: [
    {
      name: "accountSid",
      label: "Twilio Account SID",
      type: "string",
      required: true,
    },
    {
      name: "fromNumber",
      label: "Twilio From Number",
      type: "string",
      required: true,
    },
  ],
  validateConfig(config) {
    const sid = typeof config.accountSid === "string" ? config.accountSid.trim() : "";
    const from = typeof config.fromNumber === "string" ? config.fromNumber.trim() : "";
    const errors: string[] = [];
    if (sid && !sid.startsWith("AC")) {
      errors.push('Twilio Account SID must start with "AC".');
    }
    if (from && !from.startsWith("+")) {
      errors.push("Twilio From Number must be an E.164 phone number.");
    }
    return errors.length ? { valid: false, errors } : { valid: true };
  },
  service: "Twilio",
  operations: {
    "service.test-connection": {
      description: "test Twilio connection",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: { type: "object", properties: {}, additionalProperties: false },
        effect: "read",
      },
      async run(ctx): Promise<GatewayConnectionTest> {
        try {
          const accounts = await client(ctx).api.accounts.list({ limit: 1 });
          const account = accounts[0];
          if (!account) {
            return {
              connected: false,
              error: { message: "No Twilio account found" },
            };
          }
          return {
            connected: true,
            account: {
              id: account.sid,
              type: account.status,
            },
            testMode: false,
          };
        } catch (error: any) {
          return {
            connected: false,
            error: {
              message: error?.message || "Failed to connect to Twilio",
              code: error?.code ? String(error.code) : undefined,
            },
          };
        }
      },
    },
    "communications.sms.configuration.read": {
      description: "read Twilio account configuration",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(ctx): Promise<Record<string, unknown>> {
        const accounts = await client(ctx).api.accounts.list({ limit: 1 });
        const account = accounts[0];
        return {
          connected: !!account,
          accountSid: account?.sid ?? accountSid(ctx),
          accountName: account?.friendlyName,
          configuredPhoneNumber: fromNumber(ctx),
          defaultFromNumber: fromNumber(ctx),
        };
      },
    },
    "communications.phone.validate": {
      description: "look up a phone number with Twilio",
      needsWritableDatabase: true,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {
            phoneNumber: {
              type: "string",
              title: "Phone number",
              minLength: 1,
              pattern: "\\S",
            },
          },
          required: ["phoneNumber"],
          additionalProperties: false,
        },
        effect: "read",
      },
      cache: {
        mode: "cached",
        freshFor: async () =>
          revalidateAfterDays(await getPhoneValidationSettings()) * DAY_MS,
        failureRememberedFor: 5 * 60 * 1000,
        requestKey: ({ phoneNumber }) => phoneNumber,
      },
      async run(
        ctx,
        { phoneNumber },
      ): Promise<WcAnswer<SmsValidatePhoneResult>> {
        const parsed = parsePhoneNumber(phoneNumber, "US");
        if (!parsed || !parsed.isValid()) {
          return {
            answered: true,
            value: { valid: false, error: "Invalid phone number format." },
            store: false,
          };
        }
        const e164 = parsed.format("E.164");
        const result = await client(ctx).lookups.v2.phoneNumbers(e164).fetch({
          fields: "line_type_intelligence",
        });
        const lineType = result.lineTypeIntelligence?.type?.toLowerCase();
        const value: SmsValidatePhoneResult = {
          valid: result.valid,
          formatted: result.phoneNumber,
          countryCode: result.countryCode,
          nationalNumber: parsed.nationalNumber,
          type: result.lineTypeIntelligence?.type,
          carrier: result.lineTypeIntelligence?.carrierName,
          smsPossible: lineType !== "landline" && lineType !== "unknown",
          voicePossible: lineType !== "unknown",
        };
        if (value.valid && result.lineTypeIntelligence === undefined) {
          return {
            answered: false,
            error: "Provider answered without line-type intelligence",
          };
        }
        return { answered: true, value, store: value.valid };
      },
    },
    "communications.sms.send": {
      description: "send an SMS with Twilio",
      needsWritableDatabase: true,
      async run(ctx, params): Promise<SmsSendResult> {
        const from = params.from || fromNumber(ctx);
        if (!from) return { success: false, error: "No Twilio from phone number configured" };
        try {
          const messageParams: Record<string, string> = {
            to: params.to,
            from,
            body: params.body,
          };
          if (params.statusCallbackUrl) {
            messageParams.statusCallback = params.statusCallbackUrl;
          }
          const message = await client(ctx).messages.create(messageParams as any);
          return {
            success: true,
            messageId: message.sid,
            status: message.status,
            details: {
              dateSent: message.dateSent,
              direction: message.direction,
            },
          };
        } catch (error: any) {
          return {
            success: false,
            error: error?.message || "Failed to send SMS",
            details: {
              code: error?.code,
              moreInfo: error?.moreInfo,
            },
          };
        }
      },
    },
    "communications.phone.list": {
      description: "list Twilio phone numbers",
      needsWritableDatabase: false,
      manualRun: {
        argsSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        effect: "read",
      },
      async run(ctx): Promise<SmsPhoneNumber[]> {
        const numbers = await client(ctx).incomingPhoneNumbers.list({ limit: 50 });
        return numbers.map((number) => ({
          sid: number.sid,
          phoneNumber: number.phoneNumber,
          friendlyName: number.friendlyName,
          capabilities: {
            sms: !!number.capabilities?.sms,
            voice: !!number.capabilities?.voice,
            mms: !!number.capabilities?.mms,
          },
        }));
      },
    },
  },
};

registerWcVendorPlugin(twilioSmsPlugin);