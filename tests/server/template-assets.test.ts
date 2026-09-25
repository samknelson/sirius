import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "node:http";
import { z } from "zod";

const state = vi.hoisted(() => {
  const data = {
    publicUrl: "https://app.example" as string | undefined,
    objects: new Map<string, Buffer>(),
    files: new Map<string, any>(),
    upload: vi.fn(),
    failCreate: false,
    LocalProvider: class {
      async read(path: string) {
        const content = data.objects.get(path);
        if (!content) throw new Error("missing object");
        return content;
      }
    },
  };
  return data;
});

vi.mock("../../server/storage", () => ({
  storage: {
    files: {
      create: vi.fn(async (file: any) => {
        if (state.failCreate) throw new Error("metadata unavailable");
        const saved = { ...file, id: "asset-id", status: "live" };
        state.files.set(`${file.fileSystemId}:${file.storagePath}`, saved);
        return saved;
      }),
      getByStoragePath: vi.fn(async (path: string, filesystemId: string) =>
        state.files.get(`${filesystemId}:${path}`)),
    },
    authIdentities: { getByProviderAndExternalId: vi.fn(async (_provider: string, sub: string) =>
      sub === "unresolved" ? null : { id: "identity", userId: sub }) },
    users: { getUser: vi.fn(async (id: string) => ({ id, isActive: id !== "inactive", email: "staff@example.invalid" })) },
  },
}));

vi.mock("@shared/schema", () => ({
  insertFileSchema: z.object({
    fileName: z.string(), storagePath: z.string(), mimeType: z.string(),
    size: z.number(), uploadedBy: z.string(), fileSystemId: z.string(),
    entityType: z.string(), entityId: z.null(), metadata: z.object({ purpose: z.literal("letter-template") }),
  }),
}));
vi.mock("../../server/auth/index", () => ({
  providerRegistry: { getDefault: () => ({ type: "local" }) },
}));
vi.mock("../../server/middleware/request-context", () => ({ getRequestContext: () => null }));

vi.mock("../../server/services/files", () => {
  class FileSystemNotConfiguredError extends Error {}
  class FilePathTraversalError extends Error {}
  return {
    fileSystemService: {
      upload: vi.fn(async (options: { customPath: string; fileContent: Buffer }) => {
        state.upload(options.customPath, options.fileContent);
        state.objects.set(options.customPath, options.fileContent);
        return { storagePath: options.customPath, size: options.fileContent.length };
      }),
      download: vi.fn(async (_filesystemId: string, path: string) => state.objects.get(path)!),
      remove: vi.fn(async (_filesystemId: string, path: string) => {
        state.objects.delete(path);
      }),
    },
    isFileSystemConfigured: vi.fn(() => true),
    getFileSystemConfig: vi.fn(() => ({ access: "public" })),
    getFileSystemProvider: vi.fn(() => new state.LocalProvider()),
    listFileSystemConfigs: vi.fn(() => [{ id: "public", access: "public" }]),
    FileSystemNotConfiguredError,
    FilePathTraversalError,
  };
});

vi.mock("../../server/services/files/providers/local", () => ({
  LocalFileSystemProvider: state.LocalProvider,
}));

vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
  checkAccess: vi.fn(),
  buildContext: vi.fn(),
}));

vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  storageLogger: { info: vi.fn() },
}));

vi.mock("../../server/utils/content-disposition", () => ({
  buildContentDisposition: vi.fn(() => "inline"),
}));

vi.mock("../../server/services/entity-files/registry", () => ({
  getEntityFileContext: vi.fn(),
}));

vi.mock("../../server/config/env-registry", () => ({
  getEnvironmentVariable: vi.fn(() => state.publicUrl),
  PUBLIC_URL_LOCAL_FALLBACK: "https://localhost:5000",
}));

vi.mock("../../server/services/comm/letter-images", () => ({
  MAX_LETTER_IMAGE_BYTES: 1024 * 1024,
  rasterImageType(bytes: Buffer) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xc0) {
      if (bytes.readUInt16BE(9) > 0 && bytes.readUInt16BE(7) > 0) return "image/jpeg";
      throw new Error("Letter image refused: invalid JPEG dimensions.");
    }
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) ||
        bytes.toString("ascii", 12, 16) !== "IHDR") {
      throw new Error("Letter image refused: invalid PNG.");
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!width || !height || width > 8192 || height > 8192 ||
        width * height > 16_000_000) {
      throw new Error("Letter image refused: image dimensions exceed limits.");
    }
    return "image/png";
  },
}));

