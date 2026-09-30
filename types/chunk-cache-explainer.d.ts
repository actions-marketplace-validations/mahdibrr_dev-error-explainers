// Type declarations for dev-error-explainers/chunk-cache-explainer

export type Severity = 'critical' | 'warning' | 'info';

/** Host ids accepted by `diagnose({ host })`. */
export type HostId = 'auto' | 'vercel' | 'cloudflare' | 'netlify' | 'nginx' | 'other';
/** Hosts that can be detected from response headers. */
export type DetectedHost = 'cloudflare' | 'vercel' | 'netlify' | 'nginx';

export type ChunkRuleId =
  | 'input-missing'
  | 'input-unparsed'
  | 'input-no-status'
  | 'html-redirect'
  | 'html-immutable'
  | 'html-browser-max-age'
  | 'html-expires'
  | 'html-heuristic-freshness'
  | 'html-shared-cacheable'
  | 'html-cf-cache-hit'
  | 'html-cf-cache-eligible'
  | 'html-nginx-cache-hit'
  | 'html-vercel-cache-hit'
  | 'html-netlify-cache-hit'
  | 'html-cache-status-hit'
  | 'html-age'
  | 'chunk-redirect'
  | 'chunk-missing'
  | 'chunk-404-cached'
  | 'chunk-server-error'
  | 'chunk-blocked'
  | 'chunk-revalidated'
  | 'chunk-html-fallback'
  | 'chunk-wrong-mime'
  | 'chunk-css-wrong-mime'
  | 'chunk-not-immutable'
  | 'chunk-not-static-path'
  | 'deployment-id-mismatch'
  | 'service-worker-cache';

export type Verdict = 'cause-found' | 'suspects' | 'incomplete' | 'clean';

/** A `[lowercased-name, value]` header pair. */
export type HeaderPair = [name: string, value: string];

/** One HTTP response in a paste. `status` / `httpVersion` are `null` when no status line was pasted. */
export interface ResponseBlock {
  httpVersion: string | null;
  status: number | null;
  reason: string;
  headers: HeaderPair[];
}

export interface ParsedResponseHeaders {
  blocks: ResponseBlock[];
  /** Request targets seen in the paste (`> GET /path`, bare URLs, `:path:`). */
  requestTargets: string[];
  /** Number of non-empty lines that were neither a status line nor a header. */
  unrecognised: number;
}

/** `{ directive: value }`, or `true` for a directive without a value. First occurrence wins. */
export type CacheControl = Record<string, string | true>;

/** One member of an RFC 9211 `Cache-Status` list. */
export interface CacheStatusEntry {
  cache: string;
  hit: boolean;
  fwd: string | null;
}

export interface CacheLayer {
  layer: 'cloudflare' | 'vercel' | 'netlify' | 'nginx' | 'cache-status';
  header: 'cf-cache-status' | 'x-vercel-cache' | 'cache-status' | 'x-cache-status';
  value: string;
  /** Did this layer serve the response from its cache? */
  fromCache: boolean;
  /** Primary-source URL for the meaning of `value`. */
  source: string;
}

export interface ChunkCacheFinding {
  ruleId: ChunkRuleId;
  severity: Severity;
  title: string;
  why: string;
  /** Fix, in prose (empty string when no fix text applies). */
  fix: string;
  /** Config / code snippet for the fix, or `null`. */
  code: string | null;
  /** Primary-source URL the rule was verified against. */
  source: string;
}

export interface ChunkCachePass {
  ruleId: ChunkRuleId;
  text: string;
}

/** A pasted response as echoed back, with secret header values masked. */
export interface MaskedResponse {
  status: number | null;
  httpVersion: string | null;
  headers: HeaderPair[];
}

