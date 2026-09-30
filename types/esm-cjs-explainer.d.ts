// Type declarations for dev-error-explainers/esm-cjs-explainer

export interface Source {
  url: string;
  label: string;
}

export type EsmRuleId =
  | 'require-async-module'
  | 'require-esm'
  | 'import-outside-module'
  | 'cjs-global-in-esm'
  | 'ts-in-node-modules'
  | 'ts-unsupported-syntax'
  | 'unknown-file-extension'
  | 'dir-import'
  | 'module-not-found-extension'
  | 'module-not-found-file'
  | 'package-not-found'
  | 'import-assert'
  | 'import-attribute-missing'
  | 'package-path-not-exported';

export type FeatureName =
  | 'requireEsmDefault'
  | 'requireEsmFlag'
  | 'syntaxDetection'
  | 'stripTypesFlag'
  | 'stripTypesDefault'
  | 'transformTypesFlag'
  | 'assertRemoved'
  | 'importAttributes'
  | 'importMetaDirname';

/** A fix, ranked least invasive first within a finding. */
export interface EsmFix {
  title: string;
  detail: string;
  /** Code or shell snippet (secrets masked). */
  code: string;
}

export interface EsmFinding {
  id: EsmRuleId;
  title: string;
  cause: string;
  why: string;
  fixes: EsmFix[];
  source: Source;
  /** A second supporting source, on some findings only. */
  extraSource?: Source;
}

export interface EsmContext {
  /** `major.minor.patch` actually used for the advice, or `null` when unknown. */
  nodeVersion: string | null;
  /** `'error'`: read from the "Node.js vX.Y.Z" line of the error; `'input'`: from `nodeVersion`. */
  versionSource: 'error' | 'input' | null;
  /** The package.json `"type"` value (any string as pasted), or `null`. */
  type: string | null;
  /** Whether `"type"` is actually known (a parseable package.json or the error text names it). */
  typeKnown: boolean;
  /** Normalised extension such as `'.mjs'`, or `null`. */
  ext: string | null;
  /** Failing file path from the error (masked), or `null`. */
  file: string | null;
}

export interface EsmCjsInput {
  /** The pasted error text. */
  error?: string | undefined;
  /** Whole package.json, or a bare snippet such as `"type": "module"`. */
  packageJson?: string | undefined;
  /** Extension of the failing file (`'.ts'`, `'mjs'`…). */
  fileExt?: string | undefined;
  /** Node.js version (`'22.12.0'`, `'v20'`…). The version printed in the error wins. */
  nodeVersion?: string | undefined;
}

export interface EsmCjsExplanation {
  findings: EsmFinding[];
  context: EsmContext;
  /** Caveats about the input (bad version string, version mismatch, unparsable package.json). */
  notes: string[];
}

export interface NodeVersion {
  major: number;
  minor: number;
  patch: number;
  /** Normalised `major.minor.patch`. */
  raw: string;
}

export interface FeatureRange {
  floor: string;
  /** Major line → first version of that line with the feature. */
  backports: Readonly<Record<number, string>>;
  removedIn?: string;
}

export interface ParsedPackageJson {
  /** A non-blank package.json text was given. */
  provided: boolean;
  type: string | null;
  /** Raw `"exports"` value; `'(unparsed)'` when only the regex fallback saw it; `undefined` when absent. */
  exports: unknown;
  main: string | null;
  module: string | null;
  name: string | null;
  scripts: Record<string, string>;
  /** The text was not valid JSON; fields come from a regex fallback. */
  parseError: boolean;
}

export interface ErrorFacts {
  nodeVersion?: string;
  treatedAs?: 'esm';
  type?: 'module' | 'commonjs';
  file?: string;
  ext?: string;
}

export const SOURCES: Readonly<Record<
  | 'requireEsm' | 'requireEsmRelease' | 'errRequireEsm' | 'errRequireAsync' | 'enabling'
  | 'determining' | 'syntaxDetection' | 'noRequire' | 'noDirname' | 'typescript'
  | 'stripTypesRelease' | 'tsNodeEsm' | 'errUnknownExt' | 'errNodeModulesStrip' | 'errTsSyntax'
  | 'errInvalidTsSyntax' | 'subpathImports' | 'tsPathsAliases' | 'jestEsm' | 'errAssertionMissing'
  | 'mandatoryExt' | 'errModuleNotFound' | 'errDirImport' | 'importAttributes' | 'dropAssertions'
  | 'errAttrMissing' | 'exportsEncapsulation' | 'conditionalExports' | 'errPathNotExported',
  Source
>>;
/** Verified Node.js version facts. */
export const FEATURES: Readonly<Record<FeatureName, FeatureRange>>;
/** Every rule id, in evaluation order. */
export const RULE_IDS: readonly EsmRuleId[];

/** `'v22'`, `'22.12'`, `'22.12.0'` → parsed version; `null` when unparsable. */
export function parseVersion(input: string | number | null | undefined): NodeVersion | null;
/** Negative / zero / positive, or `NaN` when either side is unparsable. */
export function compareVersions(a: string | NodeVersion | null, b: string | NodeVersion | null): number;
/** `null` when the version is unknown or the feature name is not in `FEATURES`. */
export function hasFeature(version: string | NodeVersion | null | undefined, featureName: string): boolean | null;
/** Human "20.19.0+, 22.12.0+, 23.0.0+" string. Throws for a name not in `FEATURES`. */
export function describeFeatureVersions(featureName: FeatureName): string;
/** Masks URL passwords, tokens, bearer credentials, well-known token shapes and JWTs. Falsy → `''`. */
export function maskSecrets(text: unknown): string;
export function parsePackageJson(text: string | null | undefined): ParsedPackageJson;
/** `'TS'`, `'.ts'`, `'file.mjs'` → `'.ts'` / `'.mjs'`; `null` when empty or unrecognised. */
export function normaliseExtension(ext: string | null | undefined): string | null;
/** Facts revealed by the error text itself; keys are only present when found. */
export function extractFromError(text: string | null | undefined): ErrorFacts;

/** Explain a pasted ESM/CommonJS error (ERR_REQUIRE_ESM, "Cannot use import statement outside a module", …). */
export function explain(input?: EsmCjsInput): EsmCjsExplanation;
