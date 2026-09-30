// Type declarations for dev-error-explainers/cors-error-explainer

export type Severity = 'critical' | 'warning' | 'info';

/** `'not-cors'`: the CORS line is a symptom of something else. `'hint'`: advice only. */
export type FindingKind = 'cors' | 'not-cors' | 'hint';

export type StackId =
  | 'nextjs-route'
  | 'nextjs-middleware'
  | 'supabase-edge'
  | 'express'
  | 'cloudflare-worker';

export type Browser = 'chrome' | 'firefox' | 'safari';

export type CorsFindingId =
  | 'missing-allow-origin'
  | 'origin-not-allowed'
  | 'wildcard-with-credentials'
  | 'multiple-allow-origin'
  | 'allow-origin-mismatch'
  | 'invalid-allow-origin'
  | 'allow-credentials-not-true'
  | 'preflight-not-ok'
  | 'preflight-redirect'
  | 'header-not-allowed'
  | 'method-not-allowed'
  | 'invalid-allow-token'
  | 'request-did-not-succeed'
  | 'preflight-channel-failed'
  | 'not-http'
  | 'mixed-content'
  | 'vary-origin-missing'
  | 'auth-not-covered-by-wildcard'
  | 'wildcard-lists-with-credentials'
  | 'preflight-maybe-unhandled'
  | 'server-error-behind-cors'
  | 'no-cors-opaque'
  | 'no-cors-suggestion'
  | 'safari-generic'
  | 'unrecognised-cors';

/** A primary source (browser source code, spec, MDN or vendor docs). */
export interface Source {
  url: string;
  label: string;
}

export interface CorsFinding {
  id: CorsFindingId;
  kind: FindingKind;
  severity: Severity;
  title: string;
  explanation: string;
  steps: string[];
  /** The main source for this finding. */
  source: Source;
  /** Every source the finding was verified against. */
  sources: Source[];
  /** Present (and `true`) on findings that imply a credentialed request. */
  credentials?: boolean;
  /** The pasted fragment (masked) that triggered the finding, or `null`. */
  evidence: string | null;
  /** First detected from the pasted response headers rather than the console text. */
  fromHeaders: boolean;
  /** Detected in the console text AND confirmed by the headers. */
  confirmedByHeaders: boolean;
}

/** Context extracted from the console text by `parseConsoleError`. */
export interface ConsoleErrorContext {
  browser: Browser | null;
  /** e.g. `'fetch'`, `'XMLHttpRequest'`. */
  requestKind: string | null;
  url: string | null;
  redirectedFrom: string | null;
  origin: string | null;
  preflight: boolean;
  status: number | null;
  method: string | null;
  /** Blocked request header, lowercased. */
  header: string | null;
  /** Firefox `(Reason: …)` texts. */
  reasons: string[];
}

/** The (masked) context returned by `diagnose`. */
export interface CorsContext {
  browser: Browser | null;
  requestKind: string | null;
  url: string | null;
  redirectedFrom: string | null;
  origin: string | null;
  preflight: boolean;
  status: number | null;
  method: string | null;
  header: string | null;
  /** Whether the request is known to send credentials. */
  credentials: boolean;
}

export interface ParsedCorsHeaders {
  /** Response headers of the FIRST response, lowercased name → values. Null-prototype object. */
  response: Record<string, string[]>;
  /** Request headers (`> ` lines of `curl -v`), lowercased name → values. Null-prototype object. */
  request: Record<string, string[]>;
  /** Status of the first response, or `null`. */
  status: number | null;
  /** Every status line seen (e.g. a `curl -L` chain). */
  statuses: number[];
  requestMethod: string | null;
  /** Number of response header lines kept. */
  count: number;
}

export interface FixParams {
  origin: string;
  credentials: boolean;
  headers: string[];
  methods: string[];
}

export interface FixParamsOptions {
  credentials?: boolean | undefined;
  extraHeaders?: string[] | undefined;
}

