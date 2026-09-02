import { type ToolAuditRecord, type ToolAuditSink } from "./types.js";

export class InMemoryToolAuditSink implements ToolAuditSink {
  readonly #records: ToolAuditRecord[] = [];

  async append(record: ToolAuditRecord): Promise<void> {
    this.#records.push(structuredClone(record));
  }

  records(): readonly ToolAuditRecord[] {
    return structuredClone(this.#records);
  }
}
