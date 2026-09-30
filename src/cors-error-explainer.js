// cors-error-explainer — pure logic for the CORS console-error explainer tool.
//
// Input : the browser console error pasted verbatim (Chrome, Firefox or
//         Safari wording), optional response headers (`curl -i` / `curl -v`
//         output or DevTools "name: value" lines), optional server stack.
// Output: which CORS case it is, a plain-English explanation, a correct fix
//         snippet for the chosen stack, and "this is not really CORS" findings
//         (mixed content, network failure, a 5xx hiding behind the CORS line,
//         the no-cors/opaque misunderstanding).
//
// No React, no DOM, no network. Every rule carries the PRIMARY source it was
// verified against (fetched 2026-09-25) — in a comment and in `source` so the
// UI can link it. Browser wordings come from the browsers' own source code:
//   Chrome  — Chromium cors_error_string.cc / mixed_content_checker.cc
//   Safari  — WebKit CrossOriginAccessControl.cpp, CrossOriginPreflightResultCache.cpp,
//             ThreadableLoader.cpp
//   Firefox — dom/locales/en-US/chrome/security/security.properties (the current
//             strings, e.g. CORSPreflightDidNotSucceed3), plus the MDN CORS errors
//             reference for the older wordings still seen in pasted logs
// Rules are matched on stable fragments, never whole sentences: DevTools wraps
// lines on paste and some wordings carry quoted values in the middle.

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const MDN_ERR = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors';

