import type { ChatStore } from "./store.js";

/** Local SQLite and remote Postgres implement the same awaited storage boundary. */
export type ChatRepository = {
  [K in keyof ChatStore]: ChatStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<R>
    : never;
};
