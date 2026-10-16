import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import Report from "@/pages/worker-comms-compliance";
import { HelpDisplay } from "@/components/HelpDisplay";
import { Toaster } from "@/components/ui/toaster";
import "@/index.css";

function App() {
  const [location] = useLocation();
  const auth = useAuth();
  if (!auth.authReady || !auth.isAuthenticated) return <p>Loading fixture identity</p>;
  return <><Switch>
    <Route path="/workers/comms-compliance">
      <ProtectedRoute policy="staff" component="worker.comms_compliance">
        <HelpDisplay /><Report />
      </ProtectedRoute>
    </Route>
    <Route><p data-testid="destination">{location}</p></Route>
  </Switch><Toaster /></>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><AuthProvider><App /></AuthProvider></QueryClientProvider>,
);