export const SOURCES = {
  mdnErrors: { url: MDN_ERR, label: 'MDN — CORS errors' },
  mdnCors: { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS', label: 'MDN — Cross-Origin Resource Sharing (CORS)' },
  mdnMissingOrigin: { url: `${MDN_ERR}/CORSMissingAllowOrigin`, label: "MDN — CORS header 'Access-Control-Allow-Origin' missing" },
  mdnOriginMismatch: { url: `${MDN_ERR}/CORSAllowOriginNotMatchingOrigin`, label: "MDN — 'Access-Control-Allow-Origin' does not match" },
  mdnMultipleOrigin: { url: `${MDN_ERR}/CORSMultipleAllowOriginNotAllowed`, label: "MDN — Multiple 'Access-Control-Allow-Origin' not allowed" },
  mdnWildcardCreds: { url: `${MDN_ERR}/CORSNotSupportingCredentials`, label: "MDN — Credential is not supported if 'Access-Control-Allow-Origin' is '*'" },
  mdnAllowCreds: { url: `${MDN_ERR}/CORSMIssingAllowCredentials`, label: "MDN — expected 'true' in 'Access-Control-Allow-Credentials'" },
  mdnMethodNotFound: { url: `${MDN_ERR}/CORSMethodNotFound`, label: "MDN — Did not find method in 'Access-Control-Allow-Methods'" },
  mdnHeaderMissing: { url: `${MDN_ERR}/CORSMissingAllowHeaderFromPreflight`, label: "MDN — missing token in 'Access-Control-Allow-Headers'" },
  mdnInvalidMethod: { url: `${MDN_ERR}/CORSInvalidAllowMethod`, label: "MDN — invalid token in 'Access-Control-Allow-Methods'" },
  mdnInvalidHeader: { url: `${MDN_ERR}/CORSInvalidAllowHeader`, label: "MDN — invalid token in 'Access-Control-Allow-Headers'" },
  mdnDidNotSucceed: { url: `${MDN_ERR}/CORSDidNotSucceed`, label: 'MDN — CORS request did not succeed' },
  mdnPreflightFailed: { url: `${MDN_ERR}/CORSPreflightDidNotSucceed`, label: 'MDN — CORS preflight channel did not succeed' },
  mdnNotHttp: { url: `${MDN_ERR}/CORSRequestNotHttp`, label: 'MDN — CORS request not HTTP' },
  mdnExternalRedirect: { url: `${MDN_ERR}/CORSExternalRedirectNotAllowed`, label: 'MDN — CORS request external redirect not allowed' },
  mdnAllowHeaders: { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Headers', label: 'MDN — Access-Control-Allow-Headers' },
  mdnOrigin: { url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin', label: 'MDN — Origin header' },
  mdnRequestMode: { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Request/mode', label: 'MDN — Request.mode' },
  mdnMixed: { url: 'https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content', label: 'MDN — Mixed content' },
  fetchOkStatus: { url: 'https://fetch.spec.whatwg.org/#ok-status', label: 'Fetch Standard — ok status' },
  fetchNonWildcard: { url: 'https://fetch.spec.whatwg.org/#cors-non-wildcard-request-header-name', label: 'Fetch Standard — CORS non-wildcard request-header name' },
  chromiumCors: { url: 'https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/platform/loader/cors/cors_error_string.cc', label: 'Chromium — cors_error_string.cc' },
  chromiumMixed: { url: 'https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/loader/mixed_content_checker.cc', label: 'Chromium — mixed_content_checker.cc' },
  chromiumNoCors: { url: 'https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/', label: 'Chromium — example CORS console error' },
  firefoxStrings: { url: 'https://github.com/mozilla-firefox/firefox/blob/main/dom/locales/en-US/chrome/security/security.properties', label: 'Firefox — security.properties (CORS and mixed-content console strings)' },
  webkitCors: { url: 'https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/CrossOriginAccessControl.cpp', label: 'WebKit — CrossOriginAccessControl.cpp' },
  webkitPreflight: { url: 'https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/CrossOriginPreflightResultCache.cpp', label: 'WebKit — CrossOriginPreflightResultCache.cpp' },
  webkitThreadable: { url: 'https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/ThreadableLoader.cpp', label: 'WebKit — ThreadableLoader.cpp' },
  nextRoute: { url: 'https://nextjs.org/docs/app/api-reference/file-conventions/route', label: 'Next.js — route.js (CORS, OPTIONS)' },
  nextMiddleware: { url: 'https://nextjs.org/docs/15/app/api-reference/file-conventions/middleware', label: 'Next.js 15 — middleware.js (CORS example)' },
  nextProxy: { url: 'https://nextjs.org/docs/app/api-reference/file-conventions/proxy', label: 'Next.js 16+ — proxy.js (middleware renamed, CORS example)' },
  nextTrailingSlash: { url: 'https://nextjs.org/docs/15/app/api-reference/config/next-config-js/trailingSlash', label: 'Next.js 15 — trailingSlash' },
  supabaseCors: { url: 'https://supabase.com/docs/guides/functions/cors', label: 'Supabase — CORS for Edge Functions' },
  expressCors: { url: 'https://github.com/expressjs/cors#configuration-options', label: 'expressjs/cors — configuration options' },
  cfWorkerCors: { url: 'https://developers.cloudflare.com/workers/examples/cors-header-proxy/', label: 'Cloudflare Workers — CORS header proxy example' },
};

// ---------------------------------------------------------------------------
// Stacks
// ---------------------------------------------------------------------------

export const STACKS = [
  { id: 'nextjs-route', label: 'Next.js route handler (app/api/*/route.js)' },
  { id: 'nextjs-middleware', label: 'Next.js middleware (middleware.js)' },
  { id: 'supabase-edge', label: 'Supabase Edge Function' },
  { id: 'express', label: 'Express (Node.js)' },
  { id: 'cloudflare-worker', label: 'Cloudflare Worker' },
];

const STACK_IDS = new Set(STACKS.map((s) => s.id));

const MAX_INPUT = 50000;

// ---------------------------------------------------------------------------
// Secret masking
// ---------------------------------------------------------------------------

const MASK = '•••masked•••';

/**
 * Mask secrets anywhere in a string: bearer/basic credentials, JWTs, Supabase
 * `apikey` values, cookies, URL userinfo (user:password@) and secret-looking
 * query parameters. Applied to everything the tool echoes back.
 */
export function maskSecrets(input) {
  if (typeof input !== 'string' || !input) return '';
  let s = input;
  // Authorization: Bearer xxx / Basic xxx (header lines and inline mentions)
  s = s.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${MASK}`);
  // JWTs anywhere (three base64url segments starting with eyJ)
  s = s.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, MASK);
  // header lines carrying secrets
  s = s.replace(
    /^(\s*[<>]?\s*(?:authorization|proxy-authorization|apikey|x-api-key|api-key|cookie|set-cookie|x-auth-token|x-access-token)\s*:\s*)(.+)$/gim,
    (_, head) => `${head}${MASK}`,
  );
  // URL userinfo: scheme://user:pass@host
  s = s.replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^\s/@:'"]+):([^\s/@'"]+)@/gi, `$1$2:${MASK}@`);
  // secret-looking query parameters
  s = s.replace(
    /([?&](?:access_token|refresh_token|id_token|token|apikey|api_key|key|secret|client_secret|password|pwd|sig|signature|code|auth)=)[^&\s'"#)]+/gi,
    `$1${MASK}`,
  );
  return s;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/** Normalise pasted console text: typographic quotes → ASCII, collapse whitespace. */
export function normalise(text) {
  if (typeof text !== 'string') return '';
  return text
    .slice(0, MAX_INPUT)
    .replace(/[‘’‚‛′`]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingPunct(u) {
  return u.replace(/[.,;)]+$/, '');
}

/** Serialise a URL-ish string to its origin (scheme://host[:port]) or null. */
export function toOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  const m = value.trim().match(/^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)/i);
  if (!m) return null;
  // A serialised origin never carries userinfo (user:password@): drop it so a
  // pasted credential can never reach the fix snippet.
  const host = m[2].replace(/^[^@]*@/, '');
  if (!host) return null;
  return `${m[1].toLowerCase()}://${host.toLowerCase()}`;
}

/** Remove URL userinfo (user:password@) from an origin-like string; browsers never print it in an origin. */
function stripUserinfo(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#\s@]*@/i, '$1');
}

/**
 * Extract structured context from the console text: browser, request URL,
 * requesting origin, preflight flag, status code, blocked header / method.
 */
export function parseConsoleError(raw) {
  const text = normalise(raw);
  const ctx = {
    browser: null,
    requestKind: null,
    url: null,
    redirectedFrom: null,
    origin: null,
    preflight: false,
    status: null,
    method: null,
    header: null,
    reasons: [],
  };
  if (!text) return ctx;

  // Chrome wrapper — Chromium cors_error_string.cc:
  // "Access to " <kind> " at '" <url> "' (redirected from '" <url> "') from origin '" <origin> "' has been blocked by CORS policy: "
  const chrome = text.match(
    /Access to ([a-z][\w -]{0,40}?) at '([^']+)'(?: \(redirected from '([^']+)'\))? from origin '([^']+)' has been blocked by CORS policy/i,
  );
  if (chrome) {
    ctx.browser = 'chrome';
    ctx.requestKind = chrome[1].trim();
    ctx.url = chrome[2];
    ctx.redirectedFrom = chrome[3] || null;
    ctx.origin = chrome[4];
  } else if (/has been blocked by CORS policy/i.test(text)) {
    ctx.browser = 'chrome';
  }
  // Chromium: "Response to preflight request doesn't pass access control check: "
  if (/Response to preflight request doesn'?t pass access control check/i.test(text)) ctx.preflight = true;

  // Firefox wrapper — MDN CORS errors: "Cross-Origin Request Blocked: The Same Origin Policy disallows
  // reading the remote resource at https://some-url-here. (Reason: additional information here)."
  const ffRe = /remote resource at (\S+?)\.?\s*\(Reason:\s*([^)]+)\)/gi;
  let ff;
  while ((ff = ffRe.exec(text)) !== null) {
    ctx.browser = ctx.browser || 'firefox';
    ctx.url = ctx.url || stripTrailingPunct(ff[1]);
    ctx.reasons.push(ff[2].trim());
  }
  if (!ctx.browser && /Cross-Origin Request Blocked/i.test(text)) ctx.browser = 'firefox';
  // Current Firefox (security.properties CORSPreflightDidNotSucceed3 / CORSMissingAllowHeaderFromPreflight2):
  // "CORS preflight response did not succeed). Status code: N" / "... from CORS preflight response".
  // Older Firefox said "preflight channel"; both are kept.
  if (/from CORS preflight (?:channel|response)|CORS preflight (?:channel|response) did not succeed/i.test(text)) ctx.preflight = true;

  // Safari — WebKit ThreadableLoader.cpp: "Fetch API cannot load " / "XMLHttpRequest cannot load " /
  // "EventSource cannot load " / "Cannot load " + url + " due to access control checks."
  const safariLoad = text.match(/(Fetch API|XMLHttpRequest|EventSource)? ?cannot load (\S+?) due to access control checks/i);
  if (safariLoad) {
    ctx.browser = ctx.browser || 'safari';
    ctx.requestKind = ctx.requestKind || (safariLoad[1] || null);
    ctx.url = ctx.url || stripTrailingPunct(safariLoad[2]);
  }
  // WebKit CrossOriginAccessControl.cpp: "Origin " + origin + " is not allowed by Access-Control-Allow-Origin."
  const safariOrigin = text.match(/\bOrigin (\S+?) is not allowed by Access-Control-Allow-Origin/i);
  if (safariOrigin) {
    ctx.browser = ctx.browser || 'safari';
    ctx.origin = ctx.origin || stripTrailingPunct(safariOrigin[1]);
  }
  if (/Preflight response is not successful/i.test(text)) {
    ctx.preflight = true;
    ctx.browser = ctx.browser || 'safari';
  }

  // Status code: Firefox/Safari "Status code: 500"; Chrome network line "net::ERR_FAILED 500 (Internal Server Error)".
  const st = text.match(/Status code:?\s*(\d{3})\b/i) || text.match(/net::ERR_FAILED\s+(\d{3})\b/i);
  if (st) ctx.status = Number(st[1]);

  // Blocked header (Chromium / WebKit / Firefox wordings)
  const hdr = text.match(/Request header field (\S+?) is not allowed by Access-Control-Allow-Headers/i)
    || text.match(/missing token '([^']+)' in CORS header 'Access-Control-Allow-Headers'/i)
    || text.match(/header '([^']+)' is not allowed according to header 'Access-Control-Allow-Headers'/i);
  if (hdr) {
    ctx.header = hdr[1].replace(/^['"]|['"]$/g, '').toLowerCase();
    ctx.preflight = true;
  }
  // Blocked method
  const meth = text.match(/Method (\S+?) is not allowed by Access-Control-Allow-Methods/i);
  if (meth) {
    ctx.method = meth[1].replace(/^['"]|['"]$/g, '').toUpperCase();
    ctx.preflight = true;
  }
  if (!ctx.method) {
    const netLine = text.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (https?:\/\/\S+)/);
    if (netLine) ctx.method = netLine[1];
  }
  if (/Did not find method in CORS header 'Access-Control-Allow-Methods'/i.test(text)) ctx.preflight = true;

  if (ctx.origin && /^null$/i.test(ctx.origin)) ctx.origin = 'null';
  if (ctx.origin) ctx.origin = stripUserinfo(ctx.origin);
  return ctx;
}

/**
 * Parse pasted response headers. Accepts `curl -i` (status line + name: value),
 * `curl -v` (lines prefixed "< " for the response and "> " for the request)
 * and plain "name: value" / "name<TAB>value" lines. When several responses are
 * pasted (curl -L), the FIRST one is analysed and every status is kept.
 */
export function parseHeaders(raw) {
  // Null-prototype buckets: a pasted header named __proto__ or constructor must
  // not hit Object.prototype.
  const out = { response: Object.create(null), request: Object.create(null), status: null, statuses: [], requestMethod: null, count: 0 };
  if (typeof raw !== 'string' || !raw.trim()) return out;
  const lines = raw.slice(0, MAX_INPUT).split(/\r?\n/);
  let responseIndex = -1;
  for (const rawLine of lines) {
    let line = rawLine.replace(/[‘’]/g, "'").trimEnd();
    let side = 'response';
    if (/^\s*>/.test(line)) { side = 'request'; line = line.replace(/^\s*>\s?/, ''); }
    else if (/^\s*</.test(line)) { line = line.replace(/^\s*<\s?/, ''); }
    line = line.trim();
    if (!line || line.startsWith('*') || line.startsWith('{')) continue;

    const status = line.match(/^HTTP\/[\d.]+\s+(\d{3})/i);
    if (status) {
      out.statuses.push(Number(status[1]));
      responseIndex += 1;
      if (responseIndex === 0) out.status = Number(status[1]);
      continue;
    }
    if (side === 'request') {
      const reqLine = line.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+/);
      if (reqLine) { if (!out.requestMethod) out.requestMethod = reqLine[1]; continue; }
    }
    const m = line.match(/^([A-Za-z0-9!#$%&'*+.^_|~-]+)\s*(?::|\t)\s*(.*)$/);
    if (!m) continue;
    // Only the first response block is analysed (the preflight when curl follows).
    if (side === 'response' && responseIndex > 0) continue;
    const name = m[1].toLowerCase();
    const bucket = side === 'request' ? out.request : out.response;
    (bucket[name] = bucket[name] || []).push(m[2].trim());
    if (side === 'response') out.count += 1;
  }
  return out;
}

function splitList(values) {
  return (values || [])
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
}

const SIMPLE_METHODS = new Set(['GET', 'HEAD', 'POST']);

// ---------------------------------------------------------------------------
// Rules on the console text
// ---------------------------------------------------------------------------
// Each rule: id, kind ('cors' | 'not-cors' | 'hint'), severity, patterns
// (stable fragments), build(ctx, match) → { title, explanation, steps, source, sources }.

/** Why a preflight got a non-2xx status, in plain English. */
function preflightStatusWhy(s) {
  if (s === 404 || s === 405) return `The OPTIONS request got ${s}: nothing on the server handles OPTIONS for this path (no OPTIONS handler, or a router that only registered GET/POST).`;
  if (s === 401 || s === 403) return `The OPTIONS request got ${s}: an auth check ran on the preflight. Preflight requests never carry credentials, so auth middleware must let OPTIONS through before checking tokens or cookies.`;
  if (s && s >= 500) return `The OPTIONS request got ${s}: the server crashed while handling the preflight — check the server logs for that request.`;
  if (s && s >= 300 && s < 400) return `The OPTIONS request got ${s}: a redirect. Preflights cannot follow redirects — call the final URL directly.`;
  return 'Look at the OPTIONS request in the Network tab to see which status it got.';
}

const RULES = [
  {
    // Chromium kMissingAllowOriginHeader: "No 'Access-Control-Allow-Origin' header is present on the requested resource."
    // Firefox (MDN CORSMissingAllowOrigin): "Reason: CORS header 'Access-Control-Allow-Origin' missing"
    id: 'missing-allow-origin',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /No 'Access-Control-Allow-Origin' header is present/i,
      /CORS header 'Access-Control-Allow-Origin' missing/i,
    ],
    build: (ctx) => ({
      title: ctx.preflight
        ? 'The preflight (OPTIONS) response has no Access-Control-Allow-Origin header'
        : 'The response has no Access-Control-Allow-Origin header',
      explanation: ctx.preflight
        ? 'Before sending your real request the browser sent an OPTIONS "preflight" to ask permission, and the answer did not include Access-Control-Allow-Origin. A preflight happens when the request uses a method other than GET, HEAD or POST, sets a header outside the CORS-safelisted set (Accept, Accept-Language, Content-Language, Content-Type), or sends a Content-Type other than application/x-www-form-urlencoded, multipart/form-data or text/plain — application/json and an Authorization header both trigger one. Your server must answer OPTIONS itself, with the CORS headers.'
        : 'The server answered, but without Access-Control-Allow-Origin, so the browser refuses to let your JavaScript read the response. This is fixed on the server: send the requesting origin (or * for a truly public, credential-free API) back in that header. Remember that the header must also be present on error responses, not just the happy path.',
      steps: [
        'Add Access-Control-Allow-Origin to the response (a specific origin, or * only for public data without cookies).',
        'When you echo a specific origin, also send Vary: Origin so caches keep one copy per origin.',
        ctx.preflight ? 'Handle OPTIONS explicitly and return a 2xx status with the same CORS headers.' : 'Make sure error branches (4xx/5xx) send the headers too.',
      ],
      source: SOURCES.mdnMissingOrigin,
      sources: [SOURCES.chromiumCors, SOURCES.mdnCors, SOURCES.mdnMissingOrigin],
    }),
  },
  {
    // WebKit CrossOriginAccessControl.cpp: "Origin " + origin + " is not allowed by Access-Control-Allow-Origin."
    // WebKit uses this one line for both "header missing" and "header present but different".
    id: 'origin-not-allowed',
    kind: 'cors',
    severity: 'critical',
    patterns: [/\bOrigin \S+ is not allowed by Access-Control-Allow-Origin/i],
    build: (ctx) => ({
      title: `Safari: origin ${ctx.origin || '(yours)'} is not allowed by Access-Control-Allow-Origin`,
      explanation: 'WebKit prints this single message whether Access-Control-Allow-Origin is missing entirely or present with a different value. Paste the response headers below to tell the two apart. Either way the fix is on the server: return exactly the requesting origin (scheme, host and port, no path, no trailing slash) or * for a public, credential-free endpoint.',
      steps: [
        'Check the response headers: is Access-Control-Allow-Origin there at all?',
        `If it is, compare it character by character with ${ctx.origin || 'the page origin'} — http vs https, www vs apex, and the port all count.`,
        'Echo the allowed origin and add Vary: Origin.',
      ],
      source: SOURCES.webkitCors,
      sources: [SOURCES.webkitCors, SOURCES.mdnOriginMismatch, SOURCES.mdnMissingOrigin],
    }),
  },
  {
    // Chromium kWildcardOriginNotAllowed: "The value of the 'Access-Control-Allow-Origin' header in the response must not be
    //   the wildcard '*' when the request's credentials mode is 'include'."
    // Firefox (MDN CORSNotSupportingCredentials): "Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '*'"
    // WebKit: "Cannot use wildcard in Access-Control-Allow-Origin when credentials flag is true."
    id: 'wildcard-with-credentials',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /must not be the wildcard '\*' when the request'?s credentials mode is 'include'/i,
      /Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '\*'/i,
      /Cannot use wildcard in Access-Control-Allow-Origin when credentials flag is true/i,
    ],
    build: () => ({
      title: "Access-Control-Allow-Origin: * cannot be used with credentials (cookies / withCredentials / credentials: 'include')",
      explanation: "Your request sends credentials — fetch with credentials: 'include', axios/XHR with withCredentials: true, or cookies — and the server answered Access-Control-Allow-Origin: *. For credentialed requests the server must name the exact origin instead of *. The same rule applies to Access-Control-Allow-Headers, -Methods and -Expose-Headers: * is not a wildcard when credentials are involved.",
      steps: [
        'Replace * with the requesting origin, taken from an allow-list (never echo any Origin blindly on a credentialed API).',
        'Add Access-Control-Allow-Credentials: true and Vary: Origin.',
        "Or, if you do not need cookies on this call, drop credentials: 'include' / withCredentials on the client.",
      ],
      source: SOURCES.mdnWildcardCreds,
      sources: [SOURCES.chromiumCors, SOURCES.webkitCors, SOURCES.mdnCors],
      credentials: true,
    }),
  },
  {
    // Chromium kMultipleAllowOriginValues: "The 'Access-Control-Allow-Origin' header contains multiple values '...', but only one is allowed."
    // Firefox (MDN CORSMultipleAllowOriginNotAllowed): "Multiple CORS header 'Access-Control-Allow-Origin' not allowed"
    // WebKit: "Access-Control-Allow-Origin cannot contain more than one origin."
    id: 'multiple-allow-origin',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /'Access-Control-Allow-Origin' header contains multiple values/i,
      /Multiple CORS header 'Access-Control-Allow-Origin' not allowed/i,
      /Access-Control-Allow-Origin cannot contain more than one origin/i,
    ],
    build: () => ({
      title: 'Access-Control-Allow-Origin is set twice (or holds a list)',
      explanation: 'The header may carry exactly one origin (or *). Two layers are usually adding it: for example a proxy, CDN rule or platform config (next.config.js headers, a load balancer, an nginx add_header) AND your application code. A comma-separated list of origins is not valid either — to allow several origins, check the request Origin against your list and echo the single matching value.',
      steps: [
        'Find every place that sets Access-Control-Allow-Origin (app code, middleware, next.config.js headers(), proxy/CDN rules) and keep exactly one.',
        'To allow several origins, compare the request Origin against an allow-list and echo that one value, with Vary: Origin.',
      ],
      source: SOURCES.mdnMultipleOrigin,
      sources: [SOURCES.chromiumCors, SOURCES.webkitCors, SOURCES.mdnMultipleOrigin],
    }),
  },
  {
    // Chromium kAllowOriginMismatch: "The 'Access-Control-Allow-Origin' header has a value '...' that is not equal to the supplied origin."
    // Firefox (MDN CORSAllowOriginNotMatchingOrigin): "Reason: CORS header 'Access-Control-Allow-Origin' does not match 'xyz'"
    id: 'allow-origin-mismatch',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /'Access-Control-Allow-Origin' header has a value '([^']*)' that is not equal to the supplied origin/i,
      /CORS header 'Access-Control-Allow-Origin' does not match '([^']*)'/i,
    ],
    build: (ctx, m) => {
      const quoted = m && m[1] ? m[1] : null;
      const diff = quoted && ctx.origin ? describeOriginDiff(quoted, ctx.origin) : null;
      return {
        title: 'Access-Control-Allow-Origin does not match your page origin',
        explanation: `The server sent an Access-Control-Allow-Origin value${quoted ? ` ('${quoted}')` : ''} that is not exactly the origin of the page making the request${ctx.origin ? ` (${ctx.origin})` : ''}. The comparison is exact: scheme, host and port must all match, and an origin never has a path or trailing slash.${diff ? ` Difference spotted: ${diff}.` : ''} A hard-coded production origin hit from localhost (or the reverse) is the classic cause.`,
        steps: [
          'Build an allow-list of origins (e.g. production, preview and http://localhost:3000) and echo the one that matches the request Origin.',
          'Store origins as scheme://host[:port] — no trailing slash, no path.',
          'Add Vary: Origin whenever the value depends on the request.',
        ],
        source: SOURCES.mdnOriginMismatch,
        sources: [SOURCES.chromiumCors, SOURCES.mdnOriginMismatch, SOURCES.mdnOrigin],
      };
    },
  },
  {
    // Chromium kInvalidAllowOriginValue: "The 'Access-Control-Allow-Origin' header contains the invalid value '...'."
    id: 'invalid-allow-origin',
    kind: 'cors',
    severity: 'critical',
    patterns: [/'Access-Control-Allow-Origin' header contains the invalid value '([^']*)'/i],
    build: (ctx, m) => ({
      title: `Access-Control-Allow-Origin holds an invalid value${m && m[1] ? `: '${m[1]}'` : ''}`,
      explanation: 'The value must be a single serialised origin — scheme://host with an optional :port — or *. A path, a trailing slash, a missing scheme or a stray space makes it invalid. Origins never include a path or trailing slash.',
      steps: ['Send exactly scheme://host[:port], e.g. https://app.example.com (no trailing slash).'],
      source: SOURCES.mdnOrigin,
      sources: [SOURCES.chromiumCors, SOURCES.mdnOrigin],
    }),
  },
  {
    // Chromium kInvalidAllowCredentials: "The value of the 'Access-Control-Allow-Credentials' header in the response is '...'
    //   which must be 'true' when the request's credentials mode is 'include'."
    // Firefox (MDN CORSMIssingAllowCredentials): "Reason: expected 'true' in CORS header 'Access-Control-Allow-Credentials'"
    // WebKit: "Credentials flag is true, but Access-Control-Allow-Credentials is not \"true\"."
    id: 'allow-credentials-not-true',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /'Access-Control-Allow-Credentials' header in the response is '[^']*' which must be 'true'/i,
      /expected 'true' in CORS header 'Access-Control-Allow-Credentials'/i,
      /Credentials flag is true, but Access-Control-Allow-Credentials is not/i,
    ],
    build: () => ({
      title: "Credentialed request, but Access-Control-Allow-Credentials is not 'true'",
      explanation: "The request carries credentials (credentials: 'include', withCredentials: true, or cookies) and the response does not say Access-Control-Allow-Credentials: true. On a preflighted request this header is required on the preflight response too. Either allow credentials on the server (with an explicit origin, never *) or stop sending them.",
      steps: [
        'Server: add Access-Control-Allow-Credentials: true, with an explicit Access-Control-Allow-Origin and Vary: Origin.',
        "Client alternative: use credentials: 'omit' (fetch) or leave withCredentials off (XHR/axios) if the call does not need cookies.",
      ],
      source: SOURCES.mdnAllowCreds,
      sources: [SOURCES.chromiumCors, SOURCES.webkitCors, SOURCES.mdnAllowCreds, SOURCES.mdnCors],
      credentials: true,
    }),
  },
  {
    // Chromium kPreflightInvalidStatus: "It does not have HTTP ok status."
    // WebKit: "Preflight response is not successful. Status code: " + code
    // Fetch Standard: an ok status is 200-299.
    id: 'preflight-not-ok',
    kind: 'cors',
    severity: 'critical',
    patterns: [/does not have HTTP ok status/i, /Preflight response is not successful/i],
    build: (ctx) => {
      const s = ctx.status;
      const why = preflightStatusWhy(s);
      return {
        title: `The preflight (OPTIONS) request did not return a 2xx status${s ? ` (got ${s})` : ''}`,
        explanation: `Before your real request the browser sent OPTIONS, and the response status was not in the 200-299 "ok" range, so the browser stopped there. ${why}`,
        steps: [
          'Answer OPTIONS for this path with 204 (or 200) and the CORS headers.',
          'Run the OPTIONS handler before auth checks: preflights have no cookies or Authorization header.',
        ],
        source: SOURCES.chromiumCors,
        sources: [SOURCES.chromiumCors, SOURCES.webkitCors, SOURCES.fetchOkStatus, SOURCES.mdnCors],
      };
    },
  },
  {
    // Chromium kPreflightDisallowedRedirect: "Redirect is not allowed for a preflight request."
    // Firefox (MDN CORSExternalRedirectNotAllowed): "Reason: CORS request external redirect not allowed"
    // MDN CORS guide quotes: "...which is disallowed for cross-origin requests that require preflight."
    id: 'preflight-redirect',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /Redirect is not allowed for a preflight request/i,
      /CORS request external redirect not allowed/i,
      /disallowed for cross-origin requests that require preflight/i,
    ],
    build: (ctx) => ({
      title: 'The request was redirected, and a preflighted request cannot follow it',
      explanation: `The server answered with a redirect instead of the resource${ctx.redirectedFrom ? ` (${maskSecrets(ctx.redirectedFrom)} → ${maskSecrets(ctx.url || '')})` : ''}. Common culprits: http → https, apex → www, and trailing-slash normalisation — by default Next.js redirects /api/foo/ to /api/foo. Browsers are inconsistent about redirects after a preflight, and a request preflighted because of an Authorization header cannot be worked around client-side. Call the final URL directly.`,
      steps: [
        'Open the Network tab, find the 3xx response and copy its Location — that is the URL to call.',
        'Match the canonical form exactly: https, the right host (www or not) and the trailing slash your framework expects.',
      ],
      source: SOURCES.mdnCors,
      sources: [SOURCES.chromiumCors, SOURCES.mdnExternalRedirect, SOURCES.mdnCors, SOURCES.nextTrailingSlash],
    }),
  },
  {
    // Chromium kHeaderDisallowedByPreflightResponse: "Request header field ... is not allowed by Access-Control-Allow-Headers in preflight response."
    // WebKit: "Request header field " + name + " is not allowed by Access-Control-Allow-Headers."
    // Firefox, older (MDN CORSMissingAllowHeaderFromPreflight): "missing token 'xyz' in CORS header 'Access-Control-Allow-Headers' from CORS preflight channel"
    // Firefox, current (security.properties CORSMissingAllowHeaderFromPreflight2):
    //   "header 'xyz' is not allowed according to header 'Access-Control-Allow-Headers' from CORS preflight response"
    id: 'header-not-allowed',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /Request header field \S+ is not allowed by Access-Control-Allow-Headers/i,
      /missing token '[^']+' in CORS header 'Access-Control-Allow-Headers'/i,
      /header '[^']+' is not allowed according to header 'Access-Control-Allow-Headers'/i,
    ],
    build: (ctx) => {
      const h = ctx.header || 'the header';
      const supabaseHint = ['x-client-info', 'apikey', 'x-retry-count'].includes(h)
        ? ` ${h} is sent by supabase-js when it calls an Edge Function: the Supabase docs list authorization, apikey, x-client-info, content-type and x-retry-count in the allow-list.`
        : '';
      const authHint = h === 'authorization'
        ? ' Note that Access-Control-Allow-Headers: * does NOT cover Authorization — it must always be listed by name.'
        : '';
      return {
        title: `The preflight response does not allow the request header "${h}"`,
        explanation: `Your request sends ${h}, which is not CORS-safelisted, so the browser asked permission in a preflight — and Access-Control-Allow-Headers in the answer does not list it.${authHint}${supabaseHint}`,
        steps: [
          `Add ${h} to Access-Control-Allow-Headers on the OPTIONS response (header names are case-insensitive).`,
          'Or stop sending the header if you added it by accident (a global axios/fetch interceptor is a common source).',
        ],
        source: SOURCES.mdnHeaderMissing,
        sources: [SOURCES.chromiumCors, SOURCES.webkitPreflight, SOURCES.firefoxStrings, SOURCES.mdnHeaderMissing, SOURCES.mdnAllowHeaders],
      };
    },
  },
  {
    // Chromium kMethodDisallowedByPreflightResponse: "Method ... is not allowed by Access-Control-Allow-Methods in preflight response."
    // WebKit: "Method " + method + " is not allowed by Access-Control-Allow-Methods."
    // Firefox (MDN CORSMethodNotFound): "Reason: Did not find method in CORS header 'Access-Control-Allow-Methods'"
    id: 'method-not-allowed',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /Method \S+ is not allowed by Access-Control-Allow-Methods/i,
      /Did not find method in CORS header 'Access-Control-Allow-Methods'/i,
    ],
    build: (ctx) => ({
      title: `The preflight response does not allow the method${ctx.method ? ` ${ctx.method}` : ''}`,
      explanation: `Methods other than GET, HEAD and POST need to be listed in Access-Control-Allow-Methods on the preflight response. The server's list does not include ${ctx.method || 'the method you used'}.`,
      steps: [`Add ${ctx.method || 'the method'} to Access-Control-Allow-Methods on the OPTIONS response.`],
      source: SOURCES.mdnMethodNotFound,
      sources: [SOURCES.chromiumCors, SOURCES.webkitPreflight, SOURCES.mdnMethodNotFound],
    }),
  },
  {
    // Firefox (MDN CORSInvalidAllowMethod / CORSInvalidAllowHeader): "invalid token 'xyz' in CORS header 'Access-Control-Allow-Methods|Headers'"
    // Chromium: "Cannot parse Access-Control-Allow-Methods|Headers response header field in preflight response."
    // WebKit: "Header Access-Control-Allow-Methods|Headers has an invalid value: ..."
    id: 'invalid-allow-token',
    kind: 'cors',
    severity: 'critical',
    patterns: [
      /invalid token '[^']*' in CORS header 'Access-Control-Allow-(?:Methods|Headers)'/i,
      /Cannot parse Access-Control-Allow-(?:Methods|Headers) response header field/i,
      /Header Access-Control-Allow-(?:Methods|Headers) has an invalid value/i,
    ],
    build: () => ({
      title: 'Access-Control-Allow-Methods or -Headers is malformed',
      explanation: 'The value must be a comma-separated list of method or header names. Separators other than commas (semicolons, quotes, a JSON array printed as a string) make the whole list unparseable.',
      steps: ["Send e.g. Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS and Access-Control-Allow-Headers: Content-Type, Authorization."],
      source: SOURCES.mdnInvalidMethod,
      sources: [SOURCES.mdnInvalidMethod, SOURCES.mdnInvalidHeader, SOURCES.chromiumCors, SOURCES.webkitPreflight],
    }),
  },
  {
    // Firefox (MDN CORSDidNotSucceed): "Reason: CORS request did not succeed" — a network/protocol failure, not a CORS verdict.
    id: 'request-did-not-succeed',
    kind: 'not-cors',
    severity: 'warning',
    patterns: [/CORS request did not succeed/i],
    build: () => ({
      title: 'Not really a CORS problem: the connection itself failed',
      explanation: 'Firefox prints this when the HTTP connection failed at the network or protocol level: DNS failure, timeout, connection refused, TLS handshake or certificate error, mixed content (HTTPS page calling http://), a browser extension blocking the request, or a server that died without answering. No CORS header change will fix it.',
      steps: [
        'Open DevTools → Network and read the failure reason on that request.',
        'Check the API is running on that scheme and port, and that its certificate is valid.',
        'Retry in a private window with extensions disabled.',
      ],
      source: SOURCES.mdnDidNotSucceed,
      sources: [SOURCES.mdnDidNotSucceed],
    }),
  },
  {
    // Firefox, current (security.properties CORSPreflightDidNotSucceed3):
    //   "Reason: CORS preflight response did not succeed). Status code: N."
    // Firefox, older (MDN CORSPreflightDidNotSucceed): "Reason: CORS preflight channel did not succeed"
    id: 'preflight-channel-failed',
    kind: 'cors',
    severity: 'warning',
    patterns: [/CORS preflight response did not succeed/i, /CORS preflight channel did not succeed/i],
    build: (ctx) => {
      const s = ctx.status;
      if (s != null && (s < 200 || s > 299)) {
        return {
          title: `The preflight (OPTIONS) request did not return a 2xx status (got ${s})`,
          explanation: `Before your real request Firefox sent OPTIONS, and it answered ${s} instead of a 200-299 "ok" status, so the browser stopped there. ${preflightStatusWhy(s)}`,
          steps: [
            'Answer OPTIONS for this path with 204 (or 200) and the CORS headers.',
            'Run the OPTIONS handler before auth checks: preflights have no cookies or Authorization header.',
          ],
          source: SOURCES.firefoxStrings,
          sources: [SOURCES.firefoxStrings, SOURCES.mdnPreflightFailed, SOURCES.fetchOkStatus],
        };
      }
      return {
        title: 'The preflight (OPTIONS) request itself failed',
        explanation: 'The preflight could not complete — usually a network error on the OPTIONS request (timeout, connection refused, DNS) or a server that does not answer OPTIONS at all.',
        steps: ['Check the OPTIONS request in DevTools → Network.', 'Make sure the server answers OPTIONS on this path with a 2xx and the CORS headers.'],
        source: SOURCES.mdnPreflightFailed,
        sources: [SOURCES.mdnPreflightFailed, SOURCES.firefoxStrings],
      };
    },
  },
  {
    // Firefox (MDN CORSRequestNotHttp): "Reason: CORS request not HTTP"
    // Chromium kCorsDisabledScheme: "Cross origin requests are only supported for protocol schemes: ..."
    id: 'not-http',
    kind: 'not-cors',
    severity: 'warning',
    patterns: [/CORS request not HTTP/i, /Cross origin requests are only supported for protocol schemes/i],
    build: () => ({
      title: 'The page or resource is not served over HTTP(S) — usually file://',
      explanation: 'CORS only works with http and https URLs. Opening an HTML file straight from disk (file:///…) gives it an opaque origin, so every fetch it makes fails. This is not a server header problem.',
      steps: ['Serve the folder with a local server (e.g. npx http-server or python -m http.server 8000) and open http://localhost:8000 instead.'],
      source: SOURCES.mdnNotHttp,
      sources: [SOURCES.mdnNotHttp, SOURCES.chromiumCors],
    }),
  },
  {
    // Chromium mixed_content_checker.cc: "Mixed Content: The page at '...' was loaded over HTTPS, but requested an insecure ... '...'.
    //   This request has been blocked; the content must be served over HTTPS."
    // MDN: fetch() and XMLHttpRequest are blockable mixed content.
    id: 'mixed-content',
    kind: 'not-cors',
    severity: 'critical',
    // Firefox security.properties BlockMixedActiveContent: "Blocked loading mixed active content “%1$S”"
    patterns: [
      /Mixed Content: The page at '[^']*' was loaded over HTTPS, but requested an insecure/i,
      /Blocked loading mixed active content/i,
    ],
    build: () => ({
      title: 'Not a CORS problem: mixed content (HTTPS page calling an http:// URL)',
      explanation: 'The page is served over HTTPS and your code requested an http:// URL. fetch() and XMLHttpRequest calls to http:// are blocked outright as mixed content — no CORS header can unblock them. Usually an environment variable still points at http://localhost or an http:// API.',
      steps: [
        'Serve the API over HTTPS and call the https:// URL.',
        'Check your production env vars (NEXT_PUBLIC_API_URL and friends) for http:// or localhost.',
      ],
      source: SOURCES.mdnMixed,
      sources: [SOURCES.chromiumMixed, SOURCES.firefoxStrings, SOURCES.mdnMixed],
    }),
  },
];

