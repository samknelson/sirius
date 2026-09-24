// Isolated composition: production checkout, shared quote calculator, router,
// auth and query providers. Only HTTP answers belong to the browser fixture.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import SharedCheckoutPage from "@/pages/shared-checkout";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Route path="/pay/:eaId" component={SharedCheckoutPage} />
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>,
);