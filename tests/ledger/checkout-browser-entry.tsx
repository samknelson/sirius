// Isolated composition: production checkout, shared quote calculator, router,
// auth and query providers. Only HTTP answers belong to the browser fixture.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import SharedCheckoutPage from "@/pages/shared-checkout";
import SharedPaymentReceipt from "@/pages/shared-payment-receipt";
import { EmployerPayAction, type EmployerCheckout } from "@/components/ledger/EmployerPayAction";
import { apiRequest } from "@/lib/queryClient";
import "@/index.css";

function EmployerEntryFixture() {
  const checkout = useQuery<EmployerCheckout>({
    queryKey: ["employer-checkout-entry", "fixture-employer", "fixture-ea"],
    queryFn: () => apiRequest("GET", "/api/ledger/checkout/employer/fixture-employer/fixture-ea"),
  });
  return <main aria-label="Employer payment entry"><EmployerPayAction eaId="fixture-ea" checkout={checkout.data} /></main>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Route path="/pay/:eaId" component={SharedCheckoutPage} />
        <Route path="/pay/receipt/:sessionId" component={SharedPaymentReceipt} />
        <Route path="/ea/fixture-ea" component={EmployerEntryFixture} />
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>,
);