// ---------------------------------------------------------------------------
// Origin comparison
// ---------------------------------------------------------------------------

/** Human description of why two origins differ ("http vs https", "trailing slash", …). */
export function describeOriginDiff(allowed, actual) {
  if (!allowed || !actual) return null;
  const a = allowed.trim();
  const b = actual.trim();
  if (a === b) return null;
  if (a.replace(/\/+$/, '') === b.replace(/\/+$/, '')) return 'a trailing slash — origins never end with "/"';
  if (a.toLowerCase() === b.toLowerCase()) return 'letter case — the browser compares origins byte for byte, so send the origin exactly as the browser serialises it (lowercase scheme and host)';
  const pa = a.match(/^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/i);
  const pb = b.match(/^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/i);
  if (!pa || !pb) return 'the value is not a valid scheme://host[:port] origin';
  const diffs = [];
  if (pa[1].toLowerCase() !== pb[1].toLowerCase()) diffs.push(`scheme ${pa[1]} vs ${pb[1]}`);
  const ha = pa[2].toLowerCase();
  const hb = pb[2].toLowerCase();
  if (ha !== hb) {
    if (ha.replace(/^www\./, '') === hb.replace(/^www\./, '')) diffs.push(`www vs no www (${ha} vs ${hb})`);
    else diffs.push(`host ${ha} vs ${hb}`);
  }
  if ((pa[3] || '') !== (pb[3] || '')) diffs.push(`port ${pa[3] || '(default)'} vs ${pb[3] || '(default)'}`);
  if (pa[4] && pa[4] !== '/') diffs.push(`a path (${pa[4]}) in the header value`);
  return diffs.length ? diffs.join('; ') : null;
}

