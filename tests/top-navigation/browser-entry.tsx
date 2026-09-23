import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import Header from "@/components/layout/Header";
import type { ResolvedMenu } from "@shared/menu-types";
import "@/index.css";

declare global {
  interface Window {
    setFixtureMenu: (menu: ResolvedMenu) => void;
    setFixtureTerminology: (value: unknown) => void;
  }
}
window.setFixtureMenu = menu => {
  queryClient.setQueryData<ResolvedMenu>(["/api/menu"], menu);
};
window.setFixtureTerminology = value => {
  queryClient.setQueryData<unknown>(["/api/variables/by-name", "site_terminology"], value);
};

function App() {
  const auth = useAuth();
  const [location] = useLocation();
  if (!auth.authReady || !auth.isAuthenticated) return <p>Loading</p>;
  return <><Header /><main data-testid="fixture-location">{location}</main></>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider><TerminologyProvider><App /></TerminologyProvider></AuthProvider>
  </QueryClientProvider>,
);