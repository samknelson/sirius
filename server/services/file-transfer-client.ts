import type { ConnectionData, SftpConnectionData, FtpConnectionData } from "../../shared/schema/system/sftp-client-schema";
import { storageLogger } from "../logger";
import { getRequestContext } from "../middleware/request-context";

export interface FileEntry {
  name: string;
  type: "file" | "directory" | "unknown";
  size: number;
  modifiedAt: string | null;
}

export interface TransferResult<T = unknown> {
  success: boolean;
  duration: number;
  data?: T;
  error?: string;
}

interface ConnectInfo {
  banner?: string;
  serverType?: string;
}

async function timedResult<T>(fn: () => Promise<T>): Promise<TransferResult<T>> {
  const start = Date.now();
  try {
    const data = await fn();
    return { success: true, duration: Date.now() - start, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration: Date.now() - start, error: message };
  }
}

function logTestOperation(
  operation: string,
  destinationId: string,
  result: TransferResult<unknown>,
  description: string
): void {
  const ctx = getRequestContext();
  const level = result.success ? "info" : "warn";
  const outcome = result.success ? "succeeded" : "failed";
  const desc = result.success
    ? `${description} — ${outcome} in ${result.duration}ms`
    : `${description} — ${outcome} in ${result.duration}ms: ${result.error}`;

  storageLogger.log(level, `SFTP test ${operation} ${outcome} (${result.duration}ms)`, {
    source: "sftp_test",
    module: "sftpClientDestinations",
    operation: `test_${operation}`,
    host_entity_id: destinationId,
    description: desc,
    duration: result.duration,
    user_id: ctx?.userId || null,
    user_email: ctx?.userEmail || null,
    ip_address: ctx?.ipAddress || null,
  });
}

async function withSftpClient<T>(
  conn: SftpConnectionData,
  fn: (client: import("ssh2-sftp-client")) => Promise<T>
): Promise<T> {
  const SftpClient = (await import("ssh2-sftp-client")).default;
  const client = new SftpClient();
  const connectOpts: Record<string, unknown> = {
    host: conn.host,
    port: conn.port,
    username: conn.username || undefined,
    readyTimeout: 15000,
  };
  if (conn.privateKey) {
    connectOpts.privateKey = conn.privateKey;
    if (conn.passphrase) connectOpts.passphrase = conn.passphrase;
  } else if (conn.password) {
    connectOpts.password = conn.password;
  }
  try {
    await client.connect(connectOpts);
    return await fn(client);
  } finally {
    try { await client.end(); } catch {}
  }
}

async function withFtpClient<T>(
  conn: FtpConnectionData,
  fn: (client: import("basic-ftp").Client) => Promise<T>
): Promise<T> {
  const { Client: FtpClientClass } = await import("basic-ftp");
  const client = new FtpClientClass();
  client.ftp.verbose = false;
  try {
    const accessOpts: Record<string, unknown> = {
      host: conn.host,
      port: conn.port,
      user: conn.username || undefined,
      password: conn.password || undefined,
      secure: conn.tlsMode === "explicit" ? true : conn.tlsMode === "implicit" ? "implicit" as const : false,
    };
    await client.access(accessOpts as Parameters<typeof client.access>[0]);
    return await fn(client);
  } finally {
    client.close();
  }
}

export async function testConnect(conn: ConnectionData, destinationId: string): Promise<TransferResult<ConnectInfo>> {
  const result = await timedResult(async () => {
    if (conn.protocol === "sftp") {
      return withSftpClient(conn, async (client) => {
        const cwd = await client.cwd();
        return {
          banner: `SFTP connection successful. Remote working directory: ${cwd}`,
          serverType: "SFTP",
        };
      });
    }
    return withFtpClient(conn, async (client) => {
      const pwd = await client.pwd();
      return {
        banner: `FTP connection successful. Remote working directory: ${pwd}`,
        serverType: "FTP",
      };
    });
  });
  logTestOperation("connect", destinationId, result, `Connect to ${conn.host}:${conn.port} via ${conn.protocol.toUpperCase()}`);
  return result;
}

