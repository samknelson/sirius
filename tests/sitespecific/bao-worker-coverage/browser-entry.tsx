import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { BaoWorkerCoverage } from "../../../client/src/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Router hook={() => [window.location.pathname, () => {}]}>
      <main data-testid="coverage-browser-fixture">
        <BaoWorkerCoverage userId="fixture-worker" userRoles={[]} />
      </main>
    </Router>
  </QueryClientProvider>,
);