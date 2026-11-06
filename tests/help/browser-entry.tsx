import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { HelpDisplay } from "@/components/HelpDisplay";
import HelpsConfigPage from "@/pages/config/helps";
import "@/index.css";

// The real help components with read-only fixture HTTP, never an auth bypass
// or a route installed in the running application.
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <HelpDisplay />
    <Route path="/config/helps"><HelpsConfigPage /></Route>
  </QueryClientProvider>,
);
