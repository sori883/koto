import { createHash } from "node:crypto";

export class MemoryError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const contentHash = (raw: string) => createHash("sha256").update(raw).digest("hex");

export function checkHash(raw: string | undefined, expected?: string): void {
  if (expected === undefined) return;
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new MemoryError("INVALID_INPUT", "if-hash must be a lowercase SHA-256 digest.");
  if (raw === undefined || contentHash(raw) !== expected) throw new MemoryError("VERSION_CONFLICT", "The concept changed since it was read. Read it again before updating.");
}
