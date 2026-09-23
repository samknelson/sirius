// Test-only composition: the layout, navigation registry, access filtering,
// catalog resolution and router are production code. Only the API answers and
// page bodies are fixture-owned.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import "@/index.css";

function FixturePage() {
  const [location] = useLocation();
  return (
    <ConfigurationLayout>
      <article data-testid="fixture-page">
        <h1 className="text-2xl font-semibold">Configuration fixture page</h1>
        <p data-testid="fixture-location">{location}</p>
      </article>
    </ConfigurationLayout>
  );
}

function App() {
  const auth = useAuth();
  if (!auth.authReady || !auth.isAuthenticated) {
    return <p data-testid="fixture-loading">Waiting for fixture authentication</p>;
  }

  // Intentionally nested to exercise the production layout's idempotent
  // boundary. Direct descendants must never render a second config sidebar.
  return (
    <ConfigurationLayout>
      <FixturePage />
    </ConfigurationLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>,
);