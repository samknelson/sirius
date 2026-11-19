import Database from "better-sqlite3";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CoverageBudget } from "./coverage-budget";

/**
 * Private, disposable evidence, never application storage. SQLite is bundled
 * with the native dependency on the deployed Node 20 runtime. No source DB
 * writes, WAL, network service, or persistent coverage denormalization.
 *
 * Slots bound aggregate disk allocation across processes. A slot belongs to a
 * process, not a wizard id supplied by a caller. Only a demonstrably dead PID
 * can be scavenged; unknown ownership fails closed.
 */
const root = join(tmpdir(), "sirius-edi-evidence-v1");
const slots = 4;
const diskBytes = 256 * 1024 * 1024;
const maxValueBytes = 4 * 1024 * 1024;
function dead(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

/** Serialize slot changes to prevent scavengers racing new owners. */
function coordinate<T>(fn: (db: Database.Database) => T) {
  const file = join(root, "slots.sqlite");
  const db = new Database(file, { timeout: 100 });
  chmodSync(file, 0o600);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS slots(directory TEXT PRIMARY KEY, pid INTEGER NOT NULL)");
    return db.transaction(() => fn(db)).immediate();
  } finally { db.close(); }
}

export class CoverageSpill {
  readonly db!: Database.Database;
  readonly directory: string;
  private closed = false;
  private writes = 0;
  private collections = 0;
  constructor(readonly budget: CoverageBudget) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (statSync(root).uid !== process.getuid?.() || (statSync(root).mode & 0o077))
      throw new Error("Coverage staging directory is not private.");
    const directory = coordinate(db => {
      for (const name of readdirSync(root)) {
        const match = /^run-(\d+)-/.exec(name);
        if (match && dead(Number(match[1]))) {
          const path = join(root, name);
          rmSync(path, { recursive: true, force: true });
          db.prepare("DELETE FROM slots WHERE directory=?").run(path);
        }
      }
      const owners = db.prepare("SELECT directory,pid FROM slots").all() as { directory: string; pid: number }[];
      for (const owner of owners) if (dead(owner.pid))
        db.prepare("DELETE FROM slots WHERE directory=?").run(owner.directory);
      const count = (db.prepare("SELECT count(*) AS n FROM slots").get() as { n: number }).n;
      if (count >= slots) throw new Error("Coverage staging capacity is occupied. No partial review was accepted.");
      const path = mkdtempSync(join(root, `run-${process.pid}-`));
      db.prepare("INSERT INTO slots VALUES(?,?)").run(path, process.pid);
      return path;
    });
    this.directory = directory;
    try {
      const file = join(directory, "evidence.sqlite");
      writeFileSync(file, "", { mode: 0o600 });
      chmodSync(directory, 0o700);
      this.db = new Database(file);
      this.db.pragma("journal_mode = OFF");
      this.db.pragma("synchronous = OFF");
      this.db.pragma("temp_store = MEMORY");
      this.db.pragma("cache_size = -4096");
      this.db.pragma("mmap_size = 0");
      this.db.pragma(`max_page_count = ${diskBytes / 4096}`);
      this.db.exec("CREATE TABLE entries (collection INTEGER, key TEXT, value TEXT NOT NULL, PRIMARY KEY(collection,key)) WITHOUT ROWID");
      // This database is disposable and never shared. One transaction avoids
      // a filesystem commit for every index entry; the finite page cache still
      // spills dirty pages. No persistent state relies on committing it.
      this.db.exec("BEGIN");
    } catch (error) {
      this.db?.close();
      rmSync(directory, { recursive: true, force: true });
      coordinate(db => db.prepare("DELETE FROM slots WHERE directory=? AND pid=?").run(directory, process.pid));
      throw error;
    }
  }
  map<T>() { return new SpillMap<T>(this, ++this.collections); }
  check() {
    this.budget.check();
    const pages = Number(this.db.pragma("page_count", { simple: true }));
    this.budget.spill(pages * 4096);
  }
  wrote() {
    if (++this.writes % 500 === 0) this.check();
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    try { this.db.close(); } finally {
      rmSync(this.directory, { recursive: true, force: true });
      coordinate(db => db.prepare("DELETE FROM slots WHERE directory=? AND pid=?").run(this.directory, process.pid));
    }
  }
}

/** Ordered keyset reads, not a cursor held over writes or an all() history read. */
export class SpillMap<T> {
  private count = 0;
  private getStatement;
  private putStatement;
  private deleteStatement;
  private pageStatement;
  private floorStatement;
  constructor(private readonly store: CoverageSpill, private readonly id: number) {
    this.getStatement = store.db.prepare("SELECT value FROM entries WHERE collection=? AND key=?");
    this.putStatement = store.db.prepare("INSERT INTO entries VALUES(?,?,?) ON CONFLICT(collection,key) DO UPDATE SET value=excluded.value");
    this.deleteStatement = store.db.prepare("DELETE FROM entries WHERE collection=? AND key=?");
    this.pageStatement = store.db.prepare("SELECT key FROM entries WHERE collection=? AND key>? ORDER BY key LIMIT 100");
    this.floorStatement = store.db.prepare("SELECT value FROM entries WHERE collection=? AND key<=? ORDER BY key DESC LIMIT 1");
  }
  get size() { return this.count; }
  get(key: string): T | undefined {
    const row = this.getStatement.get(this.id, key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  has(key: string) { return this.getStatement.get(this.id, key) !== undefined; }
  floor(key: string): T | undefined {
    const row = this.floorStatement.get(this.id, key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  set(key: string, value: T) {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) > maxValueBytes)
      throw new Error("Coverage coordinate exceeds safe working-set size. No partial review was accepted.");
    const exists = this.has(key);
    try { this.putStatement.run(this.id, key, json); }
    catch (error) {
      if ((error as { code?: string }).code === "SQLITE_FULL") this.store.budget.refuseStorage();
      throw error;
    }
    if (!exists) { this.count++; this.store.budget.indexEntry(1); }
    this.store.wrote();
    return this;
  }
  delete(key: string) {
    const removed = this.deleteStatement.run(this.id, key).changes > 0;
    if (removed) { this.count--; this.store.budget.indexEntry(-1); }
    return removed;
  }
  *entries(): Generator<[string, T]> {
    let cursor = "";
    for (;;) {
      const page = this.pageStatement.all(this.id, cursor) as { key: string }[];
      if (!page.length) break;
      for (const row of page) {
        const value = this.get(row.key);
        if (value !== undefined) yield [row.key, value];
      }
      cursor = page[page.length - 1].key;
    }
  }
  *keys() { for (const [key] of this.entries()) yield key; }
  *values() { for (const [, value] of this.entries()) yield value; }
  [Symbol.iterator]() { return this.entries(); }
}
