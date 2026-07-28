import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DestinationExistsError,
  DirectoryNotEmptyError,
  FileSystemOperationError,
  type FileListOptions,
  type FileListPage,
  type FileStat,
  type FileSystemProvider,
} from "../base";

export interface S3ProviderSettings {
  bucket: string;
  region: string;
  endpoint?: string;
  force_path_style?: boolean;
  /** Optional key prefix all objects for this filesystem live under. */
  prefix?: string;
  access_key_id: string;
  secret_access_key: string;
}

export class S3FileSystemProvider implements FileSystemProvider {
  readonly kind = "s3" as const;
  readonly supportsDirectories = true;
  readonly supportsRename = true;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(
    readonly fileSystemId: string,
    settings: S3ProviderSettings,
  ) {
    this.bucket = settings.bucket;
    this.prefix = settings.prefix ? settings.prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
    this.client = new S3Client({
      region: settings.region,
      ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
      ...(settings.force_path_style ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: settings.access_key_id,
        secretAccessKey: settings.secret_access_key,
      },
    });
  }

  private key(path: string): string {
    return this.prefix + path.replace(/^\/+/, "");
  }

  private wrap(op: string, path: string, error: unknown): FileSystemOperationError {
    return new FileSystemOperationError(
      `S3 ${op} failed for "${path}": ${error instanceof Error ? error.message : String(error)}`,
      this.fileSystemId,
      error,
    );
  }

  async read(path: string): Promise<Buffer> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      const bytes = await out.Body?.transformToByteArray();
      if (!bytes) throw new Error("empty response body");
      return Buffer.from(bytes);
    } catch (error) {
      throw this.wrap("read", path, error);
    }
  }

  async write(path: string, content: Buffer, opts?: { mimeType?: string }): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(path),
          Body: content,
          ContentType: opts?.mimeType || "application/octet-stream",
        }),
      );
    } catch (error) {
      throw this.wrap("write", path, error);
    }
  }

  async delete(path: string): Promise<void> {
    try {
      // S3 DeleteObject is idempotent — deleting a missing key succeeds.
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
    } catch (error) {
      throw this.wrap("delete", path, error);
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
      );
      return {
        size: out.ContentLength ?? 0,
        mimeType: out.ContentType,
        lastModified: out.LastModified,
      };
    } catch (error: any) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null;
      throw this.wrap("stat", path, error);
    }
  }

  /** Zero-byte keys ending in "/" are directory markers, never files. */
  private isDirectoryMarker(o: { Key?: string; Size?: number }): boolean {
    return !!o.Key && o.Key.endsWith("/") && (o.Size ?? 0) === 0;
  }

  async list(opts?: FileListOptions): Promise<FileListPage> {
    try {
      let requestPrefix = opts?.prefix?.replace(/^\/+/, "") ?? "";
      if (opts?.delimiter && requestPrefix && !requestPrefix.endsWith("/")) {
        requestPrefix += "/";
      }
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: this.prefix + requestPrefix,
          ...(opts?.delimiter ? { Delimiter: "/" } : {}),
          ContinuationToken: opts?.cursor,
          MaxKeys: Math.min(Math.max(opts?.limit ?? 100, 1), 1000),
        }),
      );
      const page: FileListPage = {
        entries: (out.Contents ?? [])
          .filter((o) => o.Key && !this.isDirectoryMarker(o))
          .map((o) => ({
            path: this.prefix ? o.Key!.slice(this.prefix.length) : o.Key!,
            size: o.Size ?? 0,
            lastModified: o.LastModified,
          })),
        cursor: out.IsTruncated ? out.NextContinuationToken : undefined,
      };
      if (opts?.delimiter) {
        page.directories = (out.CommonPrefixes ?? [])
          .map((p) => p.Prefix)
          .filter((p): p is string => !!p)
          .map((p) => (this.prefix ? p.slice(this.prefix.length) : p).replace(/\/+$/, ""))
          .filter((p) => p.length > 0);
      }
      return page;
    } catch (error) {
      throw this.wrap("list", opts?.prefix ?? "", error);
    }
  }

  async mkdir(path: string): Promise<void> {
    const dir = path.replace(/^\/+|\/+$/g, "");
    if (!dir) throw new FileSystemOperationError("Directory path is required", this.fileSystemId);
    try {
      // AWS-console convention: a zero-byte object whose key ends in "/".
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: this.key(dir) + "/",
          Body: Buffer.alloc(0),
          ContentType: "application/x-directory",
        }),
      );
    } catch (error) {
      throw this.wrap("mkdir", dir, error);
    }
  }

  async rmdir(path: string): Promise<void> {
    const dir = path.replace(/^\/+|\/+$/g, "");
    if (!dir) throw new FileSystemOperationError("Directory path is required", this.fileSystemId);
    const markerKey = this.key(dir) + "/";
    try {
      // Refuse when ANY key other than the marker itself lives under the prefix.
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: markerKey,
          MaxKeys: 2,
        }),
      );
      const others = (out.Contents ?? []).filter((o) => o.Key && o.Key !== markerKey);
      if (others.length > 0 || out.IsTruncated) {
        throw new DirectoryNotEmptyError(dir);
      }
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: markerKey }),
      );
    } catch (error) {
      if (error instanceof DirectoryNotEmptyError) throw error;
      throw this.wrap("rmdir", dir, error);
    }
  }

  /** Copy one key then delete the original (S3 has no native rename). */
  private async copyThenDelete(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: encodeURIComponent(`${this.bucket}/${fromKey}`).replace(/%2F/g, "/"),
        Key: toKey,
      }),
    );
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: fromKey }));
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    try {
      const existing = await this.stat(toPath);
      if (existing) throw new DestinationExistsError(toPath);
      await this.copyThenDelete(this.key(fromPath), this.key(toPath));
    } catch (error) {
      if (error instanceof DestinationExistsError) throw error;
      throw this.wrap("rename", fromPath, error);
    }
  }

  /**
   * Recursive prefix move: copy every key under fromPath/ (including any
   * zero-byte directory markers) to the new prefix, then delete the
   * originals. Not atomic — a mid-move failure leaves both prefixes
   * partially populated, surfaced to the operator via the thrown error.
   */
  async renameDirectory(fromPath: string, toPath: string): Promise<void> {
    const from = fromPath.replace(/^\/+|\/+$/g, "");
    const to = toPath.replace(/^\/+|\/+$/g, "");
    if (!from || !to) {
      throw new FileSystemOperationError("Directory path is required", this.fileSystemId);
    }
    const fromPrefix = this.key(from) + "/";
    const toPrefix = this.key(to) + "/";
    try {
      // Refuse when anything already lives under the destination prefix.
      const destCheck = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: toPrefix, MaxKeys: 1 }),
      );
      if ((destCheck.KeyCount ?? 0) > 0) {
        throw new DestinationExistsError(to);
      }
      let cursor: string | undefined;
      do {
        const out = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: fromPrefix,
            ContinuationToken: cursor,
            MaxKeys: 1000,
          }),
        );
        for (const o of out.Contents ?? []) {
          if (!o.Key) continue;
          const suffix = o.Key.slice(fromPrefix.length);
          await this.copyThenDelete(o.Key, toPrefix + suffix);
        }
        cursor = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (cursor);
    } catch (error) {
      if (error instanceof DestinationExistsError) throw error;
      throw this.wrap("renameDirectory", from, error);
    }
  }

  async getSignedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key(path) }),
        { expiresIn: expiresInSeconds },
      );
    } catch (error) {
      throw this.wrap("sign", path, error);
    }
  }
}
