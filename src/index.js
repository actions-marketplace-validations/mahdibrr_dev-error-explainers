// dev-error-explainers — convenience entry point.
//
// Re-exports the main function of each explainer under a distinct name, plus
// `detect(text)`, which tells you which explainer(s) recognise a pasted text.
// Every module stays importable on its own (`dev-error-explainers/<module>`);
// this file adds no logic of its own beyond `detect`.

import { diagnose as diagnoseCors } from './cors-error-explainer.js';
import { explain as explainEsmCjs } from './esm-cjs-explainer.js';
import { analyseEresolveLog } from './npm-eresolve-explainer.js';
import {
  diagnose as diagnoseChunkCache,
  parseResponseHeaders,
  finalResponse,
} from './chunk-cache-explainer.js';
import { diagnose as diagnoseDatabaseUrl, parseConnectionString } from './database-url-doctor.js';
import { decode as decodeBuildError } from './build-error-decoder.js';
import { explain as explainDatabaseConnection } from './database-connection-explainer.js';

export {
  diagnoseCors,
  explainEsmCjs,
  analyseEresolveLog,
  diagnoseChunkCache,
  diagnoseDatabaseUrl,
  decodeBuildError,
  explainDatabaseConnection,
};

/** Module names, in the order `detect` reports them. */
export const MODULES = [
  'cors-error-explainer',
  'esm-cjs-explainer',
  'npm-eresolve-explainer',
  'chunk-cache-explainer',
  'database-url-doctor',
  'build-error-decoder',
  'database-connection-explainer',
];

/**
 * Which explainer(s) recognise this text?
 *
 * Deterministic: each module is asked through its OWN recogniser — no extra
 * heuristics are added here — and the answer is the list of module names that
 * recognised the text, in `MODULES` order (empty when none does).
 *
 * - `cors-error-explainer`   — `diagnoseCors({ error: text }).recognised`
 * - `esm-cjs-explainer`      — `explainEsmCjs({ error: text })` returns at least one finding
 * - `npm-eresolve-explainer` — `analyseEresolveLog(text).detected`
 * - `chunk-cache-explainer`  — the text parses as HTTP response headers with a
 *   status line (e.g. the output of `curl -I`); this explainer reads headers,
 *   not error messages
 * - `database-url-doctor`    — the whole text (or a `DATABASE_URL=…` line) parses
 *   as a `postgres://` / `postgresql://` URL
 * - `build-error-decoder`    — `decodeBuildError(text)` matches at least one rule
 * - `database-connection-explainer` — `explainDatabaseConnection({ error: text }).recognised`
 *   (generic network / TLS codes only count next to a Postgres signal)
 *
 * Several modules can recognise the same text (a `Module not found` line in a
 * `next build` log, for instance). `detect` never echoes the input back.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function detect(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const input = text.slice(0, 50000);
  const hits = [];
  if (diagnoseCors({ error: input }).recognised) hits.push('cors-error-explainer');
  if (explainEsmCjs({ error: input }).findings.length > 0) hits.push('esm-cjs-explainer');
  if (analyseEresolveLog(input).detected) hits.push('npm-eresolve-explainer');
  const response = finalResponse(parseResponseHeaders(input));
  if (response && response.status !== null && response.status !== undefined) hits.push('chunk-cache-explainer');
  if (parseConnectionString(input).ok) hits.push('database-url-doctor');
  if (decodeBuildError(input).length > 0) hits.push('build-error-decoder');
  if (explainDatabaseConnection({ error: input }).recognised) hits.push('database-connection-explainer');
  return hits;
}

// The normalised result shared by the CLI (--json), the GitHub Action and the
// MCP server (docs/CONTRACT.md), and the redactor it runs first.
export { diagnose, RULES as CONTRACT_RULES, FAMILIES, CONTRACT_VERSION } from './contract.js';
export { redact } from './redact.js';
