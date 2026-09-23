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
import { configSections } from "@/config/navigation-registry";
import "@/index.css";

// Fixture-only subsection: production registry rendering and access filtering
// still own its behavior, while the browser suite can cover both menu depths.
const trustSection = configSections.find(section => section.id === "trust");
if (trustSection && !trustSection.subsections?.some(section => section.id === "fixture-subsection")) {
  trustSection.subsections = [
    ...(trustSection.subsections ?? []),
    {
      id: "fixture-subsection",
      title: "Fixture subsection",
      description: "Browser-only subsection coverage",
      icon: trustSection.icon,
      items: [{
        path: "/trust-benefits/subsection-fixture",
        label: "Subsection destination",
        icon: trustSection.icon,
        testId: "nav-config-fixture-subsection-destination",
        permission: "staff",
      }],
    },
  ];
}

(window as typeof window & { retryConfigurationCatalog?: () => Promise<void> })
  .retryConfigurationCatalog = async () => {
    void queryClient.invalidateQueries({
      queryKey: ["catalogs", "config-nav-admin", "/api/catalogs/options-lists"],
    });
  };

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