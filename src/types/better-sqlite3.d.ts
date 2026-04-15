declare module 'better-sqlite3' {
  export type RunResult = { changes: number; lastInsertRowid: number | bigint };

  export interface Statement {
    run(...params: unknown[]): RunResult;
    run(params: unknown): RunResult;
    get(...params: unknown[]): unknown;
    get(params: unknown): unknown;
    all(...params: unknown[]): unknown[];
    all(params: unknown): unknown[];
  }

  export interface Transaction<T extends (...args: never[]) => unknown> {
    (...args: Parameters<T>): ReturnType<T>;
  }

  export interface Database {
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): Transaction<T>;
    close(): void;
  }

  export default class BetterSqlite3Database implements Database {
    constructor(filename: string);
    pragma(source: string): unknown;
    exec(source: string): this;
    prepare(source: string): Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): Transaction<T>;
    close(): void;
  }
}
