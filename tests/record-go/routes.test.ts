import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";

const f = vi.hoisted(() => ({ resolve: vi.fn(), requirement: vi.fn() }));
vi.mock("../../server/services/record-go", () => ({
  resolveRecordGoIdentifier: f.resolve,
  recordGoAccessRequirement: f.requirement,
}));

import { registerRecordGoRoutes } from "../../server/modules/record-go";

const resolved = {
  kind: "resolved",
  metadata: { contextId: "workers", entityId: "worker-id" },
  href: "/workers/worker-id",
};

beforeEach(() => {
  vi.resetAllMocks();
  f.resolve.mockResolvedValue(resolved);
  f.requirement.mockReturnValue({ kind: "policy", id: "worker.view" });
});

function harness(
  authorize = vi.fn().mockResolvedValue(true),
  withAuthorizer = true,
  path = "/api/go/record-id",
) {
  const get = vi.fn();
  const requireAuth = vi.fn();
  registerRecordGoRoutes(
    { get } as unknown as Express, requireAuth, withAuthorizer ? authorize : undefined,
  );
  const [paths, auth, handler] = get.mock.calls[0];
  expect(paths).toEqual(["/go/:id", "/api/go/:id"]);
  expect(auth).toBe(requireAuth);
  const response = {
    set: vi.fn(), vary: vi.fn(), status: vi.fn(), type: vi.fn(),
    json: vi.fn(), send: vi.fn(), redirect: vi.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  const next = vi.fn();
  const request = { path, params: { id: "record-id" } } as unknown as Request;
  return {
    response, next, authorize, request,
    run: () => handler(request, response as unknown as Response, next as NextFunction),
  };
}

describe("Go transport authorization", () => {
  it.each(["/api/go/record-id", "/go/record-id"])(
    "authorizes the same resolution and prevents shared caching at %s", async path => {
      const h = harness(vi.fn().mockResolvedValue(true), true, path);
      await h.run();
      expect(h.authorize).toHaveBeenCalledWith(h.request, resolved);
      expect(h.response.set).toHaveBeenCalledWith("Cache-Control", "private, no-store");
      expect(h.response.vary).toHaveBeenCalledWith("Cookie");
      if (path.startsWith("/api/")) {
        expect(h.response.json).toHaveBeenCalledWith({ href: resolved.href });
        expect(h.response.redirect).not.toHaveBeenCalled();
      } else {
        expect(h.response.redirect).toHaveBeenCalledWith(302, resolved.href);
      }
    },
  );

  it.each(["denied", "undeclared", "no-authorizer"])(
    "reveals neither a destination nor metadata when %s", async reason => {
      const h = harness(vi.fn().mockResolvedValue(reason !== "denied"), reason !== "no-authorizer");
      if (reason === "undeclared") f.requirement.mockReturnValue(undefined);
      await h.run();
      expect(h.response.status).toHaveBeenCalledWith(404);
      expect(h.response.json).toHaveBeenCalledWith({
        title: "Record not found",
        message: "That identifier is not a known record id, metadata id, or record sequence.",
      });
      expect(h.response.redirect).not.toHaveBeenCalled();
    },
  );

  it("forwards resolver failures without exposing a destination", async () => {
    const error = new Error("lookup failed");
    f.resolve.mockRejectedValue(error);
    const h = harness();
    await h.run();
    expect(h.next).toHaveBeenCalledWith(error);
    expect(h.response.json).not.toHaveBeenCalled();
    expect(h.response.redirect).not.toHaveBeenCalled();
  });
});
