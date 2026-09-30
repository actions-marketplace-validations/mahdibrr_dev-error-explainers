// Type declarations for dev-error-explainers/contract — the normalised result
// shared by the CLI (--json), the GitHub Action, the MCP server and the web page.
// Full description: docs/CONTRACT.md.

import type { DatabaseClient } from './database-url-doctor.js';

export type Family = 'cors' | 'esm-cjs' | 'npm-eresolve' | 'chunk-cache' | 'database-url' | 'next-build' | 'database-connection';

export type ModuleName =
  | 'cors-error-explainer'
  | 'esm-cjs-explainer'
  | 'npm-eresolve-explainer'
  | 'chunk-cache-explainer'
  | 'database-url-doctor'
  | 'build-error-decoder'
  | 'database-connection-explainer';

export type Severity = 'critical' | 'warning' | 'info';

/**
 * `'high'`: the rule keys on an explicit signal (exact error code or message,
 * parsed header / URL value). `'medium'`: a looser pattern, a generic fallback,
 * or a finding the module words as "check whether…". Static per rule.
 */
export type Confidence = 'high' | 'medium';

/** Rule-id prefix of each family (`esm-cjs` → `esm`). */
export type RulePrefix = 'cors' | 'esm' | 'npm-eresolve' | 'chunk-cache' | 'database-url' | 'next-build' | 'database-connection';

/** `<prefix>.<native id>`, e.g. `'esm.require-esm'`. Every id is listed in `RULES`. */
export type RuleId = `${RulePrefix}.${string}`;

export interface DiagnosisFix {
  title: string;
  detail?: string;
  /** Code, config or shell snippet. */
  code?: string;
}

export interface Evidence {
  /**
   * Absolute https URL. A primary source (spec, vendor docs, browser / Node.js /
   * npm source) for cors, esm-cjs, npm-eresolve and chunk-cache; for next-build
   * (and some database-url rules) an article on iloveblogs.blog.
   */
  url: string;
  label: string;
}

export interface Diagnosis {
  /** Stable id. Never changes between runs; renamed only with a contract version bump. */
  rule: RuleId;
  family: Family;
  /** The module's title; may quote (redacted) values from the paste. */
  title: string;
  severity: Severity;
  confidence: Confidence;
  cause: string;
  /** Only when the module separates "why" from "cause". */
  why?: string;
  /** Ranked by the module, least invasive / best first. */
  fixes: DiagnosisFix[];
  evidence: Evidence[];
  module: ModuleName;
}

export interface ContractResult {
  version: '0.1';
  /** `results.length > 0`. */
  matched: boolean;
  /** Number of values `redact()` masked in the input. */
  redactions: number;
  /** Severity first, then family order (`FAMILIES`), then the module's own order. */
  results: Diagnosis[];
}

export interface ContractOptions {
  /** Node.js version for the esm-cjs explainer (`'22.12.0'`, `'v20'`…). */
  nodeVersion?: string | undefined;
  /** Database client for the database-url doctor. Default `'prisma'`. */
  client?: DatabaseClient | undefined;
  /** Run only these families. Unknown names are ignored. */
  only?: Family | readonly Family[] | undefined;
}

/** One row of the rule catalogue. */
export interface RuleInfo {
  readonly rule: RuleId;
  readonly family: Family;
  readonly module: ModuleName;
  /** Static title (no pasted values). */
  readonly title: string;
  readonly confidence: Confidence;
}

export const CONTRACT_VERSION: '0.1';
/** Families in reporting order (same order as `MODULES`). */
export const FAMILIES: readonly Family[];
/** Every rule id the contract can emit. */
export const RULES: readonly RuleInfo[];

/**
 * Redact the text, run every module's own recogniser, and map the findings to
 * `Diagnosis`. Unknown, empty or non-string input →
 * `{ version: '0.1', matched: false, redactions: 0, results: [] }` — never a guess.
 */
export function diagnose(text: string, options?: ContractOptions): ContractResult;

/** Input of `diagnoseHeaders`: the `curl -sI` output of the HTML page and of a failing chunk. */
export interface HeadersInput {
  htmlHeaders?: string | undefined;
  chunkHeaders?: string | undefined;
}

/**
 * The chunk-cache explainer with BOTH header dumps (a single paste can only be
 * one of them). Same envelope as `diagnose`; only `chunk-cache` results. Both
 * dumps are redacted first; `redactions` is the sum.
 */
export function diagnoseHeaders(input?: HeadersInput | null): ContractResult;