export interface CorsFix {
  /** Suggested file path, e.g. `app/api/<route>/route.js`. */
  filename: string;
  code: string;
  notes: string[];
  source: Source;
  /** Only on the `nextjs-middleware` fix. */
  sources?: Source[];
}

export interface CorsInput {
  /** The browser console error, verbatim. */
  error?: string | undefined;
  /** Response headers (`curl -i`, `curl -v` or DevTools "name: value" lines). */
  headers?: string | undefined;
  /** Server stack for the fix snippet; unknown values fall back to a guess, then `'nextjs-route'`. */
  stack?: StackId | (string & {}) | undefined;
}

export interface CorsDiagnosis {
  /** Both `error` and `headers` were blank. */
  empty: boolean;
  /** At least one finding. */
  recognised: boolean;
  /** `false` when the root cause is not CORS, `null` when nothing conclusive was found. */
  isCorsProblem: boolean | null;
  context: CorsContext;
  /** Sorted: not-cors first, then cors, then hints; most severe first within a kind. */
  findings: CorsFinding[];
  stack: StackId;
  /** The stack was guessed from the request URL. */
  stackGuessed: boolean;
  /** Server-side fix, or `null` when no server fix applies. */
  fix: CorsFix | null;
}

export interface StackOption {
  id: StackId;
  label: string;
}

export interface CorsExample {
  id: string;
  label: string;
  error: string;
  headers: string;
}

export const SOURCES: Readonly<Record<
  | 'mdnErrors' | 'mdnCors' | 'mdnMissingOrigin' | 'mdnOriginMismatch' | 'mdnMultipleOrigin'
  | 'mdnWildcardCreds' | 'mdnAllowCreds' | 'mdnMethodNotFound' | 'mdnHeaderMissing'
  | 'mdnInvalidMethod' | 'mdnInvalidHeader' | 'mdnDidNotSucceed' | 'mdnPreflightFailed'
  | 'mdnNotHttp' | 'mdnExternalRedirect' | 'mdnAllowHeaders' | 'mdnOrigin' | 'mdnRequestMode'
  | 'mdnMixed' | 'fetchOkStatus' | 'fetchNonWildcard' | 'chromiumCors' | 'chromiumMixed'
  | 'chromiumNoCors' | 'firefoxStrings' | 'webkitCors' | 'webkitPreflight' | 'webkitThreadable'
  | 'nextRoute' | 'nextMiddleware' | 'nextProxy' | 'nextTrailingSlash' | 'supabaseCors'
  | 'expressCors' | 'cfWorkerCors',
  Source
>>;
export const STACKS: readonly StackOption[];
export const EXAMPLES: readonly CorsExample[];

/** Mask bearer/basic credentials, JWTs, secret headers, URL userinfo and secret query params. Non-strings → `''`. */
export function maskSecrets(input: string): string;
/** Typographic quotes → ASCII, whitespace collapsed, trimmed. Non-strings → `''`. */
export function normalise(text: string): string;
/** `scheme://host[:port]` (lowercased, userinfo dropped), or `null`. */
export function toOrigin(value: string | null | undefined): string | null;
export function parseConsoleError(raw: string): ConsoleErrorContext;
export function parseHeaders(raw: string): ParsedCorsHeaders;
/** Human description of why two origins differ, or `null` when they are equal or one is missing. */
export function describeOriginDiff(allowed: string | null | undefined, actual: string | null | undefined): string | null;
export function fixParams(
  ctx?: { origin?: string | null | undefined; header?: string | null | undefined; method?: string | null | undefined },
  opts?: FixParamsOptions,
): FixParams;
/** Fix snippet for a stack; unknown stacks get the Next.js route handler. */
export function buildFix(stack: StackId | (string & {}), params?: FixParams | null): CorsFix;
/** `'supabase-edge'` / `'cloudflare-worker'` from the request URL, else `null`. */
export function guessStack(ctx: { url?: string | null | undefined } | null | undefined): 'supabase-edge' | 'cloudflare-worker' | null;

/** Diagnose a pasted CORS console error (and optional response headers). */
export function diagnose(input?: CorsInput): CorsDiagnosis;
