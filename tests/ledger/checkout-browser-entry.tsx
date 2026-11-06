// Isolated composition: production checkout, shared quote calculator, router,
// auth and query providers. Only HTTP answers belong to the browser fixture.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import SharedCheckoutPage from "@/pages/shared-checkout";
import SharedPaymentReceipt from "@/pages/shared-payment-receipt";
import WorkerPaymentMethodsPage from "@/pages/worker-payment-methods";
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
        <Route path="/admin-pay/worker/:entityId/:eaId" component={SharedCheckoutPage} />
        <Route path="/admin-pay/receipt/:sessionId" component={SharedPaymentReceipt} />
        <nav aria-label="Fixture navigation">
          <Link href="/workers/fixture-worker/ledger/payment-methods">Worker methods fixture</Link>
          <Link href="/pay/fixture-ea">Checkout fixture</Link>
        </nav>
        <Route path="/pay/:eaId" component={SharedCheckoutPage} />
        <Route path="/pay/receipt/:sessionId" component={SharedPaymentReceipt} />
        <Route path="/ea/fixture-ea" component={EmployerEntryFixture} />
        <Route path="/workers/fixture-worker/ledger/payment-methods" component={WorkerPaymentMethodsPage} />
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>,
);