export interface ChunkCacheInput {
  /** Response headers of the HTML document (`curl -sI`, `curl -v`, DevTools copy). */
  htmlHeaders?: string | undefined;
  /** Response headers of one hashed file under `/_next/static/`. */
  chunkHeaders?: string | undefined;
  /** Hosting platform; `'auto'` (default) detects it from the headers. Any other string is passed through as-is. */
  host?: HostId | (string & {}) | undefined;
  /** Set when the site registers a service worker. */
  serviceWorker?: boolean | undefined;
}

export interface ChunkCacheDiagnosis {
  /** Most severe first. */
  findings: ChunkCacheFinding[];
  passes: ChunkCachePass[];
  counts: Record<Severity, number>;
  verdict: Verdict;
  /** Effective host: the `host` input unless `'auto'`, else the first detected host, else `'other'`. */
  host: string;
  detectedHosts: DetectedHost[];
  html: MaskedResponse | null;
  chunk: MaskedResponse | null;
}

export interface HostOption {
  id: HostId;
  label: string;
}

export interface ChunkRuleInfo {
  id: ChunkRuleId;
  summary: string;
  source: string;
}

/** Primary-source URLs, keyed by short name. */
export const SOURCES: Readonly<Record<
  | 'nextSelfHosting' | 'nextHeadersCacheControl' | 'nextDeploymentId' | 'nextProxyMatcher'
  | 'rfc9111MaxAge' | 'rfc9111FreshnessLifetime' | 'rfc9111Heuristic' | 'rfc9110StatusCodes'
  | 'rfc9110Redirection' | 'rfc9110NotModified' | 'htmlFetchClassicScript' | 'htmlLinkStylesheet'
  | 's3GetObject' | 'rfc9111SMaxage' | 'rfc8246Immutable' | 'rfc9211CacheStatus' | 'mdnAge'
  | 'mdnNosniff' | 'mdnCache' | 'mdnServiceWorkers' | 'webpackChunkRuntime' | 'cfCacheStatus'
  | 'cfDefaultCache' | 'cfStatusCodeTtl' | 'cfPagesServing' | 'vercelResponseHeaders'
  | 'vercelSkewProtection' | 'netlifyCaching' | 'nginxUpstreamCacheStatus' | 'nginxProxyCacheValid'
  | 'nginxTryFiles',
  string
>>;
export const HOSTS: readonly HostOption[];
/** Every rule the diagnoser can emit. */
export const RULES: readonly ChunkRuleInfo[];
/** Rules deliberately not encoded (no primary source confirmed them). */
export const DROPPED_RULES: readonly string[];
/** Example HTML-document headers (Cloudflare caching HTML). */
export const EXAMPLE_HTML: string;
/** Example chunk headers (a cached 404). */
export const EXAMPLE_CHUNK: string;

export function parseResponseHeaders(text: string): ParsedResponseHeaders;
/** The last final (non-1xx, non-CONNECT) response, or `null`. */
export function finalResponse(parsed: ParsedResponseHeaders | null | undefined): ResponseBlock | null;
/** All values of a header (case-insensitive), comma-joined, or `null`. */
export function getHeader(block: ResponseBlock | null | undefined, name: string): string | null;
export function parseCacheControl(value: string | null | undefined): CacheControl;
/** Masks URL userinfo passwords and secret-looking query/fragment parameters. Falsy input is returned unchanged. */
export function maskUrlSecrets<T extends string | null | undefined>(value: T): T extends string ? string : T;
export function maskHeaderValue(name: string, value: string): string;
export function maskedHeaders(block: ResponseBlock | null | undefined): HeaderPair[];
export function parseCacheStatus(value: string | null | undefined): CacheStatusEntry[];
export function cacheLayers(block: ResponseBlock | null | undefined): CacheLayer[];
/** Hosts visible in the headers, outermost first. */
export function detectHosts(...blocks: Array<ResponseBlock | null | undefined>): DetectedHost[];

/** Diagnose pasted headers of an HTML page and one chunk (ChunkLoadError after a deploy). */
export function diagnose(input?: ChunkCacheInput): ChunkCacheDiagnosis;
