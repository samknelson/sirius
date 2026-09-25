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
import { SimpleHtmlEditor, type SimpleHtmlEditorApi } from "@/components/ui/simple-html-editor";
import { TemplateStudio } from "@/components/template-studio/TemplateStudio";
import "@/index.css";

// A visual fixture for the production email studio. This content is local to
// the browser test and never touches a saved application template.
function EmailStudioFixture() {
  const [open, setOpen] = React.useState(true);
  const [values, setValues] = React.useState({
    subject: "A quick follow-up, {{first_name}}",
    bodyHtml: '<p>Hi {{first_name}},</p><p>Thanks for taking the time to connect. I wanted to follow up and share a few details with you.</p><p><a href="https://example.invalid/details" style="display:inline-block;padding:12px 20px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold">View details</a></p><p>Best,<br>{{sender_name}}</p><p><img src="https://fixture-images.invalid/logo.png" alt="Studio logo" width="120" style="width:120px;height:auto"></p>',
  });
  return <>
    <button type="button" onClick={() => setOpen(true)}>Open email editor</button>
    <TemplateStudio open={open} onOpenChange={setOpen} title="Edit email template"
      description="Changes are kept until you save the template"
      channel="email" contextId="compose-worker"
      fields={[{ key: "subject", label: "Subject", mode: "line" }, { key: "bodyHtml", label: "Body", mode: "html" }]}
      values={values} onValueChange={(key, value) => setValues(current => ({ ...current, [key]: value }))}
      tokens={[]} rootNames={[]} />
  </>;
}

function EditorFixtures() {
  const [body, setBody] = React.useState("");
  const [plain, setPlain] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [disabled, setDisabled] = React.useState(false);
  const emailApi = React.useRef<SimpleHtmlEditorApi | null>(null);
  return <>
    <SimpleHtmlEditor templateMode="postal" enableTokens value={body} onChange={setBody} data-testid="fixture-editor" />
    <output data-testid="fixture-source">{body}</output>
    <button data-testid="fixture-save" onClick={() => localStorage.setItem("fixture-template", body)}>Save</button>
    <button data-testid="fixture-reopen" onClick={() => setBody(localStorage.getItem("fixture-template") || "")}>Reopen</button>
    <SimpleHtmlEditor value={plain} onChange={setPlain} data-testid="fixture-unrelated" />
    <output data-testid="fixture-unrelated-source">{plain}</output>
    <h2>Email authoring regression</h2>
    <SimpleHtmlEditor templateMode="email" enableTokens disabled={disabled} editorApiRef={emailApi}
      value={email} onChange={setEmail} data-testid="fixture-email" />
    <output data-testid="fixture-email-source">{email}</output>
    <button data-testid="fixture-email-token" onClick={() => emailApi.current?.insertText('{{contact.field(name="firstName")}}')}>Insert token</button>
    <button data-testid="fixture-email-disabled" onClick={() => setDisabled(value => !value)}>Toggle disabled</button>
    <button data-testid="fixture-email-save" onClick={() => localStorage.setItem("fixture-email", email)}>Save email</button>
    <button data-testid="fixture-email-reopen" onClick={() => setEmail(localStorage.getItem("fixture-email") || "")}>Reopen email</button>
    <button data-testid="fixture-email-load-other" onClick={() => setEmail("<p>External document B</p>")}>Load other email</button>
  </>;
}

function Routes() {
  const auth = useAuth();
  if (!auth.isAuthenticated) return <p>Waiting for fixture staff session</p>;
  return <>
    <Route path="/email-studio-fixture"><EmailStudioFixture /></Route>
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