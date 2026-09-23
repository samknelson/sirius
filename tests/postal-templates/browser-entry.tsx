// Test-only composition shell. Editors, state transitions and saves are production code.
import React from "react";
import { createRoot } from "react-dom/client";
import { Route } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { CommPostal } from "@/components/comm/CommPostal";
import BulkMessageMessagePage from "@/pages/bulk-message-message";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import "@/index.css";

function EditorFixtures() {
  const [body, setBody] = React.useState("");
  const [plain, setPlain] = React.useState("");
  return <>
    <SimpleHtmlEditor templateMode="postal" enableTokens value={body} onChange={setBody} data-testid="fixture-editor" />
    <output data-testid="fixture-source">{body}</output>
    <button data-testid="fixture-save" onClick={() => localStorage.setItem("fixture-template", body)}>Save</button>
    <button data-testid="fixture-reopen" onClick={() => setBody(localStorage.getItem("fixture-template") || "")}>Reopen</button>
    <SimpleHtmlEditor value={plain} onChange={setPlain} data-testid="fixture-unrelated" />
    <output data-testid="fixture-unrelated-source">{plain}</output>
  </>;
}

function Routes() {
  const auth = useAuth();
  if (!auth.isAuthenticated) return <p>Waiting for fixture staff session</p>;
  return <>
    <Route path="/editor-fixture"><EditorFixtures /></Route>
    <p data-testid="fixture-staff">Authenticated API fixture: {auth.user?.email}</p>
    <Route path="/workers/:id/comm/send-postal">
      <CommPostal contactId="contact-fixture" contactName="Fixture Recipient"
        composeTarget={{ scope: "worker", recordId: "worker-fixture" }}
        addresses={[{
          id: "address-fixture", contactId: "contact-fixture", friendlyName: "Fixture address",
          street: "123 Test Street", city: "Test City", state: "NY", postalCode: "10001",
          country: "US", isPrimary: true, isActive: true,
        }]} />
    </Route>
    <Route path="/bulk/:id/message"><BulkMessageMessagePage /></Route>
  </>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider><TerminologyProvider><TooltipProvider>
      <Routes /><Toaster />
    </TooltipProvider></TerminologyProvider></AuthProvider>
  </QueryClientProvider>,
);