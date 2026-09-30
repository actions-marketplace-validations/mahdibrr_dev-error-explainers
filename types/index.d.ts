// Type declarations for dev-error-explainers (the package root).
// Each module's full types are importable from its subpath, e.g.
// `import type { CorsDiagnosis } from 'dev-error-explainers/cors-error-explainer'`.

export { diagnose as diagnoseCors } from './cors-error-explainer.js';
export { explain as explainEsmCjs } from './esm-cjs-explainer.js';
export { analyseEresolveLog } from './npm-eresolve-explainer.js';
export { diagnose as diagnoseChunkCache } from './chunk-cache-explainer.js';
export { diagnose as diagnoseDatabaseUrl } from './database-url-doctor.js';
export { decode as decodeBuildError } from './build-error-decoder.js';
export { explain as explainDatabaseConnection } from './database-connection-explainer.js';

export type { CorsDiagnosis, CorsInput, CorsFinding } from './cors-error-explainer.js';
export type { EsmCjsExplanation, EsmCjsInput, EsmFinding, EsmFix } from './esm-cjs-explainer.js';
export type { EresolveAnalysis, EresolveConflict, EresolveFix } from './npm-eresolve-explainer.js';
export type { ChunkCacheDiagnosis, ChunkCacheInput, ChunkCacheFinding } from './chunk-cache-explainer.js';
export type { DatabaseUrlDiagnosis, DatabaseUrlFinding, DiagnoseOptions as DatabaseUrlOptions } from './database-url-doctor.js';
export type { DecodedBuildError } from './build-error-decoder.js';
export type {
  DbConnectionExplanation, DbConnectionFinding, DbConnectionInput, DbConnectionFix,
} from './database-connection-explainer.js';

export type ModuleName =
  | 'cors-error-explainer'
  | 'esm-cjs-explainer'
  | 'npm-eresolve-explainer'
  | 'chunk-cache-explainer'
  | 'database-url-doctor'
  | 'build-error-decoder'
  | 'database-connection-explainer';

/** Module names, in the order `detect` reports them. */
export const MODULES: readonly ModuleName[];

/**
 * Which explainer(s) recognise this text? Module names in `MODULES` order;
 * `[]` for empty / non-string input or when none does.
 */
export function detect(text: string): ModuleName[];

// The normalised result shared by the CLI (--json), the GitHub Action and the
// MCP server (docs/CONTRACT.md), and the redactor it runs first.
export { diagnose, RULES as CONTRACT_RULES, FAMILIES, CONTRACT_VERSION } from './contract.js';
export type {
  ContractResult, ContractOptions, Diagnosis, DiagnosisFix, Evidence, Family, RuleId, RuleInfo, Severity, Confidence,
} from './contract.js';
export { redact } from './redact.js';
