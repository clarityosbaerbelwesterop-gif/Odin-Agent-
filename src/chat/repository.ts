import type { CompiledContext } from "../context/types.js";
import type { ChatStore } from "./store.js";

/** Local SQLite and remote Postgres implement the same awaited storage boundary. */
export type ChatRepository = {
  [K in keyof ChatStore]: ChatStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<R>
    : never;
} & {
  /** Hosted PRODUCT M2 adapter into the canonical M6 context compiler. */
  workspaceContext?: (conversationId: string, missionId: string) => Promise<CompiledContext | null>;
};
