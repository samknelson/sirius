import React from "react";
import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { LegalConfirmation } from "../../client/src/plugins/wizards/LegalConfirmation";
import type { LegalConfirmationData } from "@shared/legal-payment";

const totals: NonNullable<LegalConfirmationData["totals"]> = {
  newWorkers: 3,
  newGrants: 3,
  workersWithNewGrants: 3,
  processedRows: 3,
  failedRows: 0,
  chargeFailures: 0,
  chargeReadFailed: false,
  unpriceableGrants: null,
};

const account = (overrides: Partial<LegalConfirmationData["accounts"][number]> = {}): LegalConfirmationData["accounts"][number] => ({
  eaId: "ea-us",
  accountId: "ledger-us",
  accountName: "US Legal",
  currency: "USD",
  amount: "100.00",
  entries: 3,
  invoicePaths: ["/ea/ea-us/invoices/11/2026"],
  invoiceSummaryPath: "/ea/ea-us/invoices",
  balance: "180.00",
  methods: [{ id: "check-usd", name: "Employer check", method: "check" }],
  draft: { amount: "100.00", method: "check", paymentType: "check-usd" },
  payment: null,
  ...overrides,
});

const response = (overrides: Partial<LegalConfirmationData> = {}): LegalConfirmationData => ({
  completed: true,
  historical: false,
  population: null,
  totals,
  accounts: [account()],
  ...overrides,
});

function render(data: LegalConfirmationData) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  query.setQueryData(["/api/wizards/upload/dispatch/confirmation/data"], data);
  return renderToStaticMarkup(
    <QueryClientProvider client={query}>
      <Router ssrPath="/wizards/upload">
        <LegalConfirmation
          wizardId="upload"
          wizardType="gbhet_legal_workers_monthly"
          step={{ id: "confirmation", name: "Confirmation and Payment", kind: "custom", state: "completed" }}
        />
      </Router>
    </QueryClientProvider>,
  );
}

it("keeps payment entry available after processing, even when population measurements are unavailable", () => {
  const html = render(response());
  expect(html).toContain("Tell us how you will pay");
  expect(html).toContain("Save incomplete draft");
  expect(html).toContain("Submit for review");
  expect(html).toContain("New workers created");
  expect(html).toContain("Unavailable");
  expect(html).toContain("This payment covers this upload, but you will still have an outstanding balance of $80.00.");
  expect(html).toContain('href="/ea/ea-us/invoices"');
});

it("offers a disabled online option alongside delegated payment and preserves opt-in guidance", () => {
  const data = response();
  data.accounts[0].payerHandoff = {
    attemptId: "handoff", name: "Example Payer", email: "payer@example.org", contactId: "contact",
    savedContact: true, status: "blocked", requestedAt: "2026-11-18T12:00:00Z",
    message: "Email not sent: this address has not opted in.",
  };
  const html = render(data);
  expect(html).toContain("Pay Online"); expect(html).toContain("Coming soon");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*><span>Pay Online<\/span>/);
  expect(html).toContain("Someone else will pay");
  expect(html).toContain("Notify the person who will pay");
  expect(html).toContain("Existing email opt-in rules apply");
  expect(html).toContain("Payer notification needs attention");
  expect(html).not.toContain("Submit for review");
  expect(html).not.toContain("Projected after receipt clears");
});

it("projects an underpayment below upload charges without blocking submission", () => {
  const data = response();
  data.accounts[0].draft = { amount: "60.00", method: "check", paymentType: "check-usd" };
  const html = render(data);
  expect(html).toContain("This amount is below the current upload charges.");
  expect(html).toContain("Submit for review");
  expect(html).toContain("$120.00");
  expect(html).not.toContain("This payment covers this upload");
  const submitButton = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)]
    .map(match => match[0])
    .find(button => button.includes("Submit for review"));
  expect(submitButton).toBeDefined();
  expect(submitButton).not.toMatch(/\sdisabled(?:=""|\s|>)/);
});

