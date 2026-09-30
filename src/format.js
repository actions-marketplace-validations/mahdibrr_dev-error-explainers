// Internal presentation helpers shared by bin/cli.js and action/index.js.
//
// The ONE normaliser is src/contract.js (`diagnose` / `diagnoseHeaders`): every
// interface (CLI, GitHub Action, MCP server) prints its result. This file adds no
// diagnosis; it only holds what the interfaces need to DISPLAY that result the
// same way. It is not a public entry point (not in package.json "exports").

import { redact } from './redact.js';
import { decode as decodeBuildError } from './build-error-decoder.js';

/** Display label of each module, in `MODULES` order. */
export const MODULE_LABELS = Object.freeze({
  'cors-error-explainer': 'CORS',
  'esm-cjs-explainer': 'ESM / CommonJS',
  'npm-eresolve-explainer': 'npm ERESOLVE',
  'chunk-cache-explainer': 'ChunkLoadError caching',
  'database-url-doctor': 'DATABASE_URL',
  'build-error-decoder': 'Next.js build output',
  'database-connection-explainer': 'Database connection',
});

/**
 * Group contract results by module, modules in order of first appearance,
 * each module's diagnoses in contract order.
 * @returns {{ module: string, label: string, diagnoses: object[] }[]}
 */
export function groupByModule(results) {
  const groups = new Map();
  for (const d of results) {
    if (!groups.has(d.module)) groups.set(d.module, { module: d.module, label: MODULE_LABELS[d.module] || d.module, diagnoses: [] });
    groups.get(d.module).diagnoses.push(d);
  }
  return [...groups.values()];
}

/**
 * The log line each `next-build.*` rule matched, which the Diagnosis shape does
 * not carry: `rule → { lineNo (1-based), line }`. Computed on the REDACTED text
 * (the same text the contract analysed), so an echoed line never carries a
 * secret `redact()` knows. Used to print the evidence line and, in the Action,
 * to anchor file/line annotations.
 *
 * @param {string} text
 * @returns {Map<string, { lineNo: number, line: string }>}
 */
export function buildEvidenceLines(text) {
  const out = new Map();
  if (typeof text !== 'string' || !text.trim()) return out;
  for (const hit of decodeBuildError(redact(text).text.slice(0, 50000))) {
    if (hit.evidence && Number.isInteger(hit.evidence.lineNo)) {
      out.set(`next-build.${hit.id}`, { lineNo: hit.evidence.lineNo, line: hit.evidence.line });
    }
  }
  return out;
}