export async function testList(conn: ConnectionData, remotePath: string, destinationId: string): Promise<TransferResult<FileEntry[]>> {
  const result = await timedResult(async () => {
    if (conn.protocol === "sftp") {
      return withSftpClient(conn, async (client) => {
        const items = await client.list(remotePath || "/");
        return items.map((item): FileEntry => ({
          name: item.name,
          type: item.type === "d" ? "directory" : item.type === "-" ? "file" : "unknown",
          size: item.size,
          modifiedAt: item.modifyTime ? new Date(item.modifyTime).toISOString() : null,
        }));
      });
    }
    return withFtpClient(conn, async (client) => {
      const items = await client.list(remotePath || "/");
      return items.map((item): FileEntry => ({
        name: item.name,
        type: item.isDirectory ? "directory" : item.isFile ? "file" : "unknown",
        size: item.size,
        modifiedAt: item.modifiedAt ? item.modifiedAt.toISOString() : null,
      }));
    });
  });
  const itemCount = result.success && result.data ? result.data.length : 0;
  logTestOperation("list", destinationId, result, `List ${remotePath || "/"} (${itemCount} items)`);
  return result;
}

export async function testCd(conn: ConnectionData, remotePath: string, destinationId: string): Promise<TransferResult<{ path: string }>> {
  const result = await timedResult(async () => {
    if (conn.protocol === "sftp") {
      return withSftpClient(conn, async (client) => {
        const exists = await client.exists(remotePath);
        if (!exists || exists !== "d") {
          throw new Error(`Path does not exist or is not a directory: ${remotePath}`);
        }
        return { path: remotePath };
      });
    }
    return withFtpClient(conn, async (client) => {
      await client.cd(remotePath);
      const pwd = await client.pwd();
      return { path: pwd };
    });
  });
  logTestOperation("cd", destinationId, result, `Change directory to ${remotePath}`);
  return result;
}

export async function testUpload(
  conn: ConnectionData,
  remotePath: string,
  fileName: string,
  content: Buffer,
  destinationId: string
): Promise<TransferResult<{ bytesWritten: number }>> {
  const result = await timedResult(async () => {
    if (conn.protocol === "sftp") {
      return withSftpClient(conn, async (client) => {
        const fullPath = remotePath.endsWith("/")
          ? `${remotePath}${fileName}`
          : `${remotePath}/${fileName}`;
        await client.put(content, fullPath);
        return { bytesWritten: content.length };
      });
    }
    return withFtpClient(conn, async (client) => {
      if (remotePath && remotePath !== "/") {
        await client.cd(remotePath);
      }
      const { Readable } = await import("stream");
      const readable = Readable.from(content);
      await client.uploadFrom(readable, fileName);
      return { bytesWritten: content.length };
    });
  });
  const bytesWritten = result.success && result.data ? result.data.bytesWritten : content.length;
  logTestOperation("upload", destinationId, result, `Upload ${fileName} (${bytesWritten} bytes) to ${remotePath}`);
  return result;
}

const MAX_DOWNLOAD_BYTES = 1024 * 1024;

export async function testDownload(
  conn: ConnectionData,
  remoteFilePath: string,
  destinationId: string
): Promise<TransferResult<{ size: number; contentBase64: string }>> {
  const result = await timedResult(async () => {
    if (conn.protocol === "sftp") {
      return withSftpClient(conn, async (client) => {
        const stat = await client.stat(remoteFilePath);
        if (stat.size > MAX_DOWNLOAD_BYTES) {
          throw new Error(`File too large (${stat.size} bytes). Maximum download size is ${MAX_DOWNLOAD_BYTES} bytes.`);
        }
        const stream = client.createReadStream(remoteFilePath);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(Buffer.from(chunk as Buffer));
        }
        const buffer = Buffer.concat(chunks);
        return { size: buffer.length, contentBase64: buffer.toString("base64") };
      });
    }
    return withFtpClient(conn, async (client) => {
      const { PassThrough } = await import("stream");
      const pass = new PassThrough();
      const chunks: Buffer[] = [];
      let totalSize = 0;
      pass.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_DOWNLOAD_BYTES) {
          pass.destroy(new Error(`File too large. Maximum download size is ${MAX_DOWNLOAD_BYTES} bytes.`));
          return;
        }
        chunks.push(chunk);
      });
      await client.downloadTo(pass, remoteFilePath);
      const buffer = Buffer.concat(chunks);
      return { size: buffer.length, contentBase64: buffer.toString("base64") };
    });
  });
  const downloadSize = result.success && result.data ? result.data.size : 0;
  logTestOperation("download", destinationId, result, `Download ${remoteFilePath} (${downloadSize} bytes)`);
  return result;
}
