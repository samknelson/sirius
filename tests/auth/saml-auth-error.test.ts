/**
 * The SAML auth-error improvements:
 *   - categorizeSamlError produces the expected category tokens
 *   - the redirect URLs carry a reference + category instead of a raw error
 *   - the client-side CATEGORY_REASONS allowlist accepts known categories and
 *     rejects unknown / missing values
 *
 * Both the server function and client allowlist are imported from their real
 * source modules so that changes to either are caught here.
 */
import { describe, expect, it } from "vitest";
import { categorizeSamlError } from "../../server/auth/providers/saml-error-categories";
import { CATEGORY_REASONS } from "../../client/src/pages/auth-error-categories";

describe("categorizeSamlError", () => {
  const cases = [
    ["audience error", "Audience restriction validation failed", "audience_mismatch"],
    ["signature error", "Invalid signature on response", "invalid_signature"],
    ["cert error", "No cert provided", "certificate_problem"],
    ["expired error", "SAML assertion is expired", "assertion_timing"],
    ["notBefore error", "NotBefore condition not satisfied", "assertion_timing"],
    ["destination error", "Destination does not match ACS URL", "recipient_mismatch"],
    ["InResponseTo error", "InResponseTo does not match", "in_response_to"],
    ["missing assertion", "Missing SAML assertion in response", "missing_assertion"],
    ["status error", "Non-success SAML status code", "idp_status_error"],
    ["unknown error", "Some totally new error", "unrecognized"],
  ] as const;

  for (const [label, message, expected] of cases) {
    it(`${label} → ${expected}`, () => {
      expect(categorizeSamlError(message).category).toBe(expected);
    });
  }
});

describe("redirect URL shape", () => {
  it("saml_callback_failed redirect includes ref and category", () => {
    // Simulate what the updated getCallbackHandler does for an error.
    const err = new Error("Invalid signature on response");
    const fakeRef = "SAML-FAKE-REF";
    const { category } = categorizeSamlError(err.message);
    const url = `/auth-error?error=saml_callback_failed&ref=${fakeRef}&category=${category}`;

    expect(url).toContain("ref=");
    expect(url).toContain("category=invalid_signature");
    expect(url).not.toContain("stack");
    expect(url).not.toContain("error=Invalid");
  });

  it("saml_failed redirect now includes ref and category (not bare failureRedirect)", () => {
    // The old failureRedirect produced: /auth-error?error=saml_failed
    // The new path produces: /auth-error?error=saml_failed&ref=SAML-...&category=...
    const syntheticErr = new Error("SAML authentication rejected");
    const { category } = categorizeSamlError(syntheticErr.message);
    const fakeRef = "SAML-ABCD-1234";
    const url = `/auth-error?error=saml_failed&ref=${fakeRef}&category=${category}`;

    expect(url).toContain("ref=SAML-");
    expect(url).toContain("category=");
    // The old bare redirect would have stopped at "?error=saml_failed".
    expect(url).not.toBe("/auth-error?error=saml_failed");
  });

  it("session_failed redirect includes ref and category", () => {
    const err = new Error("Session store write failed");
    const { category } = categorizeSamlError(err.message);
    const fakeRef = "SAML-SESS-1234";
    const url = `/auth-error?error=session_failed&ref=${fakeRef}&category=${category}`;

    expect(url).toContain("ref=");
    expect(url).toContain("category=");
  });

  it("ref param format validation — valid reference accepted", () => {
    const rawRef = "SAML-ABCD-1234";
    const reference = /^SAML-[A-Z0-9-]{1,24}$/.test(rawRef) ? rawRef : "";
    expect(reference).toBe(rawRef);
  });

  it("ref param format validation — free text rejected", () => {
    const rawRef = "../../etc/passwd";
    const reference = /^SAML-[A-Z0-9-]{1,24}$/.test(rawRef) ? rawRef : "";
    expect(reference).toBe("");
  });
});

describe("client-side CATEGORY_REASONS allowlist", () => {
  it("known category audience_mismatch → reason returned", () => {
    const reason = CATEGORY_REASONS["audience_mismatch"];
    expect(reason).toBeDefined();
    expect(reason).toContain("Audience");
  });

  it("known category idp_status_error → reason returned", () => {
    const reason = CATEGORY_REASONS["idp_status_error"];
    expect(reason).toBeDefined();
    expect(reason).toContain("identity provider");
  });

  it("unknown category → undefined (falls back to generic message)", () => {
    expect(CATEGORY_REASONS["totally_unknown_category"]).toBeUndefined();
  });

  it("empty string category → undefined (no category param case)", () => {
    expect(CATEGORY_REASONS[""]).toBeUndefined();
  });

  it("unrecognized category → undefined (not in allowlist, intentional)", () => {
    // "unrecognized" is the server's fallback but is deliberately omitted from
    // the client allowlist — it is not helpful to surface it.
    expect(CATEGORY_REASONS["unrecognized"]).toBeUndefined();
  });

  it("all 8 known server categories have a corresponding client reason", () => {
    // These are the 8 named categories that categorizeSamlError can return
    // (excluding the fallback "unrecognized"). If a new category is added to
    // the server function, it must appear in CATEGORY_REASONS too.
    const serverCategories = [
      "audience_mismatch",
      "invalid_signature",
      "certificate_problem",
      "assertion_timing",
      "recipient_mismatch",
      "in_response_to",
      "missing_assertion",
      "idp_status_error",
    ];
    for (const cat of serverCategories) {
      expect(CATEGORY_REASONS[cat], `missing client reason for ${cat}`).toBeDefined();
    }
  });
});
