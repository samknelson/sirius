import { createRoot } from "react-dom/client";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { FrameworkWizardBody } from "@/components/wizards/framework/FrameworkWizardBody";
import { HelpDisplay } from "@/components/HelpDisplay";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/contexts/AuthContext";
import "@/index.css";

function Enrollment() {
  const id = location.pathname.split("/").at(-1);
  const { data: wizard } = useQuery<any>({ queryKey: [`/api/wizards/${id}`] });
  if (!wizard) return <p>Sign in to the fixture session before opening enrollment.</p>;
  return <main className="p-6 max-w-6xl mx-auto">
    <HelpDisplay />
    <p data-testid="active-step">{wizard.currentStep}</p>
    <FrameworkWizardBody wizardId={wizard.id} wizardType={wizard.type}
      data={wizard.data} manifest={wizard.manifest} />
    <Toaster />
  </main>;
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><AuthProvider><Enrollment /></AuthProvider></QueryClientProvider>,
);
