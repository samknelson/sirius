import { describe, expect, it, vi } from "vitest";
import type { IStorage } from "../../server/storage";
import type { BulkMessage } from "../../shared/schema/bulk/schema";
import { applyEnqueueTemplates, resolveEnqueueTemplates } from "../../server/services/bulk-enqueue-templates";

function fixture(medium = "email", content: Record<string, string> = { subject: "Notice", bodyHtml: "<p>Hello {{contact.name}}</p>" }) {
  const template = { id: "library", medium, contextIds: ["bulk-message"], content };
  const channel = {
    getByBulkId: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(), update: vi.fn(),
  };
  const store = {
    letterTemplates: { get: vi.fn().mockResolvedValue(template) },
    bulkParticipants: { hasNonPendingForMessage: vi.fn().mockResolvedValue(false) },
    bulkMessagesEmail: channel, bulkMessagesSms: channel, bulkMessagesPostal: channel, bulkMessagesInapp: channel,
  };
  const message = { id: "message", medium: [medium], status: "draft" } as BulkMessage;
  return { store, storage: store as unknown as IStorage, template, channel, message };
}

describe("bulk enqueue template application", () => {
  it("is opt-in: existing content is untouched when no template is chosen", async () => {
    const f = fixture();
    expect(await resolveEnqueueTemplates(f.storage, undefined, ["email"])).toEqual([]);
    await applyEnqueueTemplates(f.storage, f.message, []);
    expect(f.store.letterTemplates.get).not.toHaveBeenCalled();
    expect(f.channel.update).not.toHaveBeenCalled();
    expect(f.channel.create).not.toHaveBeenCalled();
  });

  it("copies library content without evaluating recipient tokens", async () => {
    const f = fixture();
    const templates = await resolveEnqueueTemplates(f.storage, { email: "library" }, ["email"]);
    await applyEnqueueTemplates(f.storage, f.message, templates);
    expect(f.channel.create).toHaveBeenCalledWith({
      bulkId: "message", ...f.template.content, data: { letterTemplateId: "library" },
    });
  });

  it("updates only authored fields and preserves existing channel settings and data", async () => {
    const f = fixture("email", { bodyHtml: "New" });
    f.channel.getByBulkId.mockResolvedValue({ id: "channel", fromAddress: "sender@example.invalid", data: { custom: true } });
    const templates = await resolveEnqueueTemplates(f.storage, { email: "library" }, ["email"]);
    await applyEnqueueTemplates(f.storage, f.message, templates);
    expect(f.channel.update).toHaveBeenCalledWith("channel", {
      subject: "", bodyHtml: "New", data: { custom: true, letterTemplateId: "library" },
    });
    expect(f.channel.create).not.toHaveBeenCalled();
  });

  it.each([
    ["sms", { body: "Message" }],
    ["inapp", { title: "Notice", body: "Message", linkUrl: "/workers", linkLabel: "Open" }],
    ["postal", { body: "<p>Letter</p>", description: "SPD" }],
  ])("supports %s templates including postal HTML in the existing data extension", async (medium, content) => {
    const f = fixture(medium, content);
    const templates = await resolveEnqueueTemplates(f.storage, { [medium]: "library" }, [medium]);
    await applyEnqueueTemplates(f.storage, f.message, templates);
    if (medium === "postal") {
      expect(f.channel.create).toHaveBeenCalledWith({
        bulkId: "message", description: "SPD", data: { body: "<p>Letter</p>", letterTemplateId: "library" },
      });
    } else expect(f.channel.create).toHaveBeenCalledWith(expect.objectContaining(content));
  });

  it.each([null, [], { fax: "library" }, { email: "" }, { email: 3 }])("rejects malformed selections %j", async input => {
    const f = fixture();
    await expect(resolveEnqueueTemplates(f.storage, input, ["email"])).rejects.toMatchObject({ status: 400 });
    expect(f.channel.create).not.toHaveBeenCalled();
  });

  it("rejects missing templates, wrong channels/contexts and invalid fields", async () => {
    const f = fixture();
    await expect(resolveEnqueueTemplates(f.storage, { sms: "library" }, ["email"])).rejects.toMatchObject({ status: 400 });
    await expect(resolveEnqueueTemplates(f.storage, { sms: "library" }, ["sms"])).rejects.toMatchObject({ status: 400 });
    f.template.contextIds = ["contact"];
    await expect(resolveEnqueueTemplates(f.storage, { email: "library" }, ["email"])).rejects.toMatchObject({ status: 400 });
    f.template.contextIds = ["bulk-message"];
    f.template.content = { fromAddress: "injected@example.invalid" };
    await expect(resolveEnqueueTemplates(f.storage, { email: "library" }, ["email"])).rejects.toMatchObject({ status: 400 });
    f.store.letterTemplates.get.mockResolvedValue(undefined);
    await expect(resolveEnqueueTemplates(f.storage, { email: "library" }, ["email"])).rejects.toMatchObject({ status: 404 });
  });

  it("rejects content replacement after delivery has started", async () => {
    const f = fixture();
    const templates = await resolveEnqueueTemplates(f.storage, { email: "library" }, ["email"]);
    await expect(applyEnqueueTemplates(f.storage, { ...f.message, status: "sent" }, templates)).rejects.toMatchObject({ status: 409 });
    f.store.bulkParticipants.hasNonPendingForMessage.mockResolvedValue(true);
    await expect(applyEnqueueTemplates(f.storage, f.message, templates)).rejects.toMatchObject({ status: 409 });
    expect(f.channel.create).not.toHaveBeenCalled();
  });
});
