const OBVIOUS_SECRET =
  /(?:\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{8,}|\bxox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/u;

export function containsObviousSecret(value: string): boolean {
  return OBVIOUS_SECRET.test(value);
}
