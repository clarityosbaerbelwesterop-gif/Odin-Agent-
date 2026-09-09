import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { ModelMessage } from "../providers/types.js";
import { hashText, identifier, integer, safeText } from "./safety.js";
import {
  type AgentCheckpoint,
  type ChatConversation,
  ChatError,
  type ChatEvent,
  type ChatTurn,
} from "./types.js";

/** Conversation metadata is a projection companion. M2/M8 still owns mission state. */
export class ChatStore {
  readonly #db: DatabaseSync;
  constructor(path: string) {
    this.#db = new DatabaseSync(path, { defensive: true, timeout: 5000 });
    const existing = this.#db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chat_schema'")
      .get();
    if (existing && this.#db.prepare("SELECT version FROM chat_schema").get()?.version !== 1) {
      this.#db.close();
      throw new ChatError("SCHEMA_VERSION", "Unsupported conversation schema.", 500);
    }
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS chat_schema(version INTEGER NOT NULL);
      INSERT INTO chat_schema SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM chat_schema);
      CREATE TABLE IF NOT EXISTS chat_conversations(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_turns(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
        request_key TEXT NOT NULL, request_hash TEXT NOT NULL, data TEXT NOT NULL, data_hash TEXT NOT NULL,
        UNIQUE(conversation_id, request_key));
      CREATE TABLE IF NOT EXISTS chat_events(cursor INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES chat_conversations(id),
        turn_id TEXT, type TEXT NOT NULL, data TEXT NOT NULL, data_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_events_scope ON chat_events(conversation_id, cursor);
      CREATE TABLE IF NOT EXISTS chat_checkpoints(turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id), data TEXT NOT NULL, data_hash TEXT NOT NULL);
    `);
    const version = this.#db.prepare("SELECT version FROM chat_schema").get();
    if (version?.version !== 1) {
      this.#db.close();
      throw new ChatError("SCHEMA_VERSION", "Unsupported conversation schema.", 500);
    }
  }
  close(): void {
    this.#db.close();
  }
  history(conversationId: string, currentTurn: string): ModelMessage[] {
    const rows = this.#db
      .prepare(
        "SELECT type,data,data_hash FROM chat_events WHERE conversation_id=? AND turn_id<>? AND type IN ('message.user','answer') ORDER BY cursor DESC LIMIT 12",
      )
      .all(conversationId, currentTurn);
    return rows.reverse().map((row) => ({
      role: row.type === "answer" ? "assistant" : "user",
      content: [
        { type: "text", text: String(decode<Record<string, unknown>>(row).text).slice(0, 2000) },
      ],
    }));
  }
  createConversation(title: string): ChatConversation {
    if (this.conversations().length >= 1000)
      throw new ChatError("STORAGE_LIMIT", "Conversation limit reached.", 409);
    const conversation = {
      id: randomUUID(),
      title: safeText(title, 160).trim() || "New conversation",
      createdAt: new Date().toISOString(),
    };
    this.#db
      .prepare("INSERT INTO chat_conversations VALUES (?, ?, ?)")
      .run(conversation.id, conversation.title, conversation.createdAt);
    return conversation;
  }
  conversations(): ChatConversation[] {
    return this.#db
      .prepare(
        "SELECT id, title, created_at AS createdAt FROM chat_conversations ORDER BY created_at DESC, id LIMIT 1000",
      )
      .all() as unknown as ChatConversation[];
  }
  conversation(id: string): ChatConversation {
    identifier(id);
    const row = this.#db
      .prepare("SELECT id, title, created_at AS createdAt FROM chat_conversations WHERE id=?")
      .get(id);
    if (!row) throw new ChatError("NOT_FOUND", "Conversation not found.", 404);
    return row as unknown as ChatConversation;
  }
  replay(conversationId: string, key: string, requestHash: string): ChatTurn | null {
    const row = this.#db
      .prepare("SELECT * FROM chat_turns WHERE conversation_id=? AND request_key=?")
      .get(conversationId, identifier(key));
    if (!row) return null;
    if (row.request_hash !== requestHash)
      throw new ChatError(
        "IDEMPOTENCY_CONFLICT",
        "This request key was already used for different content.",
        409,
      );
    return decode<ChatTurn>(row);
  }
  addTurn(turn: ChatTurn, key: string, requestHash: string): void {
    this.conversation(turn.conversationId);
    if (this.turns(turn.conversationId).length >= 1000)
      throw new ChatError("STORAGE_LIMIT", "Start a new conversation.", 409);
    const data = safeText(JSON.stringify(turn), 40_000);
    this.#db
      .prepare("INSERT INTO chat_turns VALUES (?, ?, ?, ?, ?, ?)")
      .run(turn.id, turn.conversationId, identifier(key), requestHash, data, hashText(data));
  }
  turn(id: string): ChatTurn {
    const row = this.#db
      .prepare("SELECT data, data_hash FROM chat_turns WHERE id=?")
      .get(identifier(id));
    if (!row) throw new ChatError("NOT_FOUND", "Task not found.", 404);
    return decode<ChatTurn>(row);
  }
  turns(conversationId?: string): ChatTurn[] {
    const rows =
      conversationId === undefined
        ? this.#db.prepare("SELECT data, data_hash FROM chat_turns ORDER BY rowid").all()
        : this.#db
            .prepare(
              "SELECT data, data_hash FROM chat_turns WHERE conversation_id=? ORDER BY rowid",
            )
            .all(conversationId);
    return rows.map((row) => decode<ChatTurn>(row));
  }
  emit(turn: ChatTurn, type: string, data: Record<string, unknown>): ChatEvent {
    if (!/^[a-z_.]{1,50}$/u.test(type)) throw new ChatError("INVALID_EVENT", "Invalid event type.");
    const count = this.#db
      .prepare("SELECT COUNT(*) AS n FROM chat_events WHERE conversation_id=?")
      .get(turn.conversationId);
    if (Number(count?.n) >= 100_000)
      throw new ChatError("STORAGE_LIMIT", "Conversation event limit reached.", 409);
    const encoded = safeText(JSON.stringify(data), 300_000);
    const createdAt = new Date().toISOString();
    const result = this.#db
      .prepare(
        "INSERT INTO chat_events(conversation_id,turn_id,type,data,data_hash,created_at) VALUES(?,?,?,?,?,?)",
      )
      .run(turn.conversationId, turn.id, type, encoded, hashText(encoded), createdAt);
    return {
      cursor: Number(result.lastInsertRowid),
      conversationId: turn.conversationId,
      turnId: turn.id,
      type,
      data: JSON.parse(encoded),
      createdAt,
    };
  }
  events(conversationId: string, after = 0, limit = 200): ChatEvent[] {
    this.conversation(conversationId);
    integer(after, 0, Number.MAX_SAFE_INTEGER);
    integer(limit, 1, 1000);
    return this.#db
      .prepare(
        "SELECT * FROM chat_events WHERE conversation_id=? AND cursor>? ORDER BY cursor LIMIT ?",
      )
      .all(conversationId, after, limit)
      .map((row) => ({
        cursor: Number(row.cursor),
        conversationId: String(row.conversation_id),
        turnId: row.turn_id === null ? null : String(row.turn_id),
        type: String(row.type),
        data: decode<Record<string, unknown>>(row),
        createdAt: String(row.created_at),
      }));
  }
  checkpoint(turnId: string): AgentCheckpoint | null {
    const row = this.#db
      .prepare("SELECT data, data_hash FROM chat_checkpoints WHERE turn_id=?")
      .get(turnId);
    return row ? decode<AgentCheckpoint>(row) : null;
  }
  save(turnId: string, state: AgentCheckpoint): void {
    const data = safeText(JSON.stringify(state), 2_000_000);
    this.#db
      .prepare(
        "INSERT INTO chat_checkpoints VALUES(?,?,?) ON CONFLICT(turn_id) DO UPDATE SET data=excluded.data,data_hash=excluded.data_hash",
      )
      .run(turnId, data, hashText(data));
  }
}

function decode<T>(row: Record<string, unknown>): T {
  if (typeof row.data !== "string" || hashText(row.data) !== row.data_hash) {
    throw new ChatError(
      "INTEGRITY_FAILURE",
      "Stored conversation data failed integrity verification.",
      500,
    );
  }
  return JSON.parse(row.data) as T;
}
