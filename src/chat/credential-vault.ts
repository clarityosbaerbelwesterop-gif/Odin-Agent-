import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ChatError } from "./types.js";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_SECRET_BYTES = 16_000;

function decodeKey(value: string): Buffer {
  if (!value || /[\r\n]/u.test(value))
    throw new ChatError("CREDENTIAL_VAULT_CONFIG", "Credential vault is not configured.", 503);
  let key: Buffer;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    throw new ChatError("CREDENTIAL_VAULT_CONFIG", "Credential vault is not configured.", 503);
  }
  if (key.length !== 32)
    throw new ChatError("CREDENTIAL_VAULT_CONFIG", "Credential vault is not configured.", 503);
  return key;
}

function normalizeSecret(value: string): string {
  if (typeof value !== "string" || value.trim() === "" || /[\r\n]/u.test(value))
    throw new ChatError("INVALID_CREDENTIAL", "Enter a valid provider credential.");
  const cleaned = value.trim();
  const bytes = Buffer.byteLength(cleaned);
  if (bytes < 8 || bytes > MAX_SECRET_BYTES)
    throw new ChatError("INVALID_CREDENTIAL", "Enter a valid provider credential.");
  return cleaned;
}

export class CredentialVault {
  readonly #key: Buffer;

  constructor(encodedKey: string) {
    this.#key = decodeKey(encodedKey);
  }

  seal(value: string): { ciphertext: string; fingerprint: string } {
    const secret = normalizeSecret(value);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: [VERSION, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join("."),
      fingerprint: createHash("sha256").update(secret).digest("hex"),
    };
  }

  open(value: string): string {
    const parts = value.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION)
      throw new ChatError("CREDENTIAL_CORRUPT", "Stored credential cannot be decrypted.", 500);
    const iv = Buffer.from(parts[1] ?? "", "base64url");
    const tag = Buffer.from(parts[2] ?? "", "base64url");
    const encrypted = Buffer.from(parts[3] ?? "", "base64url");
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || encrypted.length === 0)
      throw new ChatError("CREDENTIAL_CORRUPT", "Stored credential cannot be decrypted.", 500);
    try {
      const decipher = createDecipheriv(ALGORITHM, this.#key, iv, { authTagLength: TAG_BYTES });
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      return normalizeSecret(plain);
    } catch {
      throw new ChatError("CREDENTIAL_CORRUPT", "Stored credential cannot be decrypted.", 500);
    }
  }

  matchesFingerprint(value: string, fingerprint: string): boolean {
    const actual = Buffer.from(createHash("sha256").update(normalizeSecret(value)).digest("hex"));
    const expected = Buffer.from(fingerprint);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

export function credentialVaultFromEnvironment(env: NodeJS.ProcessEnv = process.env): CredentialVault {
  return new CredentialVault(env.ODIN_CREDENTIAL_ENCRYPTION_KEY ?? "");
}
