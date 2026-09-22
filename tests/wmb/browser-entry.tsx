// Test-only composition; both pages, layout and query defaults are production code.
import React from "react";
import { createRoot } from "react-dom/client";
import { Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import WorkerView from "@/pages/worker-view";
import WorkerBenefitsCurrent from "@/pages/worker-benefits-current";
import "@/index.css";

function Pages() {
  const auth = useAuth();
  if (!auth.isAuthenticated) return <p>Waiting for fixture authentication</p>;
  return <>
    <Route path="/workers/:id"><WorkerView /></Route>
    <Route path="/workers/:id/benefits/current"><WorkerBenefitsCurrent /></Route>
  </>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider><TerminologyProvider><TooltipProvider>
      <Pages />
    </TooltipProvider></TerminologyProvider></AuthProvider>
  </QueryClientProvider>,
);