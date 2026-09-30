// Type declarations for dev-error-explainers/build-error-decoder

export type Severity = 'critical' | 'warning' | 'info';

export type BuildRuleId =
  | 'suspense-searchparams'
  | 'chunk-load-error'
  | 'dynamic-server-usage'
  | 'window-undefined'
  | 'module-not-found'
  | 'tsconfig-paths'
  | 'heap-oom'
  | 'hydration-mismatch'
  | 'turbopack-stuck'
  | 'port-in-use'
  | 'env-undefined'
  | 'next-babel'
  | 'image-hostname'
  | 'next-lint-removed';

/** A link to a deeper article (site-relative path such as `/post/...`). */
export interface BuildRuleLink {
  href: string;
  label: string;
}

/** One known `next build` / `next dev` failure signature. */
export interface BuildRule {
  id: BuildRuleId;
  /** Human label of the error signature. */
  signature: string;
  /** Realistic excerpt of the real message, or `null` when the wording varies too much to quote. */
  sample: string | null;
  pattern: RegExp;
  severity: Severity;
  title: string;
  body: string;
  /** Fix snippet (code or shell). */
  fix: string;
  link: BuildRuleLink;
}

/** The line of the pasted output that triggered a rule (1-based `lineNo`). */
export interface Evidence {
  lineNo: number;
  line: string;
}

/** A rule that matched, with the line that triggered it. */
export interface DecodedBuildError extends BuildRule {
  /** `null` when the pattern only matches across several lines. */
  evidence: Evidence | null;
}

export interface BuildErrorExample {
  id: BuildRuleId;
  label: string;
  output: string;
}

export interface SeverityStyle {
  label: string;
  /** CSS utility classes used by the original UI. */
  cls: string;
}

export const SEVERITY: Readonly<Record<Severity, SeverityStyle>>;
export const SEVERITY_ORDER: Readonly<Record<Severity, number>>;
export const RULES: readonly BuildRule[];
/** Rules that carry a one-click sample. */
export const EXAMPLES: readonly BuildErrorExample[];

/** First line of `output` matched by `pattern`, or `null` (multi-line-only matches). */
export function findEvidence(pattern: RegExp, output: string): Evidence | null;

/**
 * Decode pasted build output into matched rules, most severe first.
 * Empty or non-string input returns `[]`.
 */
export function decode(output: string): DecodedBuildError[];
