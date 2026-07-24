import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Owns the SQLite connection shared by the Session catalog and Tape.
 * Consumers get query/transaction primitives, never the raw database.
 */
export class SessionStorage {
  private readonly db: Database.Database;
  private closed = false;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    if (dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("synchronous = NORMAL");
    }
  }

  prepare<BindParameters extends unknown[] = unknown[], Result = unknown>(
    source: string,
  ): Database.Statement<BindParameters, Result> {
    this.assertOpen();
    return this.db.prepare<BindParameters, Result>(source) as Database.Statement<
      BindParameters,
      Result
    >;
  }

  exec(source: string): void {
    this.assertOpen();
    this.db.exec(source);
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    return this.db.transaction(fn)();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("session storage is closed");
  }
}
