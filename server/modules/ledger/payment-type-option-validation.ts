import { and, eq } from "drizzle-orm";
import { ledgerPayments, optionsLedgerPaymentType } from "@shared/schema";
import type { OptionsBeforeWrite } from "../../storage/options-definition";

/** Ordinary saves cannot reinterpret already-cleared payments. The separate
 * audited correction workflow deliberately does not use ordinary option saves. */
export const validatePaymentTypeWrite: OptionsBeforeWrite = async (context) => {
  const { values, client } = context;
  if (values.direction === undefined) return;
  if (values.direction !== "charge" && values.direction !== "credit") {
    throw new Error("Ledger effect must be Charge or Credit");
  }
  if (context.operation === "create") return;

  // Payment posting holds SHARE on this same row. Keep UPDATE until the
  // enclosing save commits, so posting cannot slip between the check and write.
  const [current] = await client.select({ direction: optionsLedgerPaymentType.direction })
    .from(optionsLedgerPaymentType)
    .where(eq(optionsLedgerPaymentType.id, context.id)).for("update");
  if (current && current.direction !== values.direction) {
    const [posted] = await client.select({ id: ledgerPayments.id })
      .from(ledgerPayments)
      .where(and(eq(ledgerPayments.paymentType, context.id), eq(ledgerPayments.status, "cleared")))
      .limit(1);
    if (posted) {
      throw new Error("This type has cleared payments. Changing its ledger effect requires an audited historical correction.");
    }
  }
};
