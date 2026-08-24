/**
 * One-off verification for StorageSessionStore + session lifecycle logging.
 * Exercises set/get/touch/destroy, expired filtering, per-session prune, and
 * asserts the storage log entries: created-once, silent re-save/touch, and
 * per-session deletion logs with reason.
 */
import { StorageSessionStore } from "../../server/auth/session-store";
import { storage } from "../../server/storage";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import type { SessionData } from "express-session";

function call<T>(fn: (cb: (err: unknown, res?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Storage-log descriptions for a sid (retries: log writes are deferred+async). */
async function logsFor(sid: string, expectAtLeast: number): Promise<string[]> {
  for (let i = 0; i < 20; i++) {
    const res = await db.execute(sql`
      SELECT description FROM winston_logs
      WHERE module = 'sessions' AND entity_id = ${sid}
      ORDER BY timestamp ASC
    `);
    const rows = (res.rows as any[]).map((r) => String(r.description));
    if (rows.length >= expectAtLeast) return rows;
    await sleep(250);
  }
  const res = await db.execute(sql`
    SELECT description FROM winston_logs WHERE module = 'sessions' AND entity_id = ${sid} ORDER BY timestamp ASC
  `);
  return (res.rows as any[]).map((r) => String(r.description));
}

async function main() {
  const store = new StorageSessionStore({ ttlMs: 60_000 });
  const sid = `verify-store-${Date.now()}`;
  const inOneHour = new Date(Date.now() + 3600_000);
  const fakeUserId = `verify-user-${Date.now()}`;
  const passport = { user: { dbUser: { id: fakeUserId }, claims: { sub: "should-not-win" } } };
  const sess = { cookie: { maxAge: 3600_000, expires: inOneHour.toISOString() }, marker: "hello", passport } as unknown as SessionData;

  /** host_entity_id values of session logs for a sid. */
  async function hostsFor(sid: string): Promise<Record<string, string | null>> {
    const res = await db.execute(sql`
      SELECT description, host_entity_id FROM winston_logs
      WHERE module = 'sessions' AND entity_id = ${sid} ORDER BY timestamp ASC
    `);
    return Object.fromEntries((res.rows as any[]).map((r) => [String(r.description), r.host_entity_id ?? null]));
  }

  // create
  await call<void>((cb) => store.set(sid, sess, cb));
  const got = await call<SessionData | null>((cb) => store.get(sid, cb));
  check("set + get round-trips", (got as any)?.marker === "hello");

  // upsert created-flag semantics
  const again = await storage.sessions.upsertSession(sid, { ...(sess as any), marker: "hello2" }, inOneHour);
  check("second upsert reports created=false", again.created === false);

  // touch
  const later = new Date(Date.now() + 7200_000);
  const sess2 = { ...(sess as any), cookie: { ...(sess as any).cookie, expires: later.toISOString() } } as SessionData;
  await call<void>((cb) => store.touch(sid, sess2, cb));
  const active = await storage.sessions.getSessions();
  const mine = active.find((s) => s.sid === sid);
  check("touch rolls expiry forward", !!mine && Math.abs(mine.expire.getTime() - later.getTime()) < 2000, { expire: mine?.expire });

  // logging: exactly one creation entry, nothing from same-owner re-save/touch
  const createLogs = await logsFor(sid, 1);
  check("exactly one 'Created session ... for user' log after set+resave+touch",
    createLogs.filter((d) => d.startsWith("Created session") && d.includes(`for user ${fakeUserId}`)).length === 1
      && createLogs.length === 1,
    createLogs);

  // redaction: the persisted log entry must not contain the session payload
  const metaRes = await db.execute(sql`
    SELECT meta FROM winston_logs WHERE module = 'sessions' AND entity_id = ${sid}
  `);
  const metaStr = JSON.stringify((metaRes.rows as any[]).map((r) => r.meta));
  check("session payload redacted from log meta",
    !metaStr.includes("hello") && metaStr.includes("redacted"));

  // expired session invisible + per-session prune with reason
  // attribution: created entry lands on the session owner's account log
  const createdHosts = await hostsFor(sid);
  check("created log attributed to session owner (dbUser.id wins)",
    Object.values(createdHosts)[0] === fakeUserId, createdHosts);

  const sidExpired = `${sid}-expired`;
  await storage.sessions.upsertSession(sidExpired, { cookie: {}, passport }, new Date(Date.now() - 1000));
  const gotExpired = await call<SessionData | null>((cb) => store.get(sidExpired, cb));
  check("expired session not returned by get", gotExpired == null);

  const expiredSids = await storage.sessions.getExpiredSessionSids();
  check("expired sid listed for prune", expiredSids.includes(sidExpired));

  // regression: a session renewed AFTER the candidate scan must survive
  const sidRenewed = `${sid}-renewed`;
  await storage.sessions.upsertSession(sidRenewed, { cookie: {} }, new Date(Date.now() - 1000));
  const candidates = await storage.sessions.getExpiredSessionSids();
  check("renewed-candidate listed while expired", candidates.includes(sidRenewed));
  await storage.sessions.touchSession(sidRenewed, new Date(Date.now() + 3600_000)); // renewed between scan and delete
  for (const s of candidates) {
    await storage.sessions.deleteExpiredSession(s);
  }
  const renewedStill = await storage.sessions.getSessionData(sidRenewed);
  check("renewed session survives prune race", renewedStill !== undefined);
  await storage.sessions.deleteSession(sidRenewed); // cleanup

  const goneRow = await storage.sessions.getSessionData(sidExpired);
  check("expired row gone after prune", goneRow === undefined);
  const expiredLogs = await logsFor(sidExpired, 2);
  check("expired session has created + expired-delete logs",
    expiredLogs.some((d) => d.startsWith("Created session")) &&
    expiredLogs.some((d) => d.startsWith("Deleted session") && d.includes("(expired)")),
    expiredLogs);
  const expiredHosts = await hostsFor(sidExpired);
  check("expired-delete log attributed to session owner (cron path, no request context)",
    Object.entries(expiredHosts).every(([, h]) => h === fakeUserId), expiredHosts);

  // pre-auth (anonymous) session: no fabricated attribution
  const sidAnon = `${sid}-anon`;
  await storage.sessions.upsertSession(sidAnon, { cookie: {} }, new Date(Date.now() + 60_000));
  const anonLogs = await logsFor(sidAnon, 1);
  const anonHosts = await hostsFor(sidAnon);
  check("anonymous session created log stays unattributed",
    anonLogs.length === 1 && Object.values(anonHosts).every((h) => h == null), anonHosts);
  await storage.sessions.deleteSession(sidAnon); // cleanup

  // claims-only session (external provider subject, no resolved dbUser):
  // must NOT be attributed — claims.sub is not an internal account id
  const sidClaims = `${sid}-claims`;
  await storage.sessions.upsertSession(
    sidClaims,
    { cookie: {}, passport: { user: { claims: { sub: "external-subject-999" } } } },
    new Date(Date.now() + 60_000),
  );
  await storage.sessions.deleteSession(sidClaims, "logout");
  const claimsLogs = await logsFor(sidClaims, 2);
  const claimsHosts = await hostsFor(sidClaims);
  check("claims-only session logs stay unattributed (no claims.sub fallback)",
    claimsLogs.length === 2 && Object.values(claimsHosts).every((h) => h == null), claimsHosts);

  // owner transitions: NONE→user (login into existing session), user→user
  // (anomalous swap), user→NONE (logout strip) — each logged + attributed
  const sidTrans = `${sid}-trans`;
  const inAMinute = new Date(Date.now() + 60_000);
  const otherUserId = `${fakeUserId}-other`;
  await storage.sessions.upsertSession(sidTrans, { cookie: {} }, inAMinute); // created, anonymous
  await storage.sessions.upsertSession(sidTrans, { cookie: {}, passport }, inAMinute); // NONE→user
  await storage.sessions.upsertSession(sidTrans, { cookie: {}, passport }, inAMinute); // same owner: silent
  await storage.sessions.upsertSession(sidTrans, { cookie: {}, passport: { user: { dbUser: { id: otherUserId } } } }, inAMinute); // user→user
  await storage.sessions.upsertSession(sidTrans, { cookie: {} }, inAMinute); // user→NONE (logout strip)
  const transLogs = await logsFor(sidTrans, 4);
  const transHosts = await hostsFor(sidTrans);
  check("owner transitions each logged exactly once (create, NONE→user, user→user, user→NONE)",
    transLogs.length === 4 &&
    transLogs[0] === `Created session ${sidTrans.substring(0, 8)}...` &&
    transLogs[1].includes(`from NONE to ${fakeUserId}`) &&
    transLogs[2].includes(`from ${fakeUserId} to ${otherUserId}`) &&
    transLogs[3].includes(`from ${otherUserId} to NONE`),
    transLogs);
  check("transition attribution: new owner, departing owner on →NONE, anonymous create unattributed",
    transHosts[transLogs[0]] === null &&
    transHosts[transLogs[1]] === fakeUserId &&
    transHosts[transLogs[2]] === otherUserId &&
    transHosts[transLogs[3]] === otherUserId,
    transHosts);
  await storage.sessions.deleteSession(sidTrans); // cleanup

  // concurrency: parallel owner-flipping upserts must produce a consistent
  // transition chain (each entry's old owner = previous entry's new owner) —
  // the FOR UPDATE capture serializes ownership reads with the overwrite
  const sidConc = `${sid}-conc`;
  const owners = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? `${fakeUserId}-a` : `${fakeUserId}-b`));
  await Promise.all(owners.map((o) =>
    storage.sessions.upsertSession(sidConc, { cookie: {}, passport: { user: { dbUser: { id: o } } } }, inAMinute)));
  await sleep(1500); // let deferred log writes flush
  const concRes = await db.execute(sql`
    SELECT meta #>> '{meta,after,metadata,oldUserId}' AS old_id, meta #>> '{meta,after,metadata,newUserId}' AS new_id
    FROM winston_logs WHERE module = 'sessions' AND entity_id = ${sidConc} ORDER BY timestamp ASC, id ASC
  `);
  // log rows may flush out of order (deferred writes), so reconstruct the
  // chain from the edges instead of trusting insert order: exactly one
  // "create" edge (old=NONE), and the edges must link into a single path.
  const edges = (concRes.rows as any[]).map((c) => ({ old: c.old_id ?? null, next: c.new_id ?? null }));
  const starts = edges.filter((e) => e.old === null);
  let chainOk = starts.length === 1 && edges.length >= 2;
  if (chainOk) {
    const pool = edges.filter((e) => e.old !== null);
    let cursor = starts[0].next;
    while (pool.length > 0) {
      const i = pool.findIndex((e) => e.old === cursor);
      if (i === -1) { chainOk = false; break; }
      cursor = pool[i].next;
      pool.splice(i, 1);
    }
  }
  check("concurrent upserts form a consistent ownership chain", chainOk,
    edges.map((e) => `${e.old ?? "NONE"}->${e.next ?? "NONE"}`));
  await storage.sessions.deleteSession(sidConc); // cleanup

  // real logout order: passport strips owner (attributed change), then
  // destroy deletes an ownerless row (pure delete, unattributed)
  const sidLogout = `${sid}-logout`;
  await storage.sessions.upsertSession(sidLogout, { cookie: {}, passport }, inAMinute);
  await storage.sessions.upsertSession(sidLogout, { cookie: {} }, inAMinute); // req.logout() save
  await call<void>((cb) => store.destroy(sidLogout, cb));
  const logoutLogs = await logsFor(sidLogout, 3);
  const logoutHosts = await hostsFor(sidLogout);
  check("logout flow: created + owner→NONE + delete entries",
    logoutLogs.length === 3 &&
    logoutLogs[1].includes(`from ${fakeUserId} to NONE`) &&
    logoutLogs[2].startsWith("Deleted session") && logoutLogs[2].includes("(logout)"),
    logoutLogs);
  check("logout attribution: owner-change attributed to departing user, stripped delete unattributed",
    logoutHosts[logoutLogs[1]] === fakeUserId && logoutHosts[logoutLogs[2]] === null,
    logoutHosts);

  // destroy (logout) log
  await call<void>((cb) => store.destroy(sid, cb));
  const gone = await call<SessionData | null>((cb) => store.get(sid, cb));
  check("destroy removes session", gone == null);
  const finalLogs = await logsFor(sid, 2);
  check("logout delete logged with reason",
    finalLogs.some((d) => d.startsWith("Deleted session") && d.includes("(logout)")),
    finalLogs);
  const finalHosts = await hostsFor(sid);
  check("logout delete log attributed to session owner",
    Object.entries(finalHosts).filter(([d]) => d.startsWith("Deleted")).every(([, h]) => h === fakeUserId),
    finalHosts);

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