// ---------------------------------------------------------------------------
// Header analysis
// ---------------------------------------------------------------------------

function analyseHeaders(h, ctx) {
  const found = [];
  if (!h || (h.count === 0 && h.status == null)) return found;
  const r = h.response;
  const acao = r['access-control-allow-origin'] || [];
  const acac = (r['access-control-allow-credentials'] || [])[0];
  const acah = splitList(r['access-control-allow-headers']);
  const acam = splitList(r['access-control-allow-methods']);
  const vary = splitList(r.vary).map((v) => v.toLowerCase());
  const reqOrigin = stripUserinfo((h.request.origin || [])[0]) || ctx.origin || null;
  const reqHeaders = splitList(h.request['access-control-request-headers']).map((x) => x.toLowerCase());
  const reqMethod = ((h.request['access-control-request-method'] || [])[0] || ctx.method || '').toUpperCase() || null;
  const credentialed = acac && acac.toLowerCase() === 'true';
  const isPreflight = ctx.preflight || h.requestMethod === 'OPTIONS' || Boolean(h.request['access-control-request-method']);
  const push = (f) => found.push({ ...f, fromHeaders: true });

  if (h.status != null && (h.status < 200 || h.status > 299) && isPreflight) {
    if (h.status >= 300 && h.status < 400) {
      const loc = (r.location || [])[0];
      push({
        id: 'preflight-redirect',
        evidence: `HTTP ${h.status}${loc ? ` → Location: ${maskSecrets(loc)}` : ''}`,
      });
    } else {
      push({ id: 'preflight-not-ok', evidence: `OPTIONS answered HTTP ${h.status}`, status: h.status });
    }
  }

  if (acao.length === 0 && h.count > 0) {
    push({ id: 'missing-allow-origin', evidence: 'No Access-Control-Allow-Origin in the pasted response headers.' });
  }
  if (acao.length > 1 || acao.some((v) => /[,\s]/.test(v.trim()))) {
    push({ id: 'multiple-allow-origin', evidence: acao.map((v) => `Access-Control-Allow-Origin: ${v}`).join('\n') });
  }
  if (acao.length === 1) {
    const v = acao[0].trim();
    if (v === '*' && credentialed) {
      push({ id: 'wildcard-with-credentials', evidence: 'Access-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true' });
    } else if (v !== '*' && v !== 'null' && !/[,\s]/.test(v)) {
      if (!/^[a-z][a-z0-9+.-]*:\/\/[^/\s]+$/i.test(v)) {
        push({ id: 'invalid-allow-origin', evidence: `Access-Control-Allow-Origin: ${v}`, value: v });
      } else if (reqOrigin && reqOrigin !== 'null' && v !== reqOrigin) {
        // Fetch Standard CORS check: byte-for-byte comparison, no case folding.
        push({ id: 'allow-origin-mismatch', evidence: `Access-Control-Allow-Origin: ${v} (page origin ${reqOrigin})`, value: v });
      }
      if (!vary.includes('origin') && !vary.includes('*')) {
        push({ id: 'vary-origin-missing', evidence: `Access-Control-Allow-Origin: ${v} without Vary: Origin` });
      }
    }
  }

  const blocked = new Set(reqHeaders);
  if (ctx.header) blocked.add(ctx.header);
  const acahLower = acah.map((x) => x.toLowerCase());
  const acahWildcard = acahLower.includes('*');
  if (blocked.has('authorization') && acahWildcard && !acahLower.includes('authorization')) {
    push({ id: 'auth-not-covered-by-wildcard', evidence: 'Access-Control-Allow-Headers: * (Authorization requested)' });
  }
  if (credentialed && (acahWildcard || acam.includes('*'))) {
    push({ id: 'wildcard-lists-with-credentials', evidence: `${acahWildcard ? 'Access-Control-Allow-Headers: *' : ''}${acahWildcard && acam.includes('*') ? '\n' : ''}${acam.includes('*') ? 'Access-Control-Allow-Methods: *' : ''}\nAccess-Control-Allow-Credentials: true` });
  }
  if (isPreflight && acah.length > 0 && !acahWildcard) {
    const missing = [...blocked].filter((x) => x && !acahLower.includes(x));
    if (missing.length) push({ id: 'header-not-allowed', evidence: `Access-Control-Allow-Headers: ${acah.join(', ')} — missing ${missing.join(', ')}`, missing });
  }
  if (isPreflight && reqMethod && !SIMPLE_METHODS.has(reqMethod) && acam.length > 0 && !acam.includes('*')) {
    if (!acam.map((x) => x.toUpperCase()).includes(reqMethod)) {
      push({ id: 'method-not-allowed', evidence: `Access-Control-Allow-Methods: ${acam.join(', ')} — missing ${reqMethod}` });
    }
  }
  return found;
}

