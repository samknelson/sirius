import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { BaoDpSummary } from "../../../client/src/plugins/dashboard/bao-dp-summary/BaoDpSummary";
import "../../../client/src/index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <main style={{ width: "var(--card-width)", maxWidth: "100%", margin: "0 auto" }}>
      <BaoDpSummary userId="fixture-worker" userRoles={[]} />
    </main>
  </QueryClientProvider>,
);