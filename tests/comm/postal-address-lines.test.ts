import { describe, expect, it, vi } from "vitest";
import { insertContactPostalSchema } from "@shared/schema";
import { findSystemHelpsForPath, getSystemHelp } from "../../server/help/system";
import { postalAddressLinesHelp } from "../../server/help/system/postal-address-lines";
import { sanitizeHtml } from "@shared/utils/html";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../server/services/webclient", () => ({ wcRequest: mocks.request }));
import { verifyPostalAddress } from "../../server/services/comm/validators/address-verification";

describe("second postal address line contract", () => {
  it("accepts legacy omission and consistently normalizes blank/new second lines", () => {
    const legacy = { contactId: "contact", street: "12 Fictional St Apt 2", city: "Example", state: "CA", postalCode: "90001", country: "US" };
    expect(insertContactPostalSchema.parse(legacy).street).toBe(legacy.street);
    for (const blank of ["", "  ", null]) {
      expect(insertContactPostalSchema.parse({ ...legacy, street2: blank }).street2).toBeNull();
    }
    expect(insertContactPostalSchema.parse({ ...legacy, street2: " Unit 4B " }).street2).toBe("Unit 4B");
  });

  it("keeps a supplied unit and a distinct canonical identity on building-only vendor answers", async () => {
    const building = { addressLine1: "12 Fictional St", city: "Example", state: "CA", zip: "90001", country: "US" };
    mocks.request.mockResolvedValue({
      outcome: "success", source: "cache",
      value: { valid: true, deliverable: true, normalizedAddress: building, canonicalAddress: "BUILDING" },
    });
    const a = await verifyPostalAddress({ configId: "fictional" } as any, { ...building, addressLine2: "Unit 4B" });
    const b = await verifyPostalAddress({ configId: "fictional" } as any, { ...building, addressLine2: "Unit 4C" });
    expect(a.normalizedAddress?.addressLine2).toBe("Unit 4B");
    expect(a.canonicalAddress).toContain("UNIT 4B");
    expect(a.canonicalAddress).not.toBe(b.canonicalAddress);
    expect(building).not.toHaveProperty("addressLine2");
  });

  it("registers narrow, sanitized guidance without changing local help", () => {
    for (const path of ["/workers/example/addresses", "/employer-contacts/example/addresses", "/facility/example/addresses", "/users/example/contact/addresses"]) {
      expect(findSystemHelpsForPath(path).some(h => h.id === postalAddressLinesHelp.id)).toBe(true);
    }
    for (const path of ["/workers/example", "/workers/example/hours", "/config/helps", "/workers/example/addresses/extra"]) {
      expect(findSystemHelpsForPath(path).some(h => h.id === postalAddressLinesHelp.id)).toBe(false);
    }
    const help = getSystemHelp(postalAddressLinesHelp.id)!;
    expect(help.details).toBe(sanitizeHtml(postalAddressLinesHelp.details!, "rich-document"));
    expect(help.details).toContain("does not guess");
    expect(help.details).toContain("Address Line 2");
  });
});
