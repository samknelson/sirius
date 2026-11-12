import { z } from "zod";
import { getCurrentEffectiveRate } from "../../../utils/rateHistory";

export const gbhetLegalBenefitSettingsSchema = z.object({
  benefitId: z.string().uuid(),
  rateHistory: z.array(z.object({
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rate: z.number(),
  })).min(1),
  billingOffsetMonths: z.number().int().default(-3),
});

/** Pure billing calculation. No account creation or ledger reads/writes.
 * Missing pricing is different from an explicitly configured zero rate. */
export function legalBenefitPrice(settings: unknown, year: number, month: number) {
  const parsed = gbhetLegalBenefitSettingsSchema.safeParse(settings);
  if (!parsed.success) return null;
  const billingOffset = parsed.data.billingOffsetMonths;
  const billingDate = new Date(year, month - 1 + billingOffset, 1);
  const applicableRate = getCurrentEffectiveRate(parsed.data.rateHistory, billingDate);
  if (!applicableRate) return null;
  const billingYear = billingDate.getFullYear();
  const billingMonth = billingDate.getMonth() + 1;
  return {
    billingOffset, billingYear, billingMonth, applicableRate,
    amount: applicableRate.rate.toFixed(2),
    transactionDate: new Date(billingYear, billingMonth, 0),
  };
}
