import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PolicyContext } from "../../shared/access-policies";
import emailPolicy from "../../shared/access-policies/contact/email-edit";
import { contactEmailInput, isContactEmailConflict } from "../../shared/utils/contact-email";

// Security admission: these cheap, DB-free route checks cover the silent
// identity takeover and the mixed-payload/alternate-route ways around its fix.
const state = vi.hoisted(() => ({
  permissions: [] as string[],
  actor: { id: "manager", email: "manager@example.com" },
  originalActor: { id: "admin", email: "admin@example.com" },
  contact: { id: "victim", email: "victim@example.com", displayName: "Victim" },
  reserved: false,
  links: [] as { employerId: string }[],
  createContact: vi.fn(),
  createLink: vi.fn(),
  emailWrite: vi.fn(),
  nameWrite: vi.fn(),
  typeWrite: vi.fn(),
  userWrite: vi.fn(),
}));
vi.mock("../../server/storage", () => ({
  storage: {
    users: {
      userHasPermission: async (id: string, permission: string) =>
        id === state.actor.id && state.permissions.includes(permission),
      hasOtherUserWithEmail: async () => state.reserved,
      updateUser: state.userWrite,
    },
    contacts: {
      getContactByEmail: async (email: string) =>
        email.trim().toLowerCase() === state.contact.email?.toLowerCase() ? state.contact : undefined,
      createContact: state.createContact,
    },
    employerContacts: {
      get: async () => ({ id: "link", contactId: state.contact.id, employerId: "employer", contact: state.contact }),
      listByContactId: async () => state.links,
      create: state.createLink,
      updateContactEmail: state.emailWrite,
      updateContactName: state.nameWrite,
      update: state.typeWrite,
    },
    facilities: {
      get: async () => ({ id: "facility", contactId: state.contact.id }),
      getWithContact: async () => ({ id: "facility", contact: state.contact }),
      updateContactName: state.nameWrite,
      updateContactNameComponents: state.nameWrite,
      updateContactEmail: state.emailWrite,
    },
  },
}));
vi.mock("../../server/services/clerk-provisioning", () => ({
  checkClerkConflict: vi.fn(), provisionClerkAccount: vi.fn(),
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../../server/services/access-policy-evaluator", () => ({
  buildContext: async () => ({ user: state.actor }),
  checkAccess: async (id: string, user: typeof state.actor, entityId: string) => {
    if (id !== "contact.email.edit") throw new Error(`Unexpected policy ${id}`);
    expect(user).toEqual(state.actor);
    return emailPolicy.evaluate!({
      entityId,
      hasAnyPermission: async (perms: string[]) => perms.some(p => state.permissions.includes(p)),
      getUserContact: async () => state.contact.email?.toLowerCase() === user.email.toLowerCase()
        ? state.contact : null,
    } as PolicyContext);
  },
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { registerEmployerContactRoutes } from "../../server/modules/employers/contacts";
import { registerFacilityRoutes } from "../../server/modules/facility/facilities";
import { assertContactEmailChange, respondContactEmailError } from "../../server/services/contact-email-access";

type Handler = (req: any, res: any, next: () => void) => unknown;
const routes = new Map<string, Handler[]>();
beforeAll(() => {
  const app = Object.fromEntries(["get", "post", "put", "patch", "delete"].map(verb => [
    verb, (path: string, ...handlers: Handler[]) => routes.set(`${verb} ${path}`, handlers),
  ]));
  const allow = (_req: unknown, _res: unknown, next: () => void) => next();
  registerEmployerContactRoutes(app as any, allow, () => allow);
  registerFacilityRoutes(app as any, allow, () => allow);
});
beforeEach(() => {
  vi.clearAllMocks();
  state.actor = { id: "manager", email: "manager@example.com" };
  state.permissions = ["employer.manage"];
  state.contact = { id: "victim", email: "victim@example.com", displayName: "Victim" };
  state.reserved = false;
  state.links = [];
  state.createContact.mockImplementation(async data => ({ id: "new", ...data }));
  state.createLink.mockResolvedValue({ id: "new-link" });
  state.emailWrite.mockResolvedValue({ id: "updated" });
  state.nameWrite.mockResolvedValue({ id: "updated" });
  state.typeWrite.mockResolvedValue({ id: "updated" });
});

async function request(route: string, body: any) {
  const req = { body, params: { id: "link", employerId: "employer" }, user: state.originalActor };
  const res = {
    statusCode: 200, body: undefined as any,
    status(code: number) { this.statusCode = code; return this; },
    json(data: any) { this.body = data; return this; },
  };
  const handlers = routes.get(route);
  if (!handlers) throw new Error(`Missing route ${route}`);
  for (const handler of handlers) {
    let next = false;
    await handler(req, res, () => { next = true; });
    if (!next) break;
  }
  return res;
}

describe("email ownership and destination", () => {
  it("uses a noncached field-specific policy", () => expect(emailPolicy.skipCache).toBe(true));
  it.each(["attacker@example.com", "", null])("refuses a foreign edit or clear (%s)", async email => {
    const res = await request("patch /api/employer-contacts/:id", { email });
    expect(res.statusCode).toBe(403);
    expect(state.emailWrite).not.toHaveBeenCalled();
  });
  it("authorizes the persisted owner, never the proposed email or original masquerading admin", async () => {
    const res = await request("patch /api/employer-contacts/:id", { email: state.actor.email });
    expect(res.statusCode).toBe(403);
    expect(state.emailWrite).not.toHaveBeenCalled();
  });
  it("allows an owner to change or clear without changing the login account", async () => {
    state.contact.email = "MANAGER@example.com";
    for (const email of [" changed@example.com ", "", null]) {
      const res = await request("patch /api/employer-contacts/:id", { email });
      expect(res.statusCode).toBe(200);
    }
    expect(state.emailWrite.mock.calls.map(call => call[1])).toEqual(["changed@example.com", null, null]);
    expect(state.userWrite).not.toHaveBeenCalled();
    // A later request cannot reuse the old ownership once the email no longer matches.
    state.contact.email = "changed@example.com";
    await expect(assertContactEmailChange({} as any, "victim", "another@example.com"))
      .rejects.toMatchObject({ status: 403 });
  });
  it("refuses a destination already used by another login even without a contact", async () => {
    state.contact.email = state.actor.email;
    state.reserved = true;
    const res = await request("patch /api/employer-contacts/:id", { email: "other@example.com" });
    expect(res.statusCode).toBe(409);
    expect(state.emailWrite).not.toHaveBeenCalled();
  });
  it.each(["staff", "admin"])("retains %s authority", async permission => {
    state.permissions = [permission];
    state.reserved = true;
    expect((await request("patch /api/employer-contacts/:id", { email: "other@example.com" })).statusCode).toBe(200);
  });
  it.each([
    { email: "taken@example.com", nameComponents: { given: "Changed" } },
    { email: null, contactTypeId: null },
  ])("rejects unauthorized mixed writes before any side effects", async body => {
    expect((await request("patch /api/employer-contacts/:id", body)).statusCode).toBe(403);
    expect(state.nameWrite).not.toHaveBeenCalled();
    expect(state.typeWrite).not.toHaveBeenCalled();
    expect(state.emailWrite).not.toHaveBeenCalled();
  });
  it("leaves non-email updates usable", async () => {
    expect((await request("patch /api/employer-contacts/:id", { contactTypeId: null })).statusCode).toBe(200);
    expect(state.typeWrite).toHaveBeenCalled();
  });
  it("protects the alternate facility route before its name update", async () => {
    expect((await request("patch /api/facilities/:id", { email: null, name: "Changed" })).statusCode).toBe(403);
    expect(state.nameWrite).not.toHaveBeenCalled();
    expect(state.emailWrite).not.toHaveBeenCalled();
  });
});

describe("employer linking and creation", () => {
  it("refuses the arbitrary-email link used to start the takeover", async () => {
    const res = await request("post /api/employers/:employerId/contacts", {
      displayName: "Claimed", email: " VICTIM@example.com ",
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("Victim");
    expect(state.createLink).not.toHaveBeenCalled();
  });
  it("returns duplicate for an already-linked contact", async () => {
    state.links = [{ employerId: "employer" }];
    const res = await request("post /api/employers/:employerId/contacts", {
      displayName: "Duplicate", email: state.contact.email,
    });
    expect(res.statusCode).toBe(409);
    expect(state.createLink).not.toHaveBeenCalled();
  });
  it.each(["owner", "staff", "admin"])("allows authorized existing links (%s)", async role => {
    if (role === "owner") state.contact.email = state.actor.email;
    else state.permissions = [role];
    const res = await request("post /api/employers/:employerId/contacts", {
      displayName: "Link", email: state.contact.email,
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.linked).toBe(true);
    expect(state.createContact).not.toHaveBeenCalled();
  });
  it("rejects creation claiming another login with no contact", async () => {
    state.reserved = true;
    const res = await request("post /api/employers/:employerId/contacts", {
      displayName: "Claimed", email: "other@example.com",
    });
    expect(res.statusCode).toBe(409);
    expect(state.createContact).not.toHaveBeenCalled();
    expect(state.createLink).not.toHaveBeenCalled();
  });
  it.each([" unclaimed@example.com ", "", null, undefined])("allows normal creation (%s)", async email => {
    expect((await request("post /api/employers/:employerId/contacts", { displayName: "New", email })).statusCode).toBe(201);
    expect(state.createContact).toHaveBeenCalledWith(expect.objectContaining({
      email: email?.trim() || null,
    }));
  });
});

describe("normalization and conflict reporting", () => {
  it("trims addresses and treats blank as absent without accepting malformed input", () => {
    expect(contactEmailInput.parse(" User@Example.com ")).toBe("User@Example.com");
    expect(contactEmailInput.parse("")).toBeNull();
    expect(contactEmailInput.parse(" \t ")).toBeNull();
    expect(contactEmailInput.safeParse("malformed").success).toBe(false);
  });
  it("maps only the named email constraint, including wrapped driver errors", async () => {
    const conflict = { cause: { code: "23505", constraint: "contacts_email_normalized_unique" } };
    expect(isContactEmailConflict(conflict)).toBe(true);
    expect(isContactEmailConflict({ code: "23505", constraint: "other_unique" })).toBe(false);
    state.contact.email = state.actor.email;
    state.emailWrite.mockRejectedValue(conflict);
    expect((await request("patch /api/employer-contacts/:id", { email: "free@example.com" })).statusCode).toBe(409);
    expect(respondContactEmailError({} as any, new Error("unrelated"))).toBe(false);
  });
});
