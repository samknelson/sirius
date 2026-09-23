import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { BaoWorkerCoverage } from "../../../client/src/plugins/dashboard/bao-worker-coverage/BaoWorkerCoverage";
import "../../../client/src/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Router hook={() => [window.location.pathname, () => {}]}>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8" data-testid="coverage-browser-fixture">
        <BaoWorkerCoverage userId="fixture-worker" userRoles={[]} />
      </main>
    </Router>
  </QueryClientProvider>,
);