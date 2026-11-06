import { ApiError, getApiErrorMessage } from "./queryClient";

type Stage = "preview" | "session" | "status" | "cancel";
const messages: Record<Stage, string> = {
  preview: "Administrator checkout could not be loaded. Retry, or reopen Make payment from the worker's Accounts page. If this continues, ask support to check payment configuration.",
  session: "The payment could not be started or its outcome confirmed. Check your unfinished payments before trying again. Do not start another payment while its outcome is unknown.",
  status: "Payment status could not be checked. Retry this receipt or contact support with the confirmation number. Do not start another payment while its outcome is unknown.",
  cancel: "Cancellation could not be confirmed. Check this payment's status; do not assume its reserved balance has been released.",
};

/** Checkout-only boundary: never render an HTML error body or transport detail. */
export function getCheckoutErrorMessage(error: unknown, stage: Stage): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your session has expired. Sign in again, then reopen this checkout or receipt. Check existing payment status before starting another payment.";
    if (typeof error.data?.message === "string" || typeof error.data?.error === "string") {
      return getApiErrorMessage(error, messages[stage]);
    }
  }
  return messages[stage];
}
