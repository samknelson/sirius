import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaskModeProvider, MaskModeControl } from "@/privacy/MaskMode";
import NameManagement from "@/components/worker/NameManagement";
import { HelpDisplay } from "@/components/HelpDisplay";
import HelpTextConfig from "@/pages/config/helps";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CaseLedgerFixture } from "./case-ledger-fixture";
import "@/index.css";

const worker = { id: "worker-fixture", contactName: "Morgan Lancaster", email: "morgan@gmail.com",
  ssn: "123-45-6789", siriusId: 12345, hours: 160, status: "Active", birthDate: "12/31/1980" };
const dep = { name: "Casey Lancaster", birthDate: "03/14/2010" };
const contact = { displayName: "Drew Ramirez", email: "drew@example.invalid", phoneNumber: "(415) 555-1234",
  street: "123 Main Street", city: "Boston", state: "MA", postalCode: "02110" };
const organization = { name: "Fictional Employer", benefit: "Medical", balance: "$200.00", coverageDate: "12/01/2026" };
const body = "Morgan Lancaster 123-45-6789: unstructured content remains unchanged.";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async ({ queryKey }) => {
  const response = await fetch(queryKey.join("/"));
  if (!response.ok) throw new Error("Fixture request failed");
  return response.json();
} } } });

function Fixture() {
  const [unrelated, setUnrelated] = useState("unchanged");
  return <main className="p-4 space-y-3">
    <MaskModeControl />
    <section data-testid="worker-table">
      <a href={`/workers/${worker.id}`} data-testid="worker-name">{worker.contactName}</a>
      <span data-testid="worker-email">{worker.email}</span>
      <span data-testid="worker-ssn">{worker.ssn}</span>
      <span data-testid="worker-dob">{worker.birthDate}</span>
      <span data-testid="worker-identifier">{worker.siriusId}</span>
      <span data-testid="worker-status">{worker.status}</span>
      <span data-testid="worker-hours">{worker.hours}</span>
      <span data-testid="worker-tooltip" title={worker.contactName}>Worker tooltip</span>
    </section>
    <section data-testid="dependent">
      <span>{dep.name}</span> <span>{dep.birthDate}</span>
    </section>
    <section data-testid="contact">
      <h2>{contact.displayName}</h2>
      <p>{contact.email}</p><p>{contact.phoneNumber}</p>
      <p>{contact.street}</p><p>{contact.postalCode}</p>
    </section>
    <select data-testid="person-picker"><option value={worker.id}>{worker.contactName}</option></select>
    <Avatar><AvatarFallback>ML</AvatarFallback></Avatar>
    <div data-testid="ordinary">{organization.name} {organization.benefit} {organization.balance} {organization.coverageDate}</div>
    <div data-testid="note">{body}</div>
    <div data-testid="template-preview" dangerouslySetInnerHTML={{ __html: `<p>${body}</p>` }} />
    <a href="/files/canary.pdf" download>Download original</a>
    <input id="unrelated" value={unrelated} onChange={e => setUnrelated(e.target.value)} />
    <input name="birthDate" type="date" defaultValue="1980-12-31" data-testid="dob-input" />
    <input data-personal="name" defaultValue="Morgan" data-testid="uncontrolled-name" />
    <section data-testid="actual-name-editor">
      <NameManagement workerId="worker-fixture" contactId="contact-fixture" />
    </section>
    <HelpDisplay />
    {location.pathname === "/config/helps" && <HelpTextConfig />}
  </main>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={qc}><MaskModeProvider>
    {/^\/(?:cobra|bao|ledger|shared-)/.test(location.pathname) ? <CaseLedgerFixture /> : <Fixture />}
  </MaskModeProvider></QueryClientProvider>,
);
