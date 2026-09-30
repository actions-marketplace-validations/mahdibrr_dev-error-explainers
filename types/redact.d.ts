// Type declarations for dev-error-explainers/redact

/** The text written in place of every masked value: `'[REDACTED]'`. */
export const REDACTED: '[REDACTED]';

export interface RedactResult {
  /** The input with every recognised credential replaced by `[REDACTED]`. */
  text: string;
  /** Number of values replaced. `0` when nothing was masked. */
  redactions: number;
}

/**
 * Mask credentials in pasted text: URL userinfo passwords, Authorization /
 * Cookie / Set-Cookie / API-key header values, secret-named `NAME=value`
 * assignments, bearer tokens, JWTs and well-known token prefixes.
 * Idempotent and deterministic. Non-string input → `{ text: '', redactions: 0 }`.
 * What it does not catch is listed in docs/CONTRACT.md.
 */
export function redact(text: string): RedactResult;
