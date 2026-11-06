import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { HelpDisplay } from "@/components/HelpDisplay";
import Workers from "@/pages/workers";
import { WorkersTable } from "@/components/workers/workers-table";
import "@/index.css";

declare global {
  interface Window { directoryFixtureKeys: () => string }
}
window.directoryFixtureKeys = () => JSON.stringify(queryClient.getQueryCache().getAll().map(query => query.queryKey));

function Fixture() {
  const auth = useAuth();
  if (!auth.authReady || !auth.isAuthenticated) return <p>Loading authorized fictional fixture</p>;
  if (window.location.pathname === "/legacy-workers") {
    return <WorkersTable workers={[{
      id: "legacy-visible-worker", contact_id: "legacy-contact", sirius_id: 424242,
      given: "Fictional", family: "Picker", contact_name: "Fictional Picker",
      denorm_job_title: "Legacy fixture job", denorm_ms_ids: [], denorm_employer_ids: [],
    } as any]} isLoading={false} />;
  }
  return <><HelpDisplay /><Workers /></>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider><TerminologyProvider><Fixture /></TerminologyProvider></AuthProvider>
  </QueryClientProvider>,
);
