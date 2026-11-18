import { describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ geocode: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/services/google-geocode", () => ({ geocodeWithGoogle: fixture.geocode }));
import { addressValidationService } from "../../server/services/comm/validators/address";

describe("Google parsing preserves units without borrowing city/state into line one", () => {
  it.each([
    ["123 Main St Springfield IL 62704", undefined],
    ["123 Main St, Suite 4B, Springfield, IL 62704", "Suite 4B"],
    ["123 Main St Apt 2 Springfield IL 62704", "Apt 2"],
    ["123 Main St, Springfield, IL, 62704", undefined],
    ["123 Main St, Suite 4B, Springfield, IL, 62704", "Suite 4B"],
    ["123 Main St\nSuite 4B\nSpringfield\nIL\n62704", "Suite 4B"],
  ])("parses %s against a building-only answer", async (rawAddress, unit) => {
    (addressValidationService as any).config = {
      mode: "google", google: { enabled: true },
      local: { countries: ["US"], strictValidation: true }, fallback: { useLocalOnGoogleFailure: false },
    };
    fixture.geocode.mockResolvedValue({ response: { status: "OK", results: [{
      address_components: [
        ["street_number", "123"], ["route", "Main St"], ["locality", "Springfield"],
        ["administrative_area_level_1", "IL"], ["postal_code", "62704"], ["country", "US"],
      ].map(([type, name]) => ({ types: [type], long_name: name, short_name: name })),
    }] } });
    const result = await addressValidationService.parseAndValidate({ rawAddress });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.structuredAddress).toMatchObject({ street: "123 Main St", city: "Springfield", state: "IL", postalCode: "62704" });
    expect(result.structuredAddress.street2).toBe(unit);
  });
  it.each([
    ["123 Main St, Springfield, IL, 62704", undefined],
    ["123 Main St, Suite 4B, Springfield, IL, 62704", "Suite 4B"],
  ])("parses separately delimited state and ZIP locally: %s", async (rawAddress, unit) => {
    (addressValidationService as any).config = {
      mode: "local", google: { enabled: false },
      local: { countries: ["US"], strictValidation: true },
    };
    const result = await addressValidationService.parseAndValidate({ rawAddress });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.structuredAddress).toMatchObject({ street: "123 Main St", city: "Springfield", state: "IL", postalCode: "62704" });
    expect(result.structuredAddress.street2).toBe(unit);
  });
});
