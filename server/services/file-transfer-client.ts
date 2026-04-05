import type { ConnectionData, SftpConnectionData, FtpConnectionData } from "../../shared/schema/system/sftp-client-schema";

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

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = Date.now();
  const result = await fn();
  return { result, duration: Date.now() - start };
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

export async function testConnect(conn: ConnectionData): Promise<TransferResult<ConnectInfo>> {
  try {
    const { result, duration } = await timed(async () => {
      if (conn.protocol === "sftp") {
        return withSftpClient(conn, async () => ({ banner: "SFTP connection successful", serverType: "SFTP" }));
      }
      return withFtpClient(conn, async () => ({
        banner: "FTP connection successful",
        serverType: "FTP",
      }));
    });
    return { success: true, duration, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration: 0, error: message };
  }
}

export async function testList(conn: ConnectionData, remotePath: string): Promise<TransferResult<FileEntry[]>> {
  try {
    const { result, duration } = await timed(async () => {
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
    return { success: true, duration, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration: 0, error: message };
  }
}

export async function testCd(conn: ConnectionData, remotePath: string): Promise<TransferResult<{ path: string }>> {
  try {
    const { result, duration } = await timed(async () => {
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
    return { success: true, duration, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration: 0, error: message };
  }
}

export async function testUpload(
  conn: ConnectionData,
  remotePath: string,
  fileName: string,
  content: Buffer
): Promise<TransferResult<{ bytesWritten: number }>> {
  try {
    const { result, duration } = await timed(async () => {
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
    return { success: true, duration, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration: 0, error: message };
  }
}

const MAX_DOWNLOAD_BYTES = 1024 * 1024;

export async function testDownload(
  conn: ConnectionData,
  remoteFilePath: string
): Promise<TransferResult<{ size: number; contentBase64: string }>> {
  try {
    const { result, duration } = await timed(async () => {
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
    return { success: true, duration, data: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, duration: 0, error: message };
  }
}
