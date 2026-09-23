import type { AddressInfo } from "node:net";
import http from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  contacts: new Map<string, any>(),
  grants: new Map<string, { canPay: boolean; canManageMethods: boolean }>(),
  canManageAsStaff: true,
  actorEmail: "admin@example.com",
  setPaymentGrant: vi.fn(async (id: string, grant: { canPay: boolean; canManageMethods: boolean }) => {
    const saved = { ...grant };
    state.grants.set(id, saved);
    return saved;
  }),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    employerContacts: {
      get: async (id: string) => state.contacts.get(id) ?? null,
      getPaymentGrant: async (id: string) => state.grants.get(id) ?? null,
      setPaymentGrant: state.setPaymentGrant,
    },
  },
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: (permission: string) => (_req: unknown, res: any, next: () => void) => {
    if (permission === "staff" && !state.canManageAsStaff) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  },
  buildContext: async () => ({ user: { id: "actor-user", email: state.actorEmail } }),
}));

vi.mock("../../server/services/clerk-provisioning", () => ({
  checkClerkConflict: vi.fn(),
  provisionClerkAccount: vi.fn(),
}));
vi.mock("../../server/services/okta-credentialing", () => ({
  credentialUserInOkta: vi.fn(),
  OktaCredentialingError: class extends Error {},
}));
vi.mock("../../server/auth/okta-admin", () => ({
  isOktaProviderActive: () => false,
}));

const { registerEmployerContactRoutes } = await import("../../server/modules/employers/contacts");

let baseUrl = "";
let server: http.Server;

beforeAll(async () => {
  state.contacts.set("employer-a-contact-link", {
    id: "employer-a-contact-link",
    employerId: "employer-a",
    contact: { email: "contact@example.com" },
  });
  state.contacts.set("employer-b-contact-link", {
    id: "employer-b-contact-link",
    employerId: "employer-b",
    contact: { email: "contact@example.com" },
  });

  const app = express();
  app.use(express.json());
  registerEmployerContactRoutes(
    app,
    (_req, _res, next) => next(),
    () => (_req, _res, next) => next(),
  );
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

beforeEach(() => {
  state.grants.clear();
  state.setPaymentGrant.mockClear();
  state.canManageAsStaff = true;
  state.actorEmail = "admin@example.com";
});

describe("employer contact payment grants", () => {
  it("requires staff authority to mutate grants", async () => {
    state.canManageAsStaff = false;
    const response = await fetch(`${baseUrl}/api/employer-contacts/employer-a-contact-link/payment-grant`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canPay: true, canManageMethods: false }),
    });

    expect(response.status).toBe(403);
    expect(state.setPaymentGrant).not.toHaveBeenCalled();
  });

  it("prevents staff from granting authority to their own linked contact", async () => {
    state.actorEmail = " CONTACT@example.com ";
    const response = await fetch(`${baseUrl}/api/employer-contacts/employer-a-contact-link/payment-grant`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canPay: true, canManageMethods: true }),
    });

    expect(response.status).toBe(403);
    expect(state.setPaymentGrant).not.toHaveBeenCalled();
  });

  it("keeps payment and method grants independent for each employer link and revokes immediately", async () => {
    const put = (linkId: string, grant: { canPay: boolean; canManageMethods: boolean }) =>
      fetch(`${baseUrl}/api/employer-contacts/${linkId}/payment-grant`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grant),
      });
    const get = (linkId: string) =>
      fetch(`${baseUrl}/api/employer-contacts/${linkId}/payment-grant`);

    expect((await put("employer-a-contact-link", { canPay: true, canManageMethods: false })).status).toBe(200);
    expect(await (await get("employer-a-contact-link")).json()).toEqual({
      canPay: true,
      canManageMethods: false,
    });
    expect(await (await get("employer-b-contact-link")).json()).toEqual({
      canPay: false,
      canManageMethods: false,
    });

    expect((await put("employer-b-contact-link", { canPay: false, canManageMethods: true })).status).toBe(200);
    expect(await (await get("employer-a-contact-link")).json()).toEqual({
      canPay: true,
      canManageMethods: false,
    });
    expect(await (await get("employer-b-contact-link")).json()).toEqual({
      canPay: false,
      canManageMethods: true,
    });

    expect((await put("employer-a-contact-link", { canPay: false, canManageMethods: false })).status).toBe(200);
    expect(await (await get("employer-a-contact-link")).json()).toEqual({
      canPay: false,
      canManageMethods: false,
    });
    expect(await (await get("employer-b-contact-link")).json()).toEqual({
      canPay: false,
      canManageMethods: true,
    });
  });
});