import { describe, expect, it } from "vitest";
import {
  ONLINE_PAYMENT_AUTHORIZATION_VARIABLE,
  ONLINE_LEDGER_PAYMENT_TYPE_IDS,
  ledgerPaymentTypeIdForProviderMethod,
  onlinePaymentAuthorizationTextsSchema,
  onlinePaymentSettingsSchema,
} from "@shared/ledger/online-payments";
import { ledgerAccountDataSchema } from "@shared/schema";
import {
  getVariableRegistryEntry,
  validateVariableValue,
} from "../../server/modules/system/variable-registry";

describe("online payment account settings", () => {
  it("uses safe defaults without enabling checkout", () => {
    expect(onlinePaymentSettingsSchema.parse({})).toEqual({
      enabled: false,
      payerTypes: ["worker", "employer"],
      allowPartial: true,
      minAmount: 1,
    });
    expect(ledgerAccountDataSchema.parse({})).toEqual({});
  });

  it("accepts only v1 payer and financial method types", () => {
    expect(() => onlinePaymentSettingsSchema.parse({
      paymentTypes: ["paypal"],
    })).toThrow();
    expect(() => onlinePaymentSettingsSchema.parse({
      payerTypes: ["staff"],
    })).toThrow();
    expect(() => onlinePaymentSettingsSchema.parse({
      minAmount: 1.001,
    })).toThrow();
  });

  it("maps provider methods to stable financial payment type ids", () => {
    expect(ledgerPaymentTypeIdForProviderMethod("card"))
      .toBe(ONLINE_LEDGER_PAYMENT_TYPE_IDS.card);
    expect(ledgerPaymentTypeIdForProviderMethod("us_bank_account"))
      .toBe(ONLINE_LEDGER_PAYMENT_TYPE_IDS.ach);
  });
});

describe("online payment authorization configuration", () => {
  it("requires separately versioned consumer and business text", () => {
    expect(onlinePaymentAuthorizationTextsSchema.safeParse({
      consumer: { version: "consumer-v1", text: "Consumer authorization" },
    }).success).toBe(false);

    expect(onlinePaymentAuthorizationTextsSchema.parse({
      consumer: { version: "consumer-v1", text: "Consumer authorization" },
      business: { version: "business-v1", text: "Business authorization" },
    })).toEqual({
      consumer: { version: "consumer-v1", text: "Consumer authorization" },
      business: { version: "business-v1", text: "Business authorization" },
    });
  });

  it("registers the authorization copy in configurable variable storage", () => {
    expect(getVariableRegistryEntry(ONLINE_PAYMENT_AUTHORIZATION_VARIABLE))
      .toMatchObject({ readTier: "authenticated", component: "ledger" });

    const result = validateVariableValue(
      ONLINE_PAYMENT_AUTHORIZATION_VARIABLE,
      {
        consumer: { version: "consumer-v1", text: "Consumer authorization" },
        business: { version: "", text: "Business authorization" },
      },
    );
    expect(result.ok).toBe(false);
  });
});