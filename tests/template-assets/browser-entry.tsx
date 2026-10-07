// Isolated host composition. Production Studio wrappers, no live auth/data.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { TokenStudio } from "@/components/template-studio/TokenStudio";
import { ComposeTemplateStudio } from "@/components/comm/ComposeTemplateStudio";
import "@/index.css";

function Host() {
  const host = new URLSearchParams(window.location.search).get("host") ?? "saved";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ bodyHtml: "<p>Unsaved image test</p>" });
  const fields = [{ key: "bodyHtml", label: "Body", mode: "html" as const }];
  // Same wrappers used by saved letter, notifier, manual and bulk hosts.
  return <>
    <h1>{host} unsaved form</h1>
    {host !== "manual" ? <>
      <button data-testid="open-assets-studio" onClick={() => setOpen(true)}>Open Studio</button>
      <TokenStudio open={open} onOpenChange={setOpen} title={`${host} image fixture`}
        channel="email" contextId={host === "saved" ? "compose-worker" : host === "bulk" ? "bulk-message" : "fixture-notifier"}
        fields={fields} values={values}
        onValueChange={(key, value) => setValues(current => ({ ...current, [key]: value }))} />
    </> : <ComposeTemplateStudio
      target={{ scope: "worker", recordId: "worker-fixture" }}
      channel="email" title={`${host} image fixture`} fields={fields} values={values}
      onApply={rendered => setValues({ bodyHtml: rendered.bodyHtml })}
      testId="open-assets-studio" />}
    <output data-testid="host-html">{values.bodyHtml}</output>
    <button data-testid="cancel-form" onClick={() => setValues({ bodyHtml: "<p>Unsaved image test</p>" })}>Cancel form edits</button>
  </>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><AuthProvider><TerminologyProvider><TooltipProvider>
    <Host /><Toaster />
  </TooltipProvider></TerminologyProvider></AuthProvider></QueryClientProvider>,
);
