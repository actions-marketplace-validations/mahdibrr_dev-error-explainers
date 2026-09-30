// Type declarations for dev-error-explainers/npm-eresolve-explainer

/** Dependency edge type as npm prints it; `'prod'` when npm prints no type. */
export type EdgeType = 'prod' | 'peer' | 'peerOptional' | 'dev' | 'optional' | 'workspace';

export type EresolveHeader =
  | 'unable to resolve dependency tree'
  | 'could not resolve'
  | 'overriding peer dependency';

/** Which side of the range the installed version sits on. */
export type Direction = 'below' | 'above' | 'mixed' | 'prerelease';

export type FixId =
  | 'older-dependent'
  | 'upgrade'
  | 'align'
  | 'overrides'
  | 'no-strict-peer-deps'
  | 'legacy-peer-deps'
  | 'force';

export type FixRank = 'best' | 'alternative' | 'workaround' | 'config' | 'last-resort' | 'avoid';

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Numeric identifiers are numbers. Empty for a release version. */
  prerelease: Array<string | number>;
}

export interface Comparator {
  op: '<' | '<=' | '>' | '>=' | '=';
  version: SemVer;
  text: string;
}

export interface AnyComparator {
  any: true;
  text: '*';
}

export interface ComparatorSet {
  text: string;
  comparators: Array<Comparator | AnyComparator>;
}

export type ParsedRange =
  | { valid: true; raw: string; sets: ComparatorSet[] }
  | { valid: false; raw: string; reason: 'not-a-range' };

export interface SatisfiesSet {
  /** The alternative as written. */
  text: string;
  /** Its primitive comparators, e.g. `>=18.0.0 <19.0.0-0`. */
  desugared: string;
  /** Comparators the version fails. */
  failed: string[];
  /** Only the prerelease rule excludes the version. */
  prereleaseBlocked: boolean;
  direction: Direction | null;
  ok: boolean;
}

export interface SatisfiesResult {
  valid: true;
  satisfied: boolean;
  /** Set only when not satisfied and every alternative agrees on `'below'` or `'above'`. */
  direction: 'below' | 'above' | null;
  /** Normalised version. */
  version: string;
  range: string;
  sets: SatisfiesSet[];
}

export type SatisfiesExplanation =
  | SatisfiesResult
  | { valid: false; reason: 'bad-version'; version: string }
  | { valid: false; reason: 'not-a-range'; range: string };

export interface PackageNode {
  name: string;
  version: string;
  /** npm node flags (`dev`, `peer`, `overridden`…). Absent when the node could not be parsed. */
  flags?: string[];
}

export interface NameVersion {
  name: string;
  version: string;
}

export interface FoundDependent {
  /** `name@version`, or `'the root project'`. */
  from: string;
  spec: string;
  type: EdgeType;
  fromRoot: boolean;
}

export interface EdgeSummary {
  name: string;
  spec: string;
  type: EdgeType;
  /** `name@version`, or `'the root project'`. */
  from: string;
}

export interface ViaEdge {
  name: string;
  version: string;
  peerName: string;
  peerSpec: string;
}

export interface ConflictTarget {
  name: string;
  /** The range npm could not honour. */
  range: string;
  type: EdgeType;
  declaredBy: { root: true } | NameVersion;
}

export interface EresolveFinding {
  id: 'conflict' | 'range' | 'chain' | 'no-root-name';
  severity: 'critical' | 'info';
  title: string;
  body: string;
  /** Primary-source URL. */
  source: string;
}

export interface EresolveFix {
  id: FixId;
  rank: FixRank;
  title: string;
  body: string;
  /** Commands to run. Absent on the `overrides` fix. */
  commands?: string[];
  /** package.json snippet. Only on the `overrides` fix. */
  snippet?: string;
  tradeoff: string;
  /** Primary-source URL. */
  source: string;
  /** Second source URL, on `overrides` and `legacy-peer-deps`. */
  extraSource?: string;
}

/** One analysed ERESOLVE report (a log can contain several). Every string is secret-masked. */
export interface EresolveConflict {
  /** `'warning'` for "overriding peer dependency" (the install carried on). */
  kind: 'error' | 'warning';
  header: EresolveHeader | null;
  /** From "While resolving:". */
  root: PackageNode | null;
  /** From "Found:". */
  found: NameVersion | null;
  foundRequiredBy: FoundDependent[];
  /** The target came from the "Conflicting peer dependency" section. */
  fromConflict: boolean;
  viaEdge: ViaEdge | null;
  conflictingPeer: NameVersion | null;
  unresolvedEdge: EdgeSummary | null;
  target: ConflictTarget;
  /** Version of the target already in the tree, if the log shows it. */
  installed: string | null;
  verdict: SatisfiesExplanation | null;
  chain: EdgeSummary[];
  reachedRoot: boolean;
  directDependency: { name: string; spec: string; type: EdgeType } | null;
  /** The root project depends on the target directly. */
  targetIsDirect: boolean;
  targetRootSpec: string | null;
  targetRootType: EdgeType | null;
  /** The log lists --no-strict-peer-deps (strict-peer-deps is on). */
  strictPeerDeps: boolean;
  findings: EresolveFinding[];
  /** Ranked: best / alternative first, then workaround, config, last-resort, avoid. */
  fixes: EresolveFix[];
}

export interface EresolveAnalysis {
  /** Conflicts were parsed, or the text mentions ERESOLVE. */
  detected: boolean;
  /** The `npm error code …` value, or `null`. */
  code: string | null;
  /** Why no conflict was returned; `undefined` when `conflicts` is non-empty. */
  reason?: 'empty' | 'other-code' | 'unparsed' | 'no-eresolve' | undefined;
  conflicts: EresolveConflict[];
}

export const SOURCES: Readonly<Record<
  | 'explainEresolve' | 'explainDep' | 'placeDep' | 'buildIdealTree' | 'semver' | 'peerDependencies'
  | 'overrides' | 'overridesRelease' | 'legacyPeerDeps' | 'force' | 'strictPeerDeps' | 'npmView'
  | 'npmExplain' | 'npmInstall' | 'npmrc',
  string
>>;
/** A real React 19 ERESOLVE log. */
export const EXAMPLE_LOG: string;

/** Mask npm/GitHub/GitLab tokens, _auth/_password, bearer credentials, URL userinfo. `null`/`undefined` → `''`. */
export function maskSecrets(value: unknown): string;
/** Strict `major.minor.patch[-pre][+build]`; `null` otherwise. */
export function parseVersion(input: string | null | undefined): SemVer | null;
export function formatVersion(v: SemVer): string;
/** SemVer 2.0.0 precedence. Takes PARSED versions (use `parseVersion` first). */
export function compareVersions(a: SemVer, b: SemVer): number;
/** Parse a node-semver range; dist-tags, aliases, URLs and paths are `{ valid: false }`. */
export function parseRange(input: string | null | undefined): ParsedRange;
/** Does `version` satisfy `range`, comparator by comparator? */
export function explainSatisfies(versionText: string, rangeText: string): SatisfiesExplanation;
/** A release version satisfying both ranges, `null` when disjoint, `undefined` when either is not a semver range. */
export function rangesIntersect(aText: string, bText: string): string | null | undefined;
/** `null` when the version or the range cannot be parsed. */
export function satisfies(versionText: string, rangeText: string): boolean | null;

/** Explain a pasted npm ERESOLVE log. */
export function analyseEresolveLog(input: string): EresolveAnalysis;
