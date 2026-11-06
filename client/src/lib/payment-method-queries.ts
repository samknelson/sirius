/** One payer-scoped cache shared by management and checkout. */
export const paymentMethodsKey = (entityType: string, entityId: string) =>
  ["/api/ledger/payment-methods", entityType, entityId] as const;

// Settlement may finish in another tab or through delayed ACH recovery.
// Override only these queries, not the application's global cache policy.
export const paymentMethodsFreshness = {
  staleTime: 0,
  refetchOnMount: "always" as const,
  refetchOnWindowFocus: "always" as const,
};
