export type ProviderErrorCategory =
  | "aborted"
  | "authentication"
  | "context_overflow"
  | "invalid_request"
  | "malformed_response"
  | "network"
  | "permission"
  | "quota"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "unsupported"
  | "unknown";

export interface ProviderErrorOptions {
  readonly category: ProviderErrorCategory;
  readonly provider: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly status?: number | undefined;
  readonly code?: string | undefined;
  readonly requestId?: string | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly cause?: unknown;
}

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly provider: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(options: ProviderErrorOptions) {
    super(sanitizeMessage(options.message), { cause: options.cause });
    this.name = "ProviderError";
    this.category = options.category;
    this.provider = options.provider;
    this.retryable = options.retryable;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    if (options.requestId !== undefined) this.requestId = options.requestId;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }

  toJSON(): Record<string, boolean | number | string> {
    const result: Record<string, boolean | number | string> = {
      category: this.category,
      message: this.message,
      name: this.name,
      provider: this.provider,
      retryable: this.retryable,
    };
    if (this.status !== undefined) result.status = this.status;
    if (this.code !== undefined) result.code = this.code;
    if (this.requestId !== undefined) result.requestId = this.requestId;
    if (this.retryAfterMs !== undefined) result.retryAfterMs = this.retryAfterMs;
    return result;
  }
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

export function sanitizeMessage(value: string): string {
  return [...value.slice(0, MAX_ERROR_MESSAGE_LENGTH)]
    .map((character) => {
      const code = character.charCodeAt(0);
      const disallowed = (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
      return disallowed ? " " : character;
    })
    .join("");
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}
