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
    failUpload: false,
    access: "public",
    config: { file_system: "assets", directory: "custom/images/:entity-id", allowed: ["png", "jpg", "jpeg"] } as any,
    owners: new Set<string>(),
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
    variables: { getByName: vi.fn(async () => ({ value: { template_asset: state.config } })) },
    entityFiles: {
      assetOwnerExists: vi.fn(async (id: string) => state.owners.has(id)),
      list: vi.fn(async () => []),
      createWithFile: vi.fn(async (contextId, entityId, file, name, typeId, createOwner) => {
        if (state.failCreate) throw new Error("metadata unavailable");
        if (createOwner) state.owners.add(entityId);
        const saved = { ...file, id: "asset-id", status: "live" };
        state.files.set(`${file.fileSystemId}:${file.storagePath}`, saved);
        return { id: "attachment-id", entityId, name, fileId: saved.id, file: saved, typeId };
      }),
    },
    files: {
      list: vi.fn(async () => [...state.files.values()]),
      create: vi.fn(async (file: any) => {
        if (state.failCreate) throw new Error("metadata unavailable");
        const saved = { ...file, id: "asset-id", status: "live" };
        state.files.set(`${file.fileSystemId}:${file.storagePath}`, saved);
        return saved;
      }),
      getByStoragePath: vi.fn(async (path: string, filesystemId: string) =>
        state.files.get(`${filesystemId}:${path}`)),
      getById: vi.fn(async () => state.files.values().next().value),
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
    entityType: z.string(), entityId: z.string(), metadata: z.null(),
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
        if (state.failUpload) throw new Error("provider unavailable");
        state.upload(options.customPath, options.fileContent);
        state.objects.set(options.customPath, options.fileContent);
        return { storagePath: options.customPath, size: options.fileContent.length };
      }),
      download: vi.fn(async (_filesystemId: string, path: string) => state.objects.get(path)!),
      remove: vi.fn(async (_filesystemId: string, path: string) => {
        state.objects.delete(path);
      }),
      supportsRename: vi.fn(() => true),
      rename: vi.fn(),
      renameDirectory: vi.fn(),
    },
    isFileSystemConfigured: vi.fn(() => true),
    getFileSystemConfig: vi.fn(() => ({ access: state.access })),
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
  checkAccess: vi.fn(async () => ({ granted: true })),
  buildContext: vi.fn(async (req: any) => ({ user: req.user?.dbUser })),
}));

vi.mock("../../server/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  storageLogger: { info: vi.fn() },
}));
vi.mock("../../server/modules/components", () => ({ isComponentEnabled: vi.fn(async () => true) }));
vi.mock("../../server/services/catalog-viewer", () => ({ catalogViewerForCatalog: vi.fn() }));

vi.mock("../../server/utils/content-disposition", () => ({
  buildContentDisposition: vi.fn(() => "inline"),
}));

