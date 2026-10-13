// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmployerPayAction } from "@/components/ledger/EmployerPayAction";

describe("employer checkout navigation", () => {
  it.each(["150.00", "387.00"])("keeps Pay online available for an unreserved %s balance", available => {
    const html = renderToStaticMarkup(<EmployerPayAction eaId="ea" checkout={{ available, invoices: [] }} />);
    expect(html).toContain("Pay online");
    expect(html).toContain('href="/pay/ea"');
  });
  it("exposes creator-scoped unfinished payment status with zero available without offering another invoice payment", () => {
    const checkout = { available: "0.00", invoices: [{ invoiceNumber: "INV", month: 9, year: 2026, invoiceBalance: "150.00" }],
      pendingCheckouts: [{ id: "owned", status: "processing" }] };
    const html = renderToStaticMarkup(<EmployerPayAction eaId="ea" checkout={checkout} />);
    expect(html).toContain("Check payment status");
    expect(html).toContain('href="/pay/ea"');
    expect(html).not.toContain("Pay online");
    expect(renderToStaticMarkup(<EmployerPayAction eaId="ea" checkout={checkout} invoiceNumber="INV" />)).toBe("");
    expect(renderToStaticMarkup(<EmployerPayAction eaId="ea" checkout={{ ...checkout, pendingCheckouts: [] }} />)).toBe("");
  });
});
