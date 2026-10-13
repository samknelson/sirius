// Production Summary page and layout, composed against browser-only API fixtures.
import React from "react";
import { createRoot } from "react-dom/client";
import { Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { PageTitleProvider } from "@/contexts/PageTitleContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import WorkerBenefitsSummary from "@/pages/worker-benefits-summary";
import "@/index.css";

function Routes() {
  const auth = useAuth();
  if (!auth.isAuthenticated) return <p>Waiting for fixture staff session</p>;
  return <Route path="/workers/:id/benefits/summary"><WorkerBenefitsSummary /></Route>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider><TerminologyProvider><PageTitleProvider><TooltipProvider>
      <Routes />
    </TooltipProvider></PageTitleProvider></TerminologyProvider></AuthProvider>
  </QueryClientProvider>,
);
