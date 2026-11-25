import {
  FileSystemOperationError,
  type FileListOptions,
  type FileListPage,
  type FileStat,
  type FileSystemProvider,
} from "../base";

/**
 * Replit Object Storage provider. Every object operation asks the local
 * Replit storage sidecar for a short-lived signed URL scoped to this
 * filesystem's bucket, then performs the request against that URL.
 *
 * The sidecar client and its error types are private to this module: callers
 * only ever see FileSystemOperationError (or null from stat for a genuinely
 * absent object).
 */

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
/** Lifetime of the signed URLs minted for the provider's own requests. */
const OPERATION_URL_TTL_SECONDS = 900;

type SignedMethod = "GET" | "PUT" | "DELETE" | "HEAD";

/** The sidecar or bucket could not be reached / refused the request. */
class ObjectStorageConnectionError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "ObjectStorageConnectionError";
  }
}

/** The object itself does not exist (HEAD answered 404). */
class ObjectNotFoundError extends Error {
  constructor() {
    super("File not found");
    this.name = "ObjectNotFoundError";
  }
}

async function checkStorageServiceAvailable(): Promise<{ available: boolean; error?: string }> {
  try {
    const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { available: true };
    }
    return { available: false, error: `Storage service returned status ${response.status}` };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === "AbortError" || error.message.includes("timeout")) {
        return { available: false, error: "Storage service connection timed out" };
      }
      if (error.message.includes("ECONNREFUSED") || error.message.includes("fetch failed")) {
        return {
          available: false,
          error: "Cannot connect to storage service - the Replit storage sidecar is not running",
        };
      }
    }
    return { available: false, error: "Storage service is unavailable" };
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return { bucketName: pathParts[1], objectName: pathParts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: SignedMethod;
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };

  let response: Response;
  try {
    response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const serviceCheck = await checkStorageServiceAvailable();
    if (!serviceCheck.available) {
      throw new ObjectStorageConnectionError(
        `Object Storage is not available: ${serviceCheck.error}. ` +
          `Please ensure Object Storage is configured in your Replit workspace by opening the "Object Storage" tool in the sidebar.`,
      );
    }
    throw new ObjectStorageConnectionError(
      `Failed to connect to Object Storage service: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }

  if (!response.ok) {
    let errorDetails = "";
    try {
      const errorBody = await response.text();
      if (errorBody) {
        errorDetails = `: ${errorBody}`;
      }
    } catch {}

    if (response.status === 401) {
      throw new ObjectStorageConnectionError(
        `Object Storage authentication failed. The storage bucket "${bucketName}" may not exist or is not accessible. ` +
          `Please open the "Object Storage" tool in your Replit workspace and verify that a bucket named "${bucketName}" exists and is properly configured.`,
        401,
      );
    }

    if (response.status === 404) {
      throw new ObjectStorageConnectionError(
        `Object Storage bucket "${bucketName}" was not found. ` +
          `Please open the "Object Storage" tool in your Replit workspace and verify the filesystem's bucket_id.`,
        404,
      );
    }

    if (response.status >= 500) {
      throw new ObjectStorageConnectionError(
        `Object Storage service error (${response.status}). This may be a temporary issue with Replit's storage infrastructure. Please try again in a few moments.`,
        response.status,
      );
    }

    throw new ObjectStorageConnectionError(
      `Object Storage request failed with status ${response.status}${errorDetails}`,
      response.status,
    );
  }

  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

export class ReplitFileSystemProvider implements FileSystemProvider {
  readonly kind = "replit" as const;
  private readonly bucketId: string;

  constructor(
    readonly fileSystemId: string,
    settings: { bucket_id: string },
  ) {
    this.bucketId = settings.bucket_id;
  }

  private sign(path: string, method: SignedMethod, ttlSec: number): Promise<string> {
    const { bucketName, objectName } = parseObjectPath(`/${this.bucketId}/${path}`);
    return signObjectURL({ bucketName, objectName, method, ttlSec });
  }

  private fail(action: string, path: string, error: unknown): FileSystemOperationError {
    return new FileSystemOperationError(
      `Failed to ${action} "${path}": ${error instanceof Error ? error.message : String(error)}`,
      this.fileSystemId,
      error,
    );
  }

  async read(path: string): Promise<Buffer> {
    try {
      const signedUrl = await this.sign(path, "GET", OPERATION_URL_TTL_SECONDS);
      const response = await fetch(signedUrl);
      if (!response.ok) {
        throw new Error("File not found or empty");
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      throw this.fail("read", path, error);
    }
  }

  async write(path: string, content: Buffer, opts?: { mimeType?: string }): Promise<void> {
    try {
      const signedUrl = await this.sign(path, "PUT", OPERATION_URL_TTL_SECONDS);
      const response = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": opts?.mimeType || "application/octet-stream" },
        body: content,
      });
      if (!response.ok) {
        throw new Error(`Failed to upload file: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      throw this.fail("write", path, error);
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const signedUrl = await this.sign(path, "DELETE", OPERATION_URL_TTL_SECONDS);
      const response = await fetch(signedUrl, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Failed to delete file: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      // Replit's DELETE on a missing object errors; treat as idempotent when
      // the object is already gone. Any failure of the follow-up metadata
      // request is treated as "gone", matching the previous behavior.
      const exists = await this.headObject(path).then(
        () => true,
        () => false,
      );
      if (!exists) return;
      throw this.fail("delete", path, error);
    }
  }

  /**
   * HEAD the object. Throws ObjectNotFoundError for a genuine 404 and
   * ObjectStorageConnectionError for any other non-OK answer, so callers can
   * tell an absent object from an inaccessible bucket.
   */
  private async headObject(path: string): Promise<FileStat> {
    const signedUrl = await this.sign(path, "HEAD", OPERATION_URL_TTL_SECONDS);
    const response = await fetch(signedUrl, { method: "HEAD" });
    if (response.status === 404) {
      throw new ObjectNotFoundError();
    }
    if (!response.ok) {
      throw new ObjectStorageConnectionError(
        `Metadata request for "${path}" failed with HTTP ${response.status}`,
        response.status,
      );
    }
    const contentLength = response.headers.get("content-length");
    const contentType = response.headers.get("content-type");
    const lastModified = response.headers.get("last-modified");
    return {
      size: contentLength ? parseInt(contentLength) : 0,
      mimeType: contentType || undefined,
      lastModified: lastModified ? new Date(lastModified) : undefined,
    };
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      return await this.headObject(path);
    } catch (error) {
      // Only a genuine 404 means "no such object". Auth / connection /
      // sidecar failures must propagate so callers (the consistency sweep)
      // never mistake an inaccessible bucket for a missing file.
      if (error instanceof ObjectNotFoundError) {
        return null;
      }
      throw this.fail("stat", path, error);
    }
  }

  async list(_opts?: FileListOptions): Promise<FileListPage> {
    // The Replit storage sidecar exposes no list endpoint; listings for
    // replit-backed filesystems come from the files table instead.
    throw new FileSystemOperationError(
      "The replit provider does not support listing; use the files table (storage.files.list) instead.",
      this.fileSystemId,
    );
  }

  async getSignedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    return this.sign(path, "GET", expiresInSeconds);
  }
}