import { registerFileRoutes } from "../../server/modules/files";

let server: http.Server;
let baseUrl: string;

function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ioAAAAASUVORK5CYII=",
    "base64",
  );
}

function auth(permissionStaff = true) {
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const userId = req.header("x-user");
    if (!userId) {
      res.status(401).json({ message: "Authentication required" });
      return;
    }
    (req as any).user = { claims: { sub: userId }, providerType: "local",
      ...(userId === "unresolved" ? {} : { dbUser: { id: userId, isActive: userId !== "inactive" } }) };
    (req as any).session = {};
    next();
  };
  const requirePermission = (permission: string) =>
    (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (permission === "staff" && !permissionStaff) {
        res.status(403).json({ message: "Staff permission required" });
        return;
      }
      next();
    };
  return { requireAuth, requirePermission };
}

async function upload(
  bytes = pngBytes(),
  mimeType = "image/png",
  headers: Record<string, string> = { "x-user": "staff" },
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), "logo.png");
  return fetch(`${baseUrl}/api/template-assets`, {
    method: "POST",
    headers,
    body: form,
  });
}

beforeEach(async () => {
  state.publicUrl = "https://app.example";
  state.objects.clear();
  state.files.clear();
  state.upload.mockReset();
  state.failCreate = false;
  const app = express();
  const authMiddleware = auth();
  registerFileRoutes(app, authMiddleware.requireAuth, authMiddleware.requirePermission);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()),
  );
});

describe("POST /api/template-assets", () => {
  it("requires authentication and staff authorization", async () => {
    expect((await upload(pngBytes(), "image/png", {})).status).toBe(401);
    const app = express();
    const authMiddleware = auth(false);
    registerFileRoutes(app, authMiddleware.requireAuth, authMiddleware.requirePermission);
    const deniedServer = http.createServer(app);
    await new Promise<void>((resolve) => deniedServer.listen(0, "127.0.0.1", resolve));
    const address = deniedServer.address() as { port: number };
    const form = new FormData();
    form.append("file", new Blob([pngBytes()], { type: "image/png" }), "logo.png");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/template-assets`, {
      method: "POST",
      headers: { "x-user": "non-staff" },
      body: form,
    });
    expect(response.status).toBe(403);
    expect(state.upload).not.toHaveBeenCalled();
    await new Promise<void>((resolve, reject) =>
      deniedServer.close((error) => error ? reject(error) : resolve()),
    );
  });

  it("requires a resolved active database identity before writing bytes", async () => {
    expect((await upload(pngBytes(), "image/png", { "x-user": "unresolved" })).status).toBe(401);
    expect((await upload(pngBytes(), "image/png", { "x-user": "inactive" })).status).toBe(401);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("rejects unsupported MIME and content that does not match its MIME", async () => {
    expect((await upload(Buffer.from("<svg/>"), "image/svg+xml")).status).toBe(415);
    expect((await upload(Buffer.from("<svg/>"), "image/png")).status).toBe(400);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("refuses missing, fallback, and HTTP public origins", async () => {
    state.publicUrl = undefined;
    expect((await upload()).status).toBe(503);
    state.publicUrl = "https://localhost:5000";
    expect((await upload()).status).toBe(503);
    state.publicUrl = "http://app.example";
    expect((await upload()).status).toBe(503);
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("returns a stable absolute URL that the public files route serves", async () => {
    const response = await upload();
    expect(response.status).toBe(201);
    const payload = await response.json() as { url: string };
    const publicUrl = new URL(payload.url);
    expect(publicUrl.origin).toBe("https://app.example");
    expect(publicUrl.pathname).toMatch(/^\/public-files\/public\/letter-template-assets\/[0-9a-f-]+\.png$/);

    const served = await fetch(`${baseUrl}${publicUrl.pathname}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(pngBytes());
    expect(state.files.values().next().value.uploadedBy).toBe("staff");
  });
  it("accepts JPEG and serves it as JPEG", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xd9]);
    const response = await upload(bytes, "image/jpeg");
    expect(response.status).toBe(201);
    const { url } = await response.json();
    const served = await fetch(`${baseUrl}${new URL(url).pathname}`);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(bytes);
  });
  it("rejects oversized images and removes objects if metadata creation fails", async () => {
    expect((await upload(Buffer.concat([pngBytes(), Buffer.alloc(1024 * 1024)]))).status).toBe(413);
    state.failCreate = true;
    expect((await upload()).status).toBe(500);
    expect(state.objects.size).toBe(0);
    expect(state.files.size).toBe(0);
  });
});