it("shows the exact outstanding balance when a payment covers upload charges but not older debt", () => {
  const data = response();
  data.accounts[0].draft = { amount: "125.00", method: "check", paymentType: "check-usd" };
  expect(render(data)).toContain("This payment covers this upload, but you will still have an outstanding balance of $55.00.");
});

it("projects full-balance coverage as zero without treating the payment as already credited", () => {
  const data = response();
  data.accounts[0].draft = { amount: "180.00", method: "check", paymentType: "check-usd" };
  const html = render(data);
  expect(html).toContain("Would cover the current account balance.");
  expect(html).toContain("$0.00");
  expect(html).toContain("Current account balance");
  expect(html).toContain("Projection only; pending payment does not reduce current balance.");
});

it("shows the credit from overpayment and from an account that already has a credit", () => {
  const overpaid = response();
  overpaid.accounts[0].draft = { amount: "220.00", method: "check", paymentType: "check-usd" };
  const overpaidHtml = render(overpaid);
  expect(overpaidHtml).toContain("Credit $40.00");
  expect(overpaidHtml).toContain("Would exceed the current account balance.");

  const existingCredit = response();
  existingCredit.accounts[0].balance = "-12.50";
  existingCredit.accounts[0].draft = { amount: "7.50", method: "check", paymentType: "check-usd" };
  const creditHtml = render(existingCredit);
  expect(creditHtml).toContain("Credit $20.00");
  expect(creditHtml).toContain("The account currently has a credit; this receipt would increase that credit.");
});

it("keeps multiple account currencies independent rather than netting or allocating between them", () => {
  const cadAccount = account({
    eaId: "ea-ca",
    accountId: "ledger-ca",
    accountName: "Canadian Legal",
    currency: "CAD",
    amount: "70.00",
    balance: "95.00",
    invoicePaths: [],
    invoiceSummaryPath: "/ea/ea-ca/invoices",
    methods: [{ id: "wire-cad", name: "Canadian wire", method: "wire" }],
    draft: { amount: "30.00", method: "wire", paymentType: "wire-cad" },
  });
  const html = render(response({ accounts: [account(), cadAccount] }));
  expect(html).toContain("US Legal");
  expect(html).toContain("Canadian Legal");
  expect(html).toContain("$80.00");
  expect(html).toContain("CA$65.00");
  expect(html).toContain("USD");
  expect(html).toContain("CAD");
});

it("does not add retroactive payment requirements to historical uploads with unavailable measurements", () => {
  const html = render(response({ historical: true, population: null, totals: null, accounts: [] }));
  expect(html).toContain("Historical upload");
  expect(html).toContain("No payment is required retroactively");
  expect(html).toContain("Historical account charge measurements are unavailable.");
  expect(html).not.toContain("Amount (USD)");
  expect(html).not.toContain("Save incomplete draft");
  expect(html).not.toContain("Submit for review");
});

it("labels missing balances and failed charge reads unavailable rather than zero", () => {
  const missingBalance = response();
  missingBalance.accounts[0].balance = null;
  const balanceHtml = render(missingBalance);
  expect(balanceHtml).toContain("Current account balance");
  expect(balanceHtml).toContain("Unavailable");
  expect(balanceHtml).not.toContain("$0.00");

  const missingCharges = render(response({
    totals: { ...totals, chargeReadFailed: true },
    accounts: [],
  }));
  expect(missingCharges).toContain("Upload charges unavailable");
  expect(missingCharges).toContain("No confirmed account charge groups are available.");
  expect(missingCharges).not.toContain("$0.00");
});

it("does not subtract a staff-cleared payment twice or offer employer resubmission", () => {
  const data = response();
  data.accounts[0].balance = "80.00";
  data.accounts[0].payment = {
    id: "receipt",
    status: "cleared",
    amount: "100.00",
    paymentType: "check-usd",
    details: {},
  };
  const html = render(data);
  expect(html).toContain("Current account balance");
  expect(html).toContain("$80.00");
  expect(html).not.toContain("Projected after receipt clears");
  expect(html).not.toContain("Submit for review");
  expect(html).not.toContain("This payment covers this upload");
  expect(html).not.toContain("Credit $20.00");
});