// Findings that only come from header analysis.
const HEADER_ONLY = {
  'vary-origin-missing': {
    kind: 'hint',
    severity: 'info',
    title: 'Access-Control-Allow-Origin names a specific origin, but Vary: Origin is missing',
    explanation: 'When the allowed origin depends on the request, the response should carry Vary: Origin. Without it a CDN or browser cache can serve a response built for one origin to another, which shows up as intermittent CORS errors after a deploy or on a second site.',
    steps: ['Add Vary: Origin to every response whose Access-Control-Allow-Origin is computed from the request.'],
    source: SOURCES.mdnCors,
    sources: [SOURCES.mdnCors, SOURCES.mdnMissingOrigin],
  },
  'auth-not-covered-by-wildcard': {
    kind: 'cors',
    severity: 'critical',
    title: 'Access-Control-Allow-Headers: * does not cover Authorization',
    explanation: 'The wildcard in Access-Control-Allow-Headers never matches Authorization — the Fetch Standard classes it as a "non-wildcard request-header name", so it must be listed by name. (And with credentials, * is not a wildcard at all.)',
    steps: ['Send Access-Control-Allow-Headers: Authorization, Content-Type (plus any other custom headers you use).'],
    source: SOURCES.mdnAllowHeaders,
    sources: [SOURCES.mdnAllowHeaders, SOURCES.fetchNonWildcard],
  },
  'wildcard-lists-with-credentials': {
    kind: 'cors',
    severity: 'warning',
    title: 'With credentials, * in Allow-Headers / Allow-Methods is taken literally',
    explanation: 'For credentialed requests the server must list header names and methods explicitly: * is treated as the literal name "*", not a wildcard, so a custom header or PUT/DELETE will still be refused.',
    steps: ['Replace * with explicit lists, e.g. Access-Control-Allow-Headers: Content-Type, Authorization and Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS.'],
    source: SOURCES.mdnCors,
    sources: [SOURCES.mdnCors, SOURCES.mdnAllowHeaders],
    credentials: true,
  },
};

