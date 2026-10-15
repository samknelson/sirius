import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Route } from "wouter";
import { queryClient } from "@/lib/queryClient";
import EmailConfigPage from "@/pages/config/email";
import PostalConfigPage from "@/pages/config/postal";
import HelpsConfigPage from "@/pages/config/helps";
import { HelpDisplay } from "@/components/HelpDisplay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { CommEmail } from "@/components/comm/CommEmail";
import { AuthProvider } from "@/contexts/AuthContext";
import "@/index.css";
import LetterTemplateDetailPage from "@/pages/admin/letter-template-detail";

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><AuthProvider><TooltipProvider>
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <HelpDisplay />
      <Route path="/config/email"><EmailConfigPage /></Route>
      <Route path="/config/postal"><PostalConfigPage /></Route>
      <Route path="/config/helps"><HelpsConfigPage /></Route>
      <Route path="/admin/letter-templates/:id"><LetterTemplateDetailPage /></Route>
      <Route path="/workers/fixture/comm/send-email"><CommEmail contactId="fixture" email="recipient@example.invalid" contactName="Fixture Recipient" /></Route>
    </main><Toaster />
  </TooltipProvider></AuthProvider></QueryClientProvider>,
);
