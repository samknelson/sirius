import { describe, expect, it, vi } from "vitest";
import type { NextFunction, Response } from "express";
import { sendDevHtml } from "../../server/vite";

function response() {
  const res = {
    headersSent: false,
    writableEnded: false,
    status: vi.fn(function (this: unknown) { return this; }),
    type: vi.fn(function (this: unknown) { return this; }),
    end: vi.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  };
  return res;
}

describe("dev SPA response", () => {
  it("stages HTML headers before the transform and finishes after a session flush", async () => {
    const res = response();
    const next = vi.fn();
    let finish!: (html: string) => void;
    const rendering = new Promise<string>((resolve) => { finish = resolve; });

    const sending = sendDevHtml(
      res as unknown as Response,
      next as NextFunction,
      () => rendering,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith("html");

    res.headersSent = true; // session flushed the staged headers during transform
    finish("<html>ready</html>");
    await sending;

    expect(res.end).toHaveBeenCalledWith("<html>ready</html>");
    expect(next).not.toHaveBeenCalled();
  });

  it("ends an already-flushed response instead of forwarding a transform error", async () => {
    const res = response();
    const next = vi.fn();
    const error = new Error("transform failed");
    let fail!: (error: Error) => void;
    const rendering = new Promise<string>((_, reject) => { fail = reject; });
    const fixStacktrace = vi.fn();

    const sending = sendDevHtml(
      res as unknown as Response,
      next as NextFunction,
      () => rendering,
      fixStacktrace,
    );
    res.headersSent = true;
    fail(error);
    await sending;

    expect(fixStacktrace).toHaveBeenCalledWith(error);
    expect(res.end).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
});