import { registerCronPlugin } from "../registry";
import { recoverOnlinePayments } from "../../../../modules/ledger/payment-recovery";

registerCronPlugin({
  metadata: {
    id: "online-payment-recovery",
    name: "Online Payment Recovery",
    description: "Reconciles missed payment webhooks and unfinished settlement effects.",
    singleton: true,
  },
  defaultSchedule: "*/5 * * * *",
  defaultEnabled: true,
  async execute(context) {
    if (context.mode !== "live") return { message: "Test mode: online payments unchanged" };
    const summary = await recoverOnlinePayments();
    return { message: `Checked ${summary.attempts} attempts and ${summary.events} inbox events; ${summary.failures} failures`, metadata: summary };
  },
});