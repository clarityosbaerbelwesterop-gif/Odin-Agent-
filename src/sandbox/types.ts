export type SandboxErrorCode =
  | "BACKEND_INVALID"
  | "BACKEND_NOT_FOUND"
  | "BINDING_NOT_FOUND"
  | "CANCELLED"
  | "COMMAND_INVALID"
  | "COMMAND_NOT_FOUND"
  | "CONCURRENCY_EXCEEDED"
  | "CREDENTIAL_INVALID"
  | "DESTINATION_INVALID"
  | "NETWORK_DENIED"
  | "PATH_ESCAPE"
  | "PATH_INVALID"
  | "PROCESS_SPAWN_FAILED"
  | "SESSION_INVALID";

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly details: readonly string[];

  constructor(code: SandboxErrorCode, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    this.details = Object.freeze([...details]);
  }
}

export interface CanonicalWorkspacePath {
  readonly relativePath: string;
  readonly canonicalPath: string;
}

export type ProcessNetworkMode = "deny" | "policy_required";

export interface SandboxCommandDefinition {
  readonly id: string;
  readonly label: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly fixedEnv: Readonly<Record<string, string>>;
  readonly inheritEnv: readonly string[];
  readonly maxStderrBytes: number;
  readonly maxStdoutBytes: number;
  readonly timeoutMs: number;
  readonly network: ProcessNetworkMode;
}

export type SandboxProcessOutcome =
  | "CANCELLED"
  | "EXITED"
  | "OUTPUT_LIMIT"
  | "SIGNALED"
  | "TIMED_OUT";

export interface SandboxProcessResult {
  readonly commandId: string;
  readonly outcome: SandboxProcessOutcome;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly durationMs: number;
}

export interface SpawnRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly maxStderrBytes: number;
}

export interface ProcessAdapter {
  run(request: SpawnRequest): Promise<Omit<SandboxProcessResult, "commandId">>;
}

export interface HostEnvironment {
  readonly [name: string]: string | undefined;
}

export interface SandboxProcessRunnerOptions {
  readonly maxConcurrent: number;
  readonly hostEnv?: HostEnvironment;
}

export interface DnsResolver {
  resolve(hostname: string): Promise<readonly string[]>;
}

export interface OutboundNetworkPolicyOptions {
  readonly allowedHosts: readonly string[];
  readonly allowedPorts?: readonly number[];
  readonly allowHttp?: boolean;
  readonly resolver: DnsResolver;
}

export interface OutboundNetworkDecision {
  readonly normalizedUrl: string;
  readonly hostname: string;
  readonly port: number;
  readonly addresses: readonly string[];
  readonly resolutionHash: string;
}
