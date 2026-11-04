/**
 * Real PostgreSQL, two Node processes, advisory locks only. Does NOT insert
 * people, users, sessions, test records or change any business table.
 * Run explicitly: node --import tsx tests/privacy/real-lease.mts
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { pool, getPresentationLeasePool } from "../../server/storage/db";
import { createAdvisoryLockStorage } from "../../server/storage/advisory-lock";

const presentationLeasePool = getPresentationLeasePool();
const locks = createAdvisoryLockStorage(presentationLeasePool);
if (process.argv[2] === "--reader") {
  const handle = await locks.tryAcquireSession(process.argv[3], { timeoutMs: 1000, shared: true });
  assert.ok(handle && handle.isHeld?.());
  process.send?.({ ready: true, pid: handle.backendPid });
  await new Promise<void>(resolve => process.once("message", () => resolve()));
  await handle.release();
  await Promise.all([pool.end(), presentationLeasePool.end()]);
  process.disconnect?.();
} else {
  const name = `privacy-verification:${randomUUID()}`;
  const child = fork(fileURLToPath(import.meta.url), ["--reader", name], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let reader: Awaited<ReturnType<typeof locks.tryAcquireSession>> = null;
  let writer: Awaited<ReturnType<typeof locks.tryAcquireSession>> = null;
  let childError = "";
  child.stderr?.on("data", chunk => { childError += String(chunk); });
  const watchdog = setTimeout(() => {
    child.kill("SIGTERM");
    throw new Error("Cross-process coordination verification exceeded 30 seconds");
  }, 30000);
  try {
    const remote = await new Promise<{ pid: number }>((resolve, reject) => {
      child.once("message", message => resolve(message as { pid: number }));
      child.once("error", reject);
      child.once("exit", code => { if (code) reject(new Error(`Reader exited ${code}: ${childError}`)); });
    });
    reader = await locks.tryAcquireSession(name, { timeoutMs: 1000, shared: true });
    assert.ok(reader && reader.isHeld?.());
    assert.notEqual(reader.backendPid, remote.pid, "independent PostgreSQL backends");
    const refused = await locks.tryAcquireSession(name, { timeoutMs: 60, pollIntervalMs: 10 });
    assert.equal(refused, null, "exclusive transition must refuse while either reader is active");
    await reader.release();
    reader = null;
    assert.equal(await locks.tryAcquireSession(name, { timeoutMs: 60, pollIntervalMs: 10 }), null,
      "a separate Node process must still fence this transition");
    const childExit = new Promise<void>((resolve, reject) => child.once("exit",
      code => code === 0 ? resolve() : reject(new Error(`Reader exited ${code}`))));
    child.send({ release: true });
    await childExit;
    writer = await locks.tryAcquireSession(name, { timeoutMs: 1000 });
    assert.ok(writer && writer.isHeld?.());
    const blockedReader = await locks.tryAcquireSession(name, { timeoutMs: 50, pollIntervalMs: 10, shared: true });
    assert.equal(blockedReader, null);
    await writer.release();
    writer = null;
    console.log("PASS real PostgreSQL cross-process reader drain/exclusive transition, bounded refusal and independent lease pool; no business records written.");
  } finally {
    clearTimeout(watchdog);
    await reader?.release();
    await writer?.release();
    if (child.connected) child.kill("SIGTERM");
    await Promise.all([pool.end(), presentationLeasePool.end()]);
  }
}