// ---------------------------------------------------------------------------
// Fix snippets
// ---------------------------------------------------------------------------

const BASE_HEADERS = ['Content-Type', 'Authorization'];
const BASE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function headerCase(name) {
  return name.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join('-');
}

/**
 * Build the fix-parameter object from the diagnosis context.
 * origin: the page origin to allow; credentials: whether to emit Allow-Credentials;
 * headers / methods: allow-lists including anything the error said was missing.
 */
export function fixParams(ctx = {}, opts = {}) {
  let origin = ctx.origin && ctx.origin !== 'null' ? toOrigin(ctx.origin) : null;
  if (!origin) origin = 'https://app.example.com';
  const headers = [...BASE_HEADERS];
  const extra = [ctx.header, ...(opts.extraHeaders || [])].filter(Boolean);
  for (const h of extra) {
    if (!headers.some((x) => x.toLowerCase() === h.toLowerCase())) headers.push(headerCase(h));
  }
  const methods = [...BASE_METHODS];
  if (ctx.method && !methods.includes(ctx.method) && /^[A-Z]+$/.test(ctx.method)) methods.splice(methods.length - 1, 0, ctx.method);
  return { origin, credentials: Boolean(opts.credentials), headers, methods };
}

/** Return { code, filename, notes[], source } for a stack. */
export function buildFix(stack, params) {
  const p = params || fixParams();
  const origin = p.origin;
  const methods = p.methods.join(', ');
  const headers = p.headers.join(', ');
  const credLineObj = p.credentials ? "\n    'Access-Control-Allow-Credentials': 'true'," : '';
  const credComment = p.credentials
    ? ''
    : "\n    // Add 'Access-Control-Allow-Credentials': 'true' only if the browser sends cookies (credentials: 'include').";

  switch (stack) {
    case 'nextjs-middleware':
      return {
        filename: 'middleware.js',
        code: `import { NextResponse } from 'next/server'

const allowedOrigins = ['${origin}']

const corsOptions = {
  'Access-Control-Allow-Methods': '${methods}',
  'Access-Control-Allow-Headers': '${headers}',${p.credentials ? "\n  'Access-Control-Allow-Credentials': 'true'," : ''}
}

export function middleware(request) {
  const origin = request.headers.get('origin') ?? ''
  const isAllowedOrigin = allowedOrigins.includes(origin)

  // Answer the preflight here, before any auth check (preflights carry no credentials)
  if (request.method === 'OPTIONS') {
    const preflightHeaders = {
      ...(isAllowedOrigin && { 'Access-Control-Allow-Origin': origin }),
      ...corsOptions,
      Vary: 'Origin',
    }
    return new NextResponse(null, { status: 204, headers: preflightHeaders })
  }

  const response = NextResponse.next()
  if (isAllowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', origin)
  }
  Object.entries(corsOptions).forEach(([key, value]) => response.headers.set(key, value))
  response.headers.append('Vary', 'Origin')
  return response
}

export const config = {
  matcher: '/api/:path*',
}`,
        notes: [
          'Adapted from the CORS example in the Next.js 15 middleware docs, plus Vary: Origin.',
          'Next.js 16 and later: the middleware convention is deprecated and renamed to proxy — name the file proxy.js and write export function proxy(request) instead (same body). The codemod npx @next/codemod@canary middleware-to-proxy . does the rename.',
          'The file lives at the project root, or in src/ next to app/ — elsewhere it never runs.',
          'Do not also set Access-Control-Allow-Origin in next.config.js headers() or in the route: two layers setting it produces the "multiple values" error.',
        ],
        source: SOURCES.nextMiddleware,
        sources: [SOURCES.nextMiddleware, SOURCES.nextProxy],
      };
    case 'supabase-edge': {
      // Headers already in the SDK allow-list (Supabase CORS guide).
      const sdkHeaders = ['authorization', 'apikey', 'x-client-info', 'content-type', 'x-retry-count'];
      const extraSb = p.headers.map((h) => h.toLowerCase()).filter((h) => !sdkHeaders.includes(h));
      return {
        filename: 'supabase/functions/<name>/index.ts',
        code: `// supabase-js v2.95.0+ exports the headers its client sends.
import { corsHeaders } from 'npm:@supabase/supabase-js@^2/cors'
${extraSb.length
          ? `
// Your request also sends: ${extraSb.join(', ')}.
// Extend the SDK list instead of replacing it:
const baseHeaders = {
  ...corsHeaders,
  'Access-Control-Allow-Headers': \`\${corsHeaders['Access-Control-Allow-Headers']}, ${extraSb.join(', ')}\`,
}
`
          : `
const baseHeaders = corsHeaders
`}${p.credentials
          ? `
// Credentialed requests (cookies / credentials: 'include') need an explicit origin, never '*'.
const ALLOWED_ORIGINS = ['${origin}']

function cors(req) {
  const origin = req.headers.get('origin')
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return baseHeaders
  return {
    ...baseHeaders,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}
`
          : `
const cors = (req) => baseHeaders
`}
export default {
  fetch: async (req) => {
    const headers = cors(req)
    // Handle the CORS preflight request.
    if (req.method === 'OPTIONS') {
      return Response.json({ ok: true }, { headers })
    }

    try {
      const { name } = await req.json()
      return Response.json({ message: \`Hello \${name}!\` }, { headers })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Error responses need the CORS headers too
      return Response.json({ error: message }, { status: 400, headers })
    }
  },
}`,
        notes: [
          'Pattern from the Supabase Edge Functions CORS guide. Older supabase-js (before v2.95.0): define corsHeaders yourself in supabase/functions/_shared/cors.ts, as the guide shows.',
          p.credentials
            ? "Credentials are involved, so the snippet overrides Access-Control-Allow-Origin with your exact origin (a credentialed request cannot use *; the guide's legacy _shared/cors.ts uses *) and adds Access-Control-Allow-Credentials: true and Vary: Origin."
            : 'supabase-js sends authorization, apikey, x-client-info and content-type on every call — the allow-list must keep them.',
        ],
        source: SOURCES.supabaseCors,
      };
    }
    case 'express':
      return {
        filename: 'server.js',
        code: `const express = require('express')
const cors = require('cors')

const app = express()

const corsOptions = {
  origin: ['${origin}'],          // exact origins, no trailing slash
  methods: '${p.methods.filter((m) => m !== 'OPTIONS').join(',')}',
  allowedHeaders: '${headers}',${p.credentials ? '\n  credentials: true,             // sends Access-Control-Allow-Credentials: true' : ''}
}

// Register BEFORE your routes and auth middleware:
// as application-level middleware it also answers preflight (OPTIONS) requests.
app.use(cors(corsOptions))

app.use(express.json())
// ...your routes

// Keep error responses going through the same app so they carry the CORS headers.
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal error' })
})`,
        notes: [
          'Uses the official cors middleware (npm i cors). Per its README, an array origin is checked against the request and, for specific origins, Vary: Origin is added.',
          'If a reverse proxy (nginx, a PaaS router) also adds Access-Control-Allow-Origin, remove one of the two.',
        ],
        source: SOURCES.expressCors,
      };
    case 'cloudflare-worker':
      return {
        filename: 'src/index.js',
        code: `const ALLOWED_ORIGINS = ['${origin}']

function corsHeaders(request) {
  const origin = request.headers.get('Origin')
  const headers = {
    'Access-Control-Allow-Methods': '${methods}',
    'Access-Control-Allow-Headers': '${headers}',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin${p.credentials ? "\n    headers['Access-Control-Allow-Credentials'] = 'true'" : ''}
  }
  return headers
}

export default {
  async fetch(request, env) {
    // A preflight is OPTIONS + Origin + Access-Control-Request-Method.
    // (Access-Control-Request-Headers is absent when no custom header is sent.)
    if (
      request.method === 'OPTIONS' &&
      request.headers.get('Origin') !== null &&
      request.headers.get('Access-Control-Request-Method') !== null
    ) {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    let response
    try {
      response = await handle(request, env)
    } catch (err) {
      response = Response.json({ error: 'Internal error' }, { status: 500 })
    }
    // Copy so the headers are mutable, then add CORS to every response, errors included
    response = new Response(response.body, response)
    for (const [k, v] of Object.entries(corsHeaders(request))) response.headers.set(k, v)
    return response
  },
}

async function handle(request, env) {
  return Response.json({ ok: true })
}`,
        notes: [
          'Based on the Cloudflare Workers CORS example (handleOptions, Vary: Origin), with the preflight test keyed on Origin + Access-Control-Request-Method so PUT/DELETE preflights without custom headers are handled too.',
        ],
        source: SOURCES.cfWorkerCors,
      };
    case 'nextjs-route':
    default:
      return {
        filename: 'app/api/<route>/route.js',
        code: `const allowedOrigins = ['${origin}']

function corsHeaders(request) {
  const origin = request.headers.get('origin')
  const headers = {
    'Access-Control-Allow-Methods': '${methods}',
    'Access-Control-Allow-Headers': '${headers}',${credLineObj}${credComment}
    Vary: 'Origin',
  }
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  return headers
}

// Export OPTIONS yourself: the automatic one is only documented to set the Allow header.
export async function OPTIONS(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

export async function GET(request) {
  try {
    return Response.json({ ok: true }, { headers: corsHeaders(request) })
  } catch (error) {
    // Error responses need the CORS headers too, or the 500 shows up as a CORS error
    return Response.json({ error: 'Internal error' }, { status: 500, headers: corsHeaders(request) })
  }
}`,
        notes: [
          'The Next.js docs: "If OPTIONS is not defined, Next.js will automatically implement OPTIONS and set the appropriate Response Allow header" — that response is not documented to carry your CORS headers, so define OPTIONS.',
          'Apply corsHeaders(request) in every exported method (POST, PUT…), and in their error branches.',
          'Several routes? Move the same logic into middleware.js (pick "Next.js middleware").',
        ],
        source: SOURCES.nextRoute,
      };
  }
}

// ---------------------------------------------------------------------------
// Stack guess
// ---------------------------------------------------------------------------

/** Guess a stack from the request URL when the user has not chosen one. */
export function guessStack(ctx) {
  const u = (ctx && ctx.url) || '';
  if (/\.supabase\.co\/functions\/v1\//i.test(u) || /\/functions\/v1\//i.test(u)) return 'supabase-edge';
  if (/\.workers\.dev\b/i.test(u)) return 'cloudflare-worker';
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const KIND_ORDER = { 'not-cors': 0, cors: 1, hint: 2 };

function ruleById(id) {
  return RULES.find((r) => r.id === id);
}

/**
 * Diagnose a pasted CORS error.
 * @param {{ error?: string, headers?: string, stack?: string }} input
 * @returns {{ empty: boolean, recognised: boolean, isCorsProblem: boolean|null,
 *   context: object, findings: object[], stack: string, stackGuessed: boolean, fix: object|null }}
 */
export function diagnose(input = {}) {
  const errorText = typeof input.error === 'string' ? input.error : '';
  const headerText = typeof input.headers === 'string' ? input.headers : '';
  const empty = !errorText.trim() && !headerText.trim();
  const ctx = parseConsoleError(errorText);
  const hdrs = parseHeaders(headerText);
  if (!ctx.origin && hdrs.request.origin) ctx.origin = stripUserinfo(hdrs.request.origin[0]);
  if (!ctx.preflight && (hdrs.requestMethod === 'OPTIONS' || hdrs.request['access-control-request-method'])) ctx.preflight = true;
  if (!ctx.method && hdrs.request['access-control-request-method']) ctx.method = hdrs.request['access-control-request-method'][0].toUpperCase();
  if (ctx.status == null && hdrs.status != null && ctx.preflight) ctx.status = hdrs.status;

  const text = normalise(errorText);
  const byId = new Map();
  const add = (id, base, extra = {}) => {
    const prev = byId.get(id);
    if (prev) {
      if (extra.evidence) prev.evidence = [prev.evidence, extra.evidence].filter(Boolean).join('\n');
      if (extra.fromHeaders) prev.confirmedByHeaders = true;
      return;
    }
    byId.set(id, { id, ...base, evidence: extra.evidence || null, fromHeaders: Boolean(extra.fromHeaders), confirmedByHeaders: false });
  };

  let credentials = /credentials\s*:\s*['"]include['"]|withCredentials\s*[:=]\s*true/i.test(text);

  // 1) console text rules
  for (const rule of RULES) {
    let match = null;
    for (const re of rule.patterns) {
      match = text.match(re);
      if (match) break;
    }
    if (!match) continue;
    const built = rule.build(ctx, match);
    if (built.credentials) credentials = true;
    add(rule.id, { kind: rule.kind, severity: rule.severity, ...built }, { evidence: maskSecrets(match[0]) });
  }

  // Firefox security.properties CORSAllowHeaderFromPreflightDeprecation (backticks become ' in normalise()):
  // "When the 'Access-Control-Allow-Headers' is '*', the 'Authorization' header is not covered."
  const ffAuthWildcard = text.match(/the '?Authorization'? header is not covered/i);
  if (ffAuthWildcard) {
    const base = HEADER_ONLY['auth-not-covered-by-wildcard'];
    add('auth-not-covered-by-wildcard', {
      ...base,
      explanation: `${base.explanation} Firefox only warns for now ("will disallow … soon"), but the standard already excludes Authorization from the wildcard, so list it by name.`,
      sources: [...base.sources, SOURCES.firefoxStrings],
    }, { evidence: maskSecrets(ffAuthWildcard[0]) });
    ctx.preflight = true;
    if (!ctx.header) ctx.header = 'authorization';
  }

  // Safari's generic line on its own — WebKit ThreadableLoader.cpp:
  // "<Fetch API|XMLHttpRequest|EventSource> cannot load <url> due to access control checks."
  const safariGeneric = /cannot load \S+ due to access control checks/i.test(text);

  // 2) header rules
  for (const f of analyseHeaders(hdrs, ctx)) {
    if (HEADER_ONLY[f.id]) {
      if (HEADER_ONLY[f.id].credentials) credentials = true;
      add(f.id, { ...HEADER_ONLY[f.id] }, f);
      continue;
    }
    const rule = ruleById(f.id);
    if (!rule) continue;
    if (!byId.has(f.id)) {
      const hctx = { ...ctx, status: f.status != null ? f.status : ctx.status, preflight: ctx.preflight || f.id.startsWith('preflight') };
      if (f.id === 'header-not-allowed' && f.missing && f.missing.length) hctx.header = f.missing[0];
      const m = f.value ? [null, f.value] : null;
      const built = rule.build(hctx, m);
      if (built.credentials) credentials = true;
      add(f.id, { kind: rule.kind, severity: rule.severity, ...built }, f);
    } else {
      add(f.id, null, f);
    }
  }
  if (hdrs.response['access-control-allow-credentials'] && /true/i.test(hdrs.response['access-control-allow-credentials'][0])) credentials = true;

  // 3) "not really CORS" detectors that depend on combinations
  const corsHeadline = byId.has('missing-allow-origin') || byId.has('origin-not-allowed');
  const serverStatus = ctx.status != null ? ctx.status : (hdrs.status != null && !ctx.preflight ? hdrs.status : null);
  // Firefox's missing-ACAO line (security.properties CORSMissingAllowOrigin2) always carries
  // "Status code: N" and never says whether the preflight or the real request got it (Chrome
  // and Safari do: "Response to preflight request…" / "Preflight response is not successful").
  // A header-only paste has the same blind spot. There, 404/405/401/403 are exactly the
  // statuses an unhandled or auth-guarded OPTIONS returns, so do NOT call it "not CORS".
  const preflightUnknown = !ctx.preflight && ctx.browser !== 'chrome' && ctx.browser !== 'safari';
  const AMBIGUOUS = new Set([401, 403, 404, 405]);
  if (corsHeadline && preflightUnknown && serverStatus != null && AMBIGUOUS.has(serverStatus)) {
    const who = ctx.browser === 'firefox' ? 'Firefox does' : 'What you pasted does';
    const s = serverStatus;
    let why;
    if (s === 405) why = 'A 405 with no CORS headers most often means nothing answers OPTIONS on this path — the router only registered GET/POST, so the preflight is refused before your handler runs. Answer OPTIONS with 204 and the CORS headers. If the Network tab shows the 405 on the real request instead, that method is not routed: fix the route.';
    else if (s === 404) why = 'Either OPTIONS is not routed on this path (the preflight 404s before your handler runs), or the URL itself is wrong. The Network tab shows which of the two requests got the 404: for OPTIONS, answer it with 204 and the CORS headers; for the real request, fix the URL.';
    else why = `If the OPTIONS preflight got the ${s}, auth middleware ran on it — preflights never carry cookies or an Authorization header, so let OPTIONS through before any auth check. If the real request got it, the credentials were refused and the error response lacked CORS headers: send them on error responses too, then fix the auth problem.`;
    add('preflight-maybe-unhandled', {
      kind: 'cors',
      severity: 'critical',
      title: `Got ${s} with no Access-Control-Allow-Origin — check whether the OPTIONS preflight got it`,
      explanation: `${who} not say whether this ${s} came from the OPTIONS preflight or from your real request. ${why}`,
      steps: [
        'DevTools → Network: find the OPTIONS request for this URL (tick "All", not "Fetch/XHR" only) and read its status.',
        `If OPTIONS got the ${s}: handle OPTIONS for this path with a 2xx and the CORS headers, before any auth check.`,
        'Make sure error responses (4xx/5xx) carry the CORS headers too.',
      ],
      source: SOURCES.firefoxStrings,
      sources: [SOURCES.firefoxStrings, SOURCES.mdnMissingOrigin, SOURCES.fetchOkStatus],
    });
  } else if (corsHeadline && !ctx.preflight && serverStatus != null && serverStatus >= 400) {
    // Supabase CORS guide returns corsHeaders on its error path; MDN CORSMissingAllowOrigin — the header must be on the response the browser got.
    add('server-error-behind-cors', {
      kind: 'not-cors',
      severity: 'critical',
      title: `Look at the ${serverStatus} first: the server failed, and its error response had no CORS headers`,
      explanation: `The request reached your server and it answered ${serverStatus}${serverStatus >= 500 ? ' — it crashed or threw' : ''}. That error response did not carry Access-Control-Allow-Origin, so the browser reports a CORS error and hides the real one from your JavaScript. Adding CORS headers to error responses will reveal the ${serverStatus}; it will not fix it. Check the server logs for this request.`,
      steps: [
        `Find the ${serverStatus} in your server/function logs (Vercel/Cloudflare/Supabase logs, or the terminal) and fix that first.`,
        'Then make every error branch return the CORS headers, so the next failure shows its real status in the browser.',
      ],
      source: SOURCES.supabaseCors,
      sources: [SOURCES.supabaseCors, SOURCES.mdnMissingOrigin],
    });
  }

  // no-cors / opaque misunderstanding — MDN Request.mode + MDN CORS errors (client-side considerations);
  // Chromium's console suggestion ("If an opaque response serves your needs, set the request's mode to 'no-cors'")
  // is quoted on chromium.org.
  const CHROME_SUFFIX = /If an opaque response serves your needs,? set the request'?s mode to 'no-cors'[^.]*\.?/gi;
  const chromeSuggests = /set the request'?s mode to 'no-cors'/i.test(text);
  const withoutSuffix = text.replace(CHROME_SUFFIX, ' ');
  const usesNoCors = /mode\s*:\s*['"]no-cors['"]|type\s*:\s*['"]opaque['"]|\bopaque response\b/i.test(withoutSuffix);
  if (usesNoCors) {
    add('no-cors-opaque', {
      kind: 'not-cors',
      severity: 'warning',
      title: "mode: 'no-cors' does not bypass CORS — it hides the response from you",
      explanation: "With mode: 'no-cors' the request is sent but the response is opaque: status 0, empty headers and a body your JavaScript cannot read. So response.json() fails or returns nothing, and it looks like a new bug. no-cors only suits fire-and-forget calls (logging, beacons). To read the data, fix the server's CORS headers or call the API from your own server.",
      steps: [
        "Remove mode: 'no-cors'.",
        'Fix the CORS headers on the API — or, if you do not control it, proxy the call through your own route handler / Edge Function (server-to-server calls are not subject to CORS).',
      ],
      source: SOURCES.mdnRequestMode,
      sources: [SOURCES.mdnRequestMode, SOURCES.mdnErrors],
    });
  } else if (chromeSuggests) {
    add('no-cors-suggestion', {
      kind: 'hint',
      severity: 'info',
      title: "Ignore Chrome's \"set the request's mode to 'no-cors'\" suggestion",
      explanation: "Chrome appends that sentence to missing-header errors. It will not give you the data: a no-cors response is opaque — status 0, no headers, unreadable body. It only helps for requests whose response you never read.",
      steps: ['Fix the server headers (above) instead, or proxy through your own backend if you do not control the API.'],
      source: SOURCES.mdnErrors,
      sources: [SOURCES.chromiumNoCors, SOURCES.mdnErrors, SOURCES.mdnRequestMode],
    });
  }

  if (safariGeneric && ![...byId.values()].some((f) => f.kind === 'cors')) {
    add('safari-generic', {
      kind: 'hint',
      severity: 'info',
      title: 'Safari says only "due to access control checks" — the reason is elsewhere',
      explanation: 'This WebKit line only says the load failed an access-control check. Copy every related line from the Web Inspector console (reasons such as "Origin … is not allowed by Access-Control-Allow-Origin", "Preflight response is not successful" or "Request header field … is not allowed"), or paste the response headers below, to get a specific diagnosis.',
      steps: ['Paste all CORS-related console lines, or the output of curl -i for the failing URL, and run again.'],
      source: SOURCES.webkitThreadable,
      sources: [SOURCES.webkitThreadable, SOURCES.webkitCors],
    });
  }

  // Generic fallback: a CORS block with no specific reason recognised.
  const blockedGeneric = /has been blocked by CORS policy|Cross-Origin Request Blocked/i.test(text);
  if (byId.size === 0 && blockedGeneric) {
    add('unrecognised-cors', {
      kind: 'hint',
      severity: 'info',
      title: 'A CORS block, but the reason was not in what you pasted',
      explanation: 'The browser blocked a cross-origin request, but the specific reason (the part after "blocked by CORS policy:" in Chrome, or inside "(Reason: …)" in Firefox) is missing or not one this tool knows. Paste the full console line, plus the response headers of the failing request.',
      steps: ['Copy the whole console message, including the reason.', 'Paste the response headers (curl -i -X OPTIONS <url> -H "Origin: <your origin>").'],
      source: SOURCES.mdnErrors,
      sources: [SOURCES.mdnErrors],
    });
  }

  const findings = [...byId.values()].sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const recognised = findings.length > 0;
  const hasCors = findings.some((f) => f.kind === 'cors');
  const hasNotCors = findings.some((f) => f.kind === 'not-cors');
  // A critical "not really CORS" finding (mixed content, a 5xx behind the CORS line)
  // means the CORS message is a symptom: fix the root cause first.
  const rootCauseElsewhere = findings.some((f) => f.kind === 'not-cors' && f.severity === 'critical');
  let isCorsProblem = null;
  if (rootCauseElsewhere) isCorsProblem = false;
  else if (hasCors) isCorsProblem = true;
  else if (hasNotCors) isCorsProblem = false;

  const chosen = STACK_IDS.has(input.stack) ? input.stack : null;
  const guessed = chosen ? null : guessStack(ctx);
  const stack = chosen || guessed || 'nextjs-route';
  const needsServerFix = hasCors || byId.has('server-error-behind-cors') || byId.has('no-cors-opaque');
  const fix = needsServerFix ? buildFix(stack, fixParams(ctx, { credentials })) : null;

  const safeContext = {
    browser: ctx.browser,
    requestKind: ctx.requestKind,
    url: ctx.url ? maskSecrets(ctx.url) : null,
    redirectedFrom: ctx.redirectedFrom ? maskSecrets(ctx.redirectedFrom) : null,
    origin: ctx.origin ? maskSecrets(ctx.origin) : null,
    preflight: ctx.preflight,
    status: ctx.status,
    method: ctx.method,
    header: ctx.header,
    credentials,
  };

  return {
    empty,
    recognised,
    isCorsProblem,
    context: safeContext,
    // Defence in depth: everything built from pasted text is masked on the way out.
    findings: findings.map((f) => ({
      ...f,
      title: maskSecrets(f.title),
      explanation: maskSecrets(f.explanation),
      steps: (f.steps || []).map((x) => maskSecrets(x)),
      evidence: f.evidence ? maskSecrets(f.evidence) : null,
    })),
    stack,
    stackGuessed: Boolean(guessed),
    fix: fix ? { ...fix, code: maskSecrets(fix.code) } : null,
  };
}

// Example inputs for the UI "Try an example" buttons (real wordings from the sources above).
export const EXAMPLES = [
  {
    id: 'chrome-preflight-auth',
    label: 'Chrome — Authorization header refused',
    error: "Access to fetch at 'https://api.example.com/v1/orders' from origin 'http://localhost:3000' has been blocked by CORS policy: Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response.",
    headers: 'HTTP/2 204\naccess-control-allow-origin: http://localhost:3000\naccess-control-allow-methods: GET, POST, OPTIONS\naccess-control-allow-headers: *',
  },
  {
    id: 'chrome-500',
    label: 'Chrome — a 500 hiding behind CORS',
    error: "Access to fetch at 'https://api.example.com/v1/report' from origin 'https://app.example.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.\nGET https://api.example.com/v1/report net::ERR_FAILED 500 (Internal Server Error)",
    headers: '',
  },
  {
    id: 'firefox-credentials',
    label: "Firefox — '*' with cookies",
    error: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/me. (Reason: Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '*').",
    headers: '',
  },
];
