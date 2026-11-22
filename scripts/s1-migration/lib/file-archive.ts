import { HeadObjectCommand, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { open, realpath, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, sep } from "node:path";

export interface ArchiveReader {
  head(key: string): Promise<number | null>;
  get(key: string, maxBytes: number): Promise<Buffer>;
}
export function archiveKey(uri: string, prefix = "private/"): string | null {
  if (!uri.startsWith("private://")) return null;
  const path = uri.slice(10);
  if (!path || /[\\\0]/.test(path) || path.split("/").some(p => !p || p === "." || p === "..")) return null;
  if (prefix.startsWith("/") || /[\\\0]/.test(prefix) || prefix.split("/").some(p => p === "." || p === "..")) {
    throw new Error("archive_prefix_invalid");
  }
  return `${prefix ? prefix.replace(/\/+$/, "") + "/" : ""}${path}`;
}
export class S3Archive implements ArchiveReader {
  private client = new S3Client({ maxAttempts: 3 });
  constructor(private bucket: string) {}
  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(60_000) });
      if (!Number.isSafeInteger(r.ContentLength) || r.ContentLength! < 0) throw new Error();
      return r.ContentLength!;
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw new Error("archive_head_failed");
    }
  }
  async get(key: string, maxBytes: number) {
    let body: any;
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(120_000) });
      body = r.Body;
      const chunks: Buffer[] = []; let size = 0;
      if (!body) throw new Error();
      for await (const chunk of body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error();
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks, size);
    } catch { body?.destroy?.(); throw new Error("archive_get_failed"); }
  }
}
/** Explicit synthetic-only reader. No AWS credentials or network involved. */
export class LocalArchive implements ArchiveReader {
  constructor(private root: string) {}
  private async path(key: string) {
    const root = await realpath(this.root);
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error("archive_path_invalid");
    let part = root;
    for (const segment of key.split("/")) {
      if (!segment || segment === "." || segment === ".." || segment.includes("\\")) throw new Error("archive_path_invalid");
      part = resolve(part, segment);
      if ((await lstat(part)).isSymbolicLink()) throw new Error("archive_path_invalid");
    }
    if (!(await realpath(path)).startsWith(root + sep)) throw new Error("archive_path_invalid");
    return path;
  }
  async head(key: string) {
    try {
      const stat = await lstat(await this.path(key));
      if (!stat.isFile()) throw new Error();
      return stat.size;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("archive_head_failed");
    }
  }
  async get(key: string, maxBytes: number) {
    try {
      const handle = await open(await this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const root = await realpath(this.root);
        if (!(await realpath(`/proc/self/fd/${handle.fd}`)).startsWith(root + sep)) throw new Error();
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > maxBytes) throw new Error();
        const buffer = Buffer.alloc(stat.size + 1);
        let total = 0;
        while (total < buffer.length) {
          const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
          if (!bytesRead) break;
          total += bytesRead;
        }
        if (total !== stat.size) throw new Error();
        return buffer.subarray(0, total);
      } finally { await handle.close(); }
    } catch { throw new Error("archive_get_failed"); }
  }
}