vi.mock("../../server/services/entity-files/registry", () => ({
  getEntityFileContext: vi.fn((id: string) => id === "template_asset" ? {
    id, label: "Template Assets", recordLabel: "Template Asset", publishedAsset: true,
    checkAccess: async (_verb: string, _id: string, req: any) => req.header("x-user") !== "non-staff",
    entityExists: async (entityId: string) => state.owners.has(entityId),
  } : undefined),
  listEntityFileContexts: vi.fn(() => []),
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
import { registerEntityFileRoutes } from "../../server/modules/entity-files";
import { registerFileBrowserRoutes } from "../../server/modules/file-browser";

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
    (req as any).session = req.header("x-masquerade")
      ? { masqueradeUserId: req.header("x-masquerade"), originalUserId: userId }
      : {};
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
  filename = "logo.png",
  endpoint = "/api/template-assets",
) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), filename);
  return fetch(`${baseUrl}${endpoint}`, {
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
  state.failUpload = false;
  state.access = "public";
  state.config = { file_system: "assets", directory: "custom/images/:entity-id", allowed: ["png", "jpg", "jpeg"] };
  state.owners.clear();
  const app = express();
  app.use(express.json());
  const authMiddleware = auth();
  registerFileRoutes(app, authMiddleware.requireAuth, authMiddleware.requirePermission);
  registerEntityFileRoutes(app, authMiddleware.requireAuth);
  registerFileBrowserRoutes(app, authMiddleware.requireAuth);
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
    expect(publicUrl.pathname).toMatch(/^\/public-files\/assets\/custom\/images\/[0-9a-f-]+\/[0-9a-f-]+-logo\.png$/);

    const served = await fetch(`${baseUrl}${publicUrl.pathname}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(pngBytes());
    expect(state.files.values().next().value.uploadedBy).toBe("staff");
  });
  it("accepts JPEG and serves it as JPEG", async () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0xff, 0xd9]);
    const response = await upload(bytes, "image/jpeg", { "x-user": "staff" }, "logo.jpg");
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
    expect(state.owners.size).toBe(0);
  });
  it("refuses missing config, private storage and unsafe extension lists before writing", async () => {
    state.config = undefined;
    expect((await upload()).status).toBe(503);
    state.config = { file_system: "assets", directory: "images", allowed: ["png"] };
    state.access = "private";
    expect((await upload()).status).toBe(503);
    state.access = "public";
    state.config.allowed = ["svg"];
    expect((await upload()).status).toBe(503);
    expect(state.upload).not.toHaveBeenCalled();
  });
  it("does not register or publish a provider-reported partial upload", async () => {
    const { fileSystemService } = await import("../../server/services/files");
    vi.mocked(fileSystemService.upload).mockImplementationOnce(async ({ customPath }) => {
      const path = customPath!;
      state.objects.set(path, pngBytes().subarray(0, 12));
      return { storagePath: path, size: 12 };
    });
    expect((await upload()).status).toBe(500);
    expect(state.files.size).toBe(0);
    expect(state.owners.size).toBe(0);
    expect(state.objects.size).toBe(0);
  });
  it("does not create owner or metadata on provider failure", async () => {
    state.failUpload = true;
    expect((await upload()).status).toBe(500);
    expect(state.files.size).toBe(0);
    expect(state.owners.size).toBe(0);
  });
  it("attributes a published upload to the effective masqueraded user", async () => {
    expect((await upload(pngBytes(), "image/png", { "x-user": "admin", "x-masquerade": "staff-target" })).status).toBe(201);
    expect(state.files.values().next().value.uploadedBy).toBe("staff-target");
  });
  it("enforces the same raster, size, config, and authorization rules on generic attachment calls", async () => {
    state.owners.add("existing-owner");
    const endpoint = "/api/entity-files/template_asset/existing-owner";
    const direct = (bytes = pngBytes(), mime = "image/png", headers = { "x-user": "staff" }) =>
      upload(bytes, mime, headers, "logo.png", endpoint);
    expect((await direct(pngBytes(), "image/png", { "x-user": "non-staff" })).status).toBe(403);
    expect((await direct(Buffer.from("<svg/>"))).status).toBe(400);
    const largeDimensions = pngBytes();
    largeDimensions.writeUInt32BE(8193, 16);
    expect((await direct(largeDimensions)).status).toBe(400);
    expect((await direct(Buffer.concat([pngBytes(), Buffer.alloc(1024 * 1024)]))).status).toBe(413);
    state.access = "private";
    expect((await direct()).status).toBe(503);
    state.access = "public";
    state.publicUrl = "http://app.example";
    expect((await direct()).status).toBe(503);
    expect(state.upload).not.toHaveBeenCalled();
    state.publicUrl = "https://app.example";
    expect((await direct()).status).toBe(201);
    expect(state.files.values().next().value.entityId).toBe("existing-owner");
  });
  it("blocks attachment metadata edits and deletion after publication", async () => {
    expect((await upload()).status).toBe(201);
    const owner = [...state.owners][0];
    for (const method of ["PATCH", "DELETE"]) {
      expect((await fetch(`${baseUrl}/api/entity-files/template_asset/${owner}/attachment-id`, {
        method, headers: { "x-user": "staff", "Content-Type": "application/json" }, body: '{"name":"renamed"}',
      })).status).toBe(409);
    }
    expect(state.files.size).toBe(1);
    expect(state.objects.size).toBe(1);
  });
  it("refuses raw admin browser replace, move, folder move and byte deletion before touching storage", async () => {
    const published = await upload();
    const { url } = await published.json();
    const path = new URL(url).pathname.split("/").slice(3).join("/");
    const headers = { "x-user": "staff", "Content-Type": "application/json" };
    const move = (isDirectory: boolean) => fetch(`${baseUrl}/api/admin/filesystems/assets/move`, {
      method: "POST", headers, body: JSON.stringify({ from: isDirectory ? "custom/images" : path, to: "moved", isDirectory }),
    });
    expect((await move(false)).status).toBe(409);
    expect((await move(true)).status).toBe(409);
    expect((await fetch(`${baseUrl}/api/admin/filesystems/assets/object?path=${encodeURIComponent(path)}`, {
      method: "DELETE", headers,
    })).status).toBe(409);
    expect((await fetch(`${baseUrl}/api/admin/filesystems/assets/object?path=${encodeURIComponent("/" + path)}`, {
      method: "DELETE", headers,
    })).status).toBe(409);
    expect((await fetch(`${baseUrl}/api/admin/filesystems/assets/object?path=${encodeURIComponent(path.replace("custom/", "custom/./"))}`, {
      method: "DELETE", headers,
    })).status).toBe(400);
    const body = new FormData();
    body.append("file", new Blob([pngBytes()], { type: "image/png" }), "replacement.png");
    body.append("path", path);
    expect((await fetch(`${baseUrl}/api/admin/filesystems/assets/upload`, {
      method: "POST", headers: { "x-user": "staff" }, body,
    })).status).toBe(409);
    body.set("path", path.replace("custom/", "custom/./"));
    expect((await fetch(`${baseUrl}/api/admin/filesystems/assets/upload`, {
      method: "POST", headers: { "x-user": "staff" }, body,
    })).status).toBe(400);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.objects.size).toBe(1);
    expect(state.files.size).toBe(1);
  });
  it("refuses generic file mutation and anonymous serving on private storage", async () => {
    const response = await upload();
    const { url } = await response.json();
    for (const method of ["PATCH", "DELETE"]) {
      expect((await fetch(`${baseUrl}/api/files/asset-id`, {
        method, headers: { "x-user": "staff", "Content-Type": "application/json" }, body: "{}",
      })).status).toBe(409);
    }
    state.access = "private";
    expect((await fetch(`${baseUrl}${new URL(url).pathname}`)).status).toBe(404);
    expect(state.objects.size).toBe(1);
  });
});