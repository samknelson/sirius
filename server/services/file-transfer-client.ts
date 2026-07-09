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

/**
 * Validate the configured private key locally (before any network I/O) so a
 * malformed / unsupported key produces a clear message instead of a generic
 * connection error. Returns null when the key parses fine.
 */
async function validatePrivateKey(conn: SftpConnectionData): Promise<string | null> {
  if (!conn.privateKey) return null;
  const { utils } = await import("ssh2");
  const parsed = utils.parseKey(conn.privateKey, conn.passphrase || undefined);
  if (parsed instanceof Error) {
    return `Private key is invalid or unsupported: ${parsed.message}`;
  }
  return null;
}

/**
 * Turn low-level ssh2 handshake debug lines into a short human-readable
 * diagnosis of how far the connection got before failing.
 */
function diagnoseSshFailure(rawError: string, debugLines: string[]): string {
  const joined = debugLines.join("\n");
  const sawRemoteBanner = /remote ident|Remote ident/i.test(joined);
  const sawKexInit = /KEXINIT/i.test(joined);
  const sawAuth = /USERAUTH/i.test(joined);

  const hints: string[] = [];
  if (!sawRemoteBanner) {
    hints.push(
      "The server closed the TCP connection before sending its SSH banner. " +
      "This happens before any key is used, so the key pair is NOT the cause. " +
      "Likely causes: an IP allowlist / firewall on the server rejecting this app's outbound IP, " +
      "a rate-limit/fail2ban block, or the wrong port."
    );
  } else if (!sawKexInit || !sawAuth) {
    hints.push(
      "The server sent its banner but dropped the connection during key exchange (before authentication). " +
      "Likely causes: no shared key-exchange/cipher algorithms, or a middlebox interfering."
    );
  } else {
    hints.push(
      "The connection reached the authentication phase, so this is likely a key problem: " +
      "wrong key pair, public key not installed on the server for this username, or wrong key format."
    );
  }

  const tail = debugLines.slice(-12);
  return `${rawError}\n\nDiagnosis: ${hints.join(" ")}${tail.length ? `\n\nSSH debug trail (last ${tail.length} lines):\n${tail.join("\n")}` : ""}`;
}

async function withSftpClient<T>(
  conn: SftpConnectionData,
  fn: (client: import("ssh2-sftp-client")) => Promise<T>,
  options?: { collectDebug?: boolean }
): Promise<T> {
  const keyError = await validatePrivateKey(conn);
  if (keyError) throw new Error(keyError);

  const SftpClient = (await import("ssh2-sftp-client")).default;
  const client = new SftpClient();
  const debugLines: string[] = [];
  const connectOpts: Record<string, unknown> = {
    host: conn.host,
    port: conn.port,
    username: conn.username || undefined,
    readyTimeout: 15000,
  };
  if (options?.collectDebug) {
    connectOpts.debug = (msg: string) => {
      debugLines.push(msg);
      if (debugLines.length > 200) debugLines.shift();
    };
  }
  if (conn.privateKey) {
    connectOpts.privateKey = conn.privateKey;
    if (conn.passphrase) connectOpts.passphrase = conn.passphrase;
  } else if (conn.password) {
    connectOpts.password = conn.password;
  }
  try {
    await client.connect(connectOpts);
    return await fn(client);
  } catch (err: unknown) {
    if (options?.collectDebug) {
      const raw = err instanceof Error ? err.message : String(err);
      throw new Error(diagnoseSshFailure(raw, debugLines));
    }
    throw err;
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
      }, { collectDebug: true });
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

export async function streamDownload(
  conn: ConnectionData,
  remoteFilePath: string,
  destinationId: string,
  output: import("stream").Writable
): Promise<void> {
  const { pipeline } = await import("stream/promises");
  const { PassThrough } = await import("stream");
  const start = Date.now();
  let bytesTransferred = 0;

  const counter = new PassThrough();
  counter.on("data", (chunk: Buffer) => {
    bytesTransferred += chunk.length;
  });

  try {
    if (conn.protocol === "sftp") {
      await withSftpClient(conn, async (client) => {
        const readStream = client.createReadStream(remoteFilePath);
        await pipeline(readStream, counter, output);
      });
    } else {
      await withFtpClient(conn, async (client) => {
        const ftpPass = new PassThrough();
        const pipelinePromise = pipeline(ftpPass, counter, output);
        try {
          await client.downloadTo(ftpPass, remoteFilePath);
          ftpPass.end();
        } catch (downloadErr) {
          ftpPass.destroy(downloadErr instanceof Error ? downloadErr : new Error(String(downloadErr)));
          await pipelinePromise.catch(() => {});
          throw downloadErr;
        }
        await pipelinePromise;
      });
    }

    const duration = Date.now() - start;
    logTestOperation("download", destinationId, {
      success: true, duration, data: { size: bytesTransferred },
    }, `Download ${remoteFilePath} (${bytesTransferred} bytes)`);
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logTestOperation("download", destinationId, {
      success: false, duration, error: message,
    }, `Download ${remoteFilePath} (${bytesTransferred} bytes)`);
    throw err;
  }
}
