import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import WorkerPaymentMethodsPage from "@/pages/worker-payment-methods";
import "@/index.css";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider><WorkerPaymentMethodsPage /></TooltipProvider>
  </QueryClientProvider>,
);