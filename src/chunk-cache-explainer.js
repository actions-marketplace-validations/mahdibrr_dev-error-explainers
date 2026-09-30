// chunk-cache-explainer — pure logic behind the ChunkLoadError / deploy-cache
// header explainer (src/components/tools/ChunkCacheExplainer.jsx).
//
// Input : the raw response headers (`curl -I`, `curl -sIL`, `curl -v` or a
//         DevTools copy) of (a) the HTML document and (b) one hashed chunk
//         under /_next/static/, an optional host and a service-worker flag.
// Output: findings { ruleId, severity, title, why, fix, source } + passes.
//
// No React, no DOM, no network. Every diagnostic rule below names the primary
// source it was verified against (fetched 2026-09-25); the same URL travels on
// each finding as `source` so the UI can link it. Rules that could not be
// verified were dropped (see DROPPED_RULES at the bottom).

// ---------------------------------------------------------------------------
// Primary sources
// ---------------------------------------------------------------------------

export const SOURCES = {
  nextSelfHosting: 'https://nextjs.org/docs/app/guides/self-hosting',
  nextHeadersCacheControl: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/headers#cache-control',
  nextDeploymentId: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId',
  nextProxyMatcher: 'https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher',
  rfc9111MaxAge: 'https://www.rfc-editor.org/rfc/rfc9111.html#name-max-age-2',
  rfc9111FreshnessLifetime: 'https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet',
  rfc9111Heuristic: 'https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-heuristic-fresh',
  rfc9110StatusCodes: 'https://www.rfc-editor.org/rfc/rfc9110.html#name-status-codes',
  rfc9110Redirection:'https://www.rfc-editor.org/rfc/rfc9110.html#name-redirection-3xx',
  rfc9110NotModified: 'https://www.rfc-editor.org/rfc/rfc9110.html#name-304-not-modified',
  htmlFetchClassicScript: 'https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-script',
  htmlLinkStylesheet: 'https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet',
  s3GetObject: 'https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html',
  rfc9111SMaxage: 'https://www.rfc-editor.org/rfc/rfc9111.html#name-s-maxage',
  rfc8246Immutable: 'https://www.rfc-editor.org/rfc/rfc8246.html',
  rfc9211CacheStatus: 'https://www.rfc-editor.org/rfc/rfc9211.html',
  mdnAge: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Age',
  mdnNosniff: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options',
  mdnCache: 'https://developer.mozilla.org/en-US/docs/Web/API/Cache',
  mdnServiceWorkers: 'https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers',
  webpackChunkRuntime: 'https://github.com/webpack/webpack/blob/main/lib/web/JsonpChunkLoadingRuntimeModule.js',
  cfCacheStatus: 'https://developers.cloudflare.com/cache/concepts/cache-responses/',
  cfDefaultCache: 'https://developers.cloudflare.com/cache/concepts/default-cache-behavior/',
  cfStatusCodeTtl: 'https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/',
  cfPagesServing: 'https://developers.cloudflare.com/pages/configuration/serving-pages/',
  vercelResponseHeaders: 'https://vercel.com/docs/headers/response-headers',
  vercelSkewProtection: 'https://vercel.com/docs/skew-protection',
  netlifyCaching: 'https://docs.netlify.com/platform/caching/',
  nginxUpstreamCacheStatus: 'https://nginx.org/en/docs/http/ngx_http_upstream_module.html#var_upstream_cache_status',
  nginxProxyCacheValid: 'https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache_valid',
  nginxTryFiles: 'https://nginx.org/en/docs/http/ngx_http_core_module.html#try_files',
};

export const HOSTS = [
  { id: 'auto', label: 'Detect from headers' },
  { id: 'vercel', label: 'Vercel' },
  { id: 'cloudflare', label: 'Cloudflare' },
  { id: 'netlify', label: 'Netlify' },
  { id: 'nginx', label: 'nginx / self-hosted' },
  { id: 'other', label: 'Other' },
];

// Registry: one entry per rule the diagnoser can emit. `source` is the
// primary document the rule was verified against.
export const RULES = [
  { id: 'input-missing', summary: 'One of the two header blocks was not pasted.', source: SOURCES.nextSelfHosting },
  { id: 'input-unparsed', summary: 'Pasted text contains no HTTP status line or header.', source: SOURCES.rfc9111MaxAge },
  { id: 'input-no-status', summary: 'Headers were pasted without a status line, so the response code is unknown.', source: SOURCES.rfc9110StatusCodes },
  { id: 'html-redirect', summary: 'The "page" paste is a 3xx redirect, not the HTML document.', source: SOURCES.rfc9110Redirection },
  { id: 'html-immutable', summary: 'HTML document marked immutable with a positive max-age.', source: SOURCES.rfc8246Immutable },
  { id: 'html-browser-max-age', summary: 'HTML document is fresh in the browser cache for max-age seconds.', source: SOURCES.rfc9111MaxAge },
  { id: 'html-expires', summary: 'HTML document is fresh in the browser cache until its Expires date (no max-age).', source: SOURCES.rfc9111FreshnessLifetime },
  { id: 'html-heuristic-freshness', summary: 'HTML with Last-Modified and no explicit freshness can be reused heuristically.', source: SOURCES.rfc9111Heuristic },
  { id: 'html-shared-cacheable', summary: 'HTML document is storable by a shared cache (s-maxage / CDN-Cache-Control).', source: SOURCES.rfc9111SMaxage },
  { id: 'html-cf-cache-hit', summary: 'Cloudflare served the HTML from its cache (HTML is not cached by default).', source: SOURCES.cfDefaultCache },
  { id: 'html-cf-cache-eligible', summary: 'Cloudflare treats the HTML as cache-eligible (MISS / EXPIRED / BYPASS): a Cache Rule includes it.', source: SOURCES.cfCacheStatus },
  { id: 'html-nginx-cache-hit', summary: 'nginx proxy_cache served the HTML.', source: SOURCES.nginxUpstreamCacheStatus },
  { id: 'html-vercel-cache-hit', summary: 'Vercel CDN served the HTML from cache.', source: SOURCES.vercelResponseHeaders },
  { id: 'html-netlify-cache-hit', summary: 'Netlify Edge served the HTML from cache (invalidated on deploy).', source: SOURCES.netlifyCaching },
  { id: 'html-cache-status-hit', summary: 'An RFC 9211 Cache-Status hit on the HTML document.', source: SOURCES.rfc9211CacheStatus },
  { id: 'html-age', summary: 'HTML document carries Age > 0: it sat in a proxy cache.', source: SOURCES.mdnAge },
  { id: 'chunk-redirect', summary: 'Chunk request is redirected (auth/proxy matcher or rewrite).', source: SOURCES.nextProxyMatcher },
  { id: 'chunk-missing', summary: 'Chunk answers 404/410: the hashed file is gone.', source: SOURCES.nextSelfHosting },
  { id: 'chunk-404-cached', summary: 'Cloudflare is serving a cached 404 for the chunk.', source: SOURCES.cfStatusCodeTtl },
  { id: 'chunk-server-error', summary: 'Chunk answers 5xx.', source: SOURCES.webpackChunkRuntime },
  { id: 'chunk-blocked', summary: 'Chunk answers a 4xx other than 404/410 (403 for a missing S3 key, 401 auth, 429…): the script cannot load.', source: SOURCES.htmlFetchClassicScript },
  { id: 'chunk-revalidated', summary: 'Chunk answers 304 Not Modified: a successful revalidation, not a redirect.', source: SOURCES.rfc9110NotModified },
  { id: 'chunk-html-fallback', summary: 'Chunk URL answers 200 with text/html (SPA fallback / rewrite).', source: SOURCES.webpackChunkRuntime },
  { id: 'chunk-wrong-mime', summary: 'Chunk served with a non-JavaScript MIME type under nosniff.', source: SOURCES.mdnNosniff },
  { id: 'chunk-css-wrong-mime', summary: 'CSS chunk served with a Content-Type other than text/css (rejected with or without nosniff).', source: SOURCES.htmlLinkStylesheet },
  { id: 'chunk-not-immutable', summary: 'Chunk lacks public, max-age=31536000, immutable (performance, not the cause).', source: SOURCES.nextHeadersCacheControl },
  { id: 'chunk-not-static-path', summary: 'The chunk request path is not under /_next/static/.', source: SOURCES.nextHeadersCacheControl },
  { id: 'deployment-id-mismatch', summary: 'HTML and chunk carry different Next.js deployment ids.', source: SOURCES.nextDeploymentId },
  { id: 'service-worker-cache', summary: 'A service worker can keep serving old HTML regardless of HTTP headers.', source: SOURCES.mdnCache },
];

const RULE_SOURCE = Object.fromEntries(RULES.map((r) => [r.id, r.source]));

// Rules considered and deliberately NOT encoded because no primary source
// confirmed them (kept here so nobody re-adds them from memory).
export const DROPPED_RULES = [
  'CloudFront X-Cache "Hit from cloudfront" detection — the response-header meaning was not found in AWS docs (only the log field x-edge-result-type).',
  'Netlify detection via x-nf-request-id — not documented on the pages fetched; Netlify is detected from its RFC 9211 Cache-Status "Netlify Edge" instead.',
  'Claim that Vercel purges CDN-cached HTML on every deploy — not stated in the Vercel pages fetched.',
  'Inferring "deploymentId is not configured" from a missing x-nextjs-deployment-id — the docs only promise that header on navigation responses.',
  'Any claim about the Turbopack chunk-loading error message — only the webpack runtime source was verified.',
];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const STATUS_LINE = /^HTTP\/(\d(?:\.\d)?)\s+(\d{3})(?:\s+(.*))?$/i;
const HEADER_LINE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):[ \t]*(.*)$/;
const REQUEST_LINE = /^(GET|HEAD|POST|PUT|DELETE|OPTIONS|PATCH)\s+(\S+)(?:\s+HTTP\/[\d.]+)?$/;

function makeBlock(httpVersion, status, reason) {
  return { httpVersion, status, reason: reason || '', headers: [] };
}

/**
 * Parse pasted response headers. Handles HTTP/1.1, HTTP/2 and HTTP/3 status
 * lines, CRLF, `curl -v` prefixes ("< " response, "> " request, "* " info),
 * `curl -L` redirect chains (several blocks), repeated header names, and a
 * paste that contains headers without a status line.
 */
export function parseResponseHeaders(text) {
  const out = { blocks: [], requestTargets: [], unrecognised: 0 };
  if (typeof text !== 'string' || !text.trim()) return out;

  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    // trimEnd is linear; /\s+$/ backtracks quadratically on long whitespace runs.
    let line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^\*/.test(line) || /^[{}]\s/.test(line)) continue; // curl -v info / TLS lines

    if (/^>\s?/.test(line)) {
      const req = line.replace(/^>\s?/, '').trim().match(REQUEST_LINE);
      if (req) out.requestTargets.push(req[2]);
      continue; // request headers are the client's, never the server's
    }
    line = line.replace(/^<\s?/, '').trim();
    if (!line) continue;

    const st = line.match(STATUS_LINE);
    if (st) {
      current = makeBlock(st[1], Number(st[2]), st[3]);
      out.blocks.push(current);
      continue;
    }
    const req = line.match(REQUEST_LINE);
    if (req) { out.requestTargets.push(req[2]); continue; }

    // HTTP/2+ pseudo-headers as some DevTools / nghttp copies print them
    // (":status: 404", ":path: /_next/static/…"). HEADER_LINE cannot match a
    // name that starts with ":", so they would otherwise be dropped.
    const pseudo = line.match(/^:(status|path):\s*(\S+)/i);
    if (pseudo) {
      if (pseudo[1].toLowerCase() === 'path') { out.requestTargets.push(pseudo[2]); continue; }
      if (/^\d{3}$/.test(pseudo[2])) {
        const code = Number(pseudo[2]);
        if (current && current.status === null) {
          current.status = code;
          current.httpVersion = current.httpVersion || '2';
        } else {
          current = makeBlock('2', code, '');
          out.blocks.push(current);
        }
        continue;
      }
    }

    // Bare URL on its own line (people often paste the URL above the output).
    // Checked before headers: "https://…" would otherwise parse as "https:".
    if (/^https?:\/\/\S+$/i.test(line)) { out.requestTargets.push(line); continue; }

    const hd = line.match(HEADER_LINE);
    if (hd) {
      if (!current) { current = makeBlock(null, null, ''); out.blocks.push(current); }
      current.headers.push([hd[1].toLowerCase(), hd[2].trim()]);
      continue;
    }
    out.unrecognised += 1;
  }
  return out;
}

/** The last final (non-1xx, non-CONNECT) response in a parsed paste. */
export function finalResponse(parsed) {
  const blocks = (parsed?.blocks || []).filter(
    (b) => !(b.status >= 100 && b.status < 200) && !/connection established/i.test(b.reason),
  );
  return blocks.length ? blocks[blocks.length - 1] : null;
}

/** All values for a header (case-insensitive), joined like a combined field. */
export function getHeader(block, name) {
  if (!block) return null;
  const key = name.toLowerCase();
  const values = block.headers.filter(([n]) => n === key).map(([, v]) => v);
  return values.length ? values.join(', ') : null;
}

/** Parse a Cache-Control value into { directive: value|true }. */
export function parseCacheControl(value) {
  const out = {};
  if (!value) return out;
  // Split on commas outside double quotes.
  const parts = value.match(/(?:[^,"]+|"[^"]*")+/g) || [];
  for (const part of parts) {
    const m = part.trim().match(/^([A-Za-z0-9-]+)\s*(?:=\s*(.*))?$/);
    if (!m) continue;
    const name = m[1].toLowerCase();
    const v = m[2] === undefined ? true : m[2].replace(/^"|"$/g, '');
    if (!(name in out)) out[name] = v; // first occurrence wins
  }
  return out;
}

function seconds(v) {
  if (v === undefined || v === true) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** HTTP-date → epoch ms, or null. RFC 9111 §5.3: an invalid Expires ("0") means "already expired". */
function httpDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!/[a-z]/i.test(s)) return null; // "0", "-1": not a date (Date.parse would read a year)
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function duration(sec) {
  if (sec >= 86400) return `${Math.round(sec / 8640) / 10} days`;
  if (sec >= 3600) return `${Math.round(sec / 360) / 10} hours`;
  if (sec >= 60) return `${Math.round(sec / 60)} minutes`;
  return `${sec}s`;
}

// ---------------------------------------------------------------------------
// Secret masking — applied to anything the UI echoes back.
// ---------------------------------------------------------------------------

const SECRET_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'x-auth-token',
  'x-amz-security-token', 'x-csrf-token', 'x-xsrf-token',
]);
const SECRET_PARAM = /^(.*(token|secret|password|passwd|pwd|sig|signature|key|auth|session|code|credential).*)$/i;

export function maskUrlSecrets(value) {
  if (!value) return value;
  return String(value)
    // user:password@host — anchored on the literal "://": a leading scheme
    // pattern restarted at every word boundary and backtracked quadratically.
    .replace(/:\/\/([^/\s:@]+):([^/\s@]+)@/g, '://$1:****@')
    // ?token=… &X-Amz-Signature=… #access_token=… (OAuth implicit flow puts
    // tokens in the fragment). The key excludes "?" so a run of separators
    // cannot backtrack.
    .replace(/([?&#])([^=&#?\s]+)=([^&#\s]*)/g, (all, sep, k, v) => (
      SECRET_PARAM.test(k) && v ? `${sep}${k}=****` : all
    ));
}

const SECRET_HEADER_NAME = /token|secret|auth|api-?key|password|passwd|session|credential|signature/i;

export function maskHeaderValue(name, value) {
  const n = String(name || '').toLowerCase();
  if (SECRET_HEADERS.has(n) || (n !== 'set-cookie' && SECRET_HEADER_NAME.test(n))) return '****';
  if (n === 'set-cookie') {
    // keep the cookie name and attributes, hide the value
    return String(value).replace(/^([^=;]+)=([^;]*)/, (all, k) => `${k.trim()}=****`);
  }
  return maskUrlSecrets(value);
}

/** Masked copy of a block's headers for display. */
export function maskedHeaders(block) {
  if (!block) return [];
  return block.headers.map(([n, v]) => [n, maskHeaderValue(n, v)]);
}

// ---------------------------------------------------------------------------
// Cache indicators and host detection
// ---------------------------------------------------------------------------

// Cloudflare: HIT/STALE/UPDATING/REVALIDATED are served from Cloudflare's
// cache (https://developers.cloudflare.com/cache/concepts/cache-responses/).
const CF_FROM_CACHE = new Set(['HIT', 'STALE', 'UPDATING', 'REVALIDATED']);
// Vercel: HIT and STALE are served from the cache; PRERENDER is "served from
// static storage" and REVALIDATED is "regenerated in the foreground" — neither
// is an old cached copy (https://vercel.com/docs/headers/response-headers).
const VERCEL_FROM_CACHE = new Set(['HIT', 'STALE']);
// nginx $upstream_cache_status values (ngx_http_upstream_module). The header
// that exposes it is whatever name the admin chose in add_header; we read the
// conventional X-Cache-Status only.
const NGINX_FROM_CACHE = new Set(['HIT', 'STALE', 'UPDATING', 'REVALIDATED']);

/** Parse an RFC 9211 Cache-Status list into [{ cache, hit, fwd }]. */
export function parseCacheStatus(value) {
  if (!value) return [];
  const members = value.match(/(?:[^,"]+|"[^"]*")+/g) || [];
  return members.map((m) => {
    const [first, ...params] = m.split(';').map((s) => s.trim());
    const cache = first.replace(/^"|"$/g, '');
    let hit = false;
    let fwd = null;
    for (const p of params) {
      if (/^hit(=\?1)?$/i.test(p)) hit = true;
      const f = p.match(/^fwd=(.+)$/i);
      if (f) fwd = f[1];
    }
    return { cache, hit, fwd };
  });
}

/** Which caching layers are visible on a response, and did they serve it? */
export function cacheLayers(block) {
  const layers = [];
  if (!block) return layers;
  const cf = getHeader(block, 'cf-cache-status');
  if (cf) {
    const v = cf.toUpperCase().trim();
    layers.push({ layer: 'cloudflare', header: 'cf-cache-status', value: v, fromCache: CF_FROM_CACHE.has(v), source: SOURCES.cfCacheStatus });
  }
  const vc = getHeader(block, 'x-vercel-cache');
  if (vc) {
    const v = vc.toUpperCase().trim();
    layers.push({ layer: 'vercel', header: 'x-vercel-cache', value: v, fromCache: VERCEL_FROM_CACHE.has(v), source: SOURCES.vercelResponseHeaders });
  }
  const cs = getHeader(block, 'cache-status');
  if (cs) {
    for (const m of parseCacheStatus(cs)) {
      const layer = /netlify/i.test(m.cache) ? 'netlify' : 'cache-status';
      layers.push({
        layer, header: 'cache-status', value: `${m.cache}${m.hit ? '; hit' : ''}${m.fwd ? `; fwd=${m.fwd}` : ''}`,
        fromCache: m.hit, source: layer === 'netlify' ? SOURCES.netlifyCaching : SOURCES.rfc9211CacheStatus,
      });
    }
  }
  const nx = getHeader(block, 'x-cache-status');
  if (nx) {
    const v = nx.toUpperCase().trim();
    layers.push({ layer: 'nginx', header: 'x-cache-status', value: v, fromCache: NGINX_FROM_CACHE.has(v), source: SOURCES.nginxUpstreamCacheStatus });
  }
  return layers;
}

/** Hosts visible in the headers, outermost first (Cloudflare can front anything). */
export function detectHosts(...blocks) {
  const found = new Set();
  for (const b of blocks) {
    if (!b) continue;
    if (getHeader(b, 'cf-ray') || getHeader(b, 'cf-cache-status')) found.add('cloudflare');
    if (getHeader(b, 'x-vercel-id') || getHeader(b, 'x-vercel-cache') || /^vercel$/i.test(getHeader(b, 'server') || '')) found.add('vercel');
    if (/netlify/i.test(getHeader(b, 'cache-status') || '') || getHeader(b, 'netlify-cdn-cache-control')) found.add('netlify');
    if (/^nginx/i.test(getHeader(b, 'server') || '') || getHeader(b, 'x-cache-status')) found.add('nginx');
  }
  const order = ['cloudflare', 'vercel', 'netlify', 'nginx'];
  return order.filter((h) => found.has(h));
}

function dplFromTarget(target) {
  if (!target) return null;
  const m = String(target).match(/[?&]dpl=([^&#\s]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1]; // malformed %-escape: keep the raw value, never throw
  }
}

function pathOf(target) {
  if (!target) return null;
  try {
    return new URL(target, 'https://placeholder.invalid').pathname;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-host fixes
// ---------------------------------------------------------------------------

const NEXT_HTML_HEADERS_SNIPPET = `// next.config.js — only if YOU added a long max-age to pages.
// Remove that rule, or scope it away from HTML routes. Next.js already sends
// "private, no-cache, no-store, max-age=0, must-revalidate" on dynamic pages.
module.exports = {
  async headers() {
    return [
      // delete any { source: '/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=…' }] }
    ]
  },
}`;

const DEPLOYMENT_ID_SNIPPET = `// next.config.js — hard reload on version mismatch (open tabs, rolling deploys)
module.exports = {
  deploymentId: process.env.DEPLOYMENT_VERSION || process.env.GIT_SHA,
}`;

const PROXY_MATCHER_SNIPPET = `// proxy.js (middleware.js before Next.js 16) — never run auth on static files
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}`;

const NGINX_HTML_SNIPPET = `# nginx — keep HTML out of proxy_cache, let /_next/static stay cached
location /_next/static/ {
    proxy_pass http://nextjs;          # Next.js sets immutable itself
}
location / {
    proxy_pass http://nextjs;
    proxy_no_cache 1;                  # do not store HTML
    proxy_cache_bypass 1;              # do not serve HTML from cache
}`;

const NGINX_STATIC_SNIPPET = `# nginx serving the built files itself: 404 on a missing chunk,
# never fall back to index.html for /_next/static/
location /_next/static/ {
    alias /app/.next/static/;
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}`;

const SW_SNIPPET = `// sw.js — version the cache and delete old ones on activate
const CACHE = 'app-v2'; // bump on every deploy
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
});
// For navigations (HTML), prefer the network and fall back to cache only offline.`;

function fixFor(ruleId, host, ctx = {}) {
  const h = host || 'other';
  switch (ruleId) {
    case 'html-expires':
    case 'html-heuristic-freshness': {
      const base = 'Send an explicit "Cache-Control: no-cache" on HTML documents: it overrides Expires and switches off heuristic freshness, so the browser revalidates the page on every visit. Keep the long-lived header on /_next/static/ only.';
      if (h === 'nginx') return { text: `${base} In nginx, remove any "expires" directive from the location that serves HTML and add the header there.`, code: 'location / {\n    add_header Cache-Control "no-cache" always;\n    # …your existing try_files / proxy_pass\n}' };
      return { text: `${base} On S3 or another object store, set the Cache-Control metadata on every .html object at upload time.`, code: 'aws s3 cp out/ s3://your-bucket/ --recursive --exclude "*" --include "*.html" --cache-control "no-cache"' };
    }
    case 'html-cf-cache-eligible':
      return { text: 'Find the Cache Rule (Caching → Cache Rules) whose expression matches your page URLs and exclude HTML from it — scope it to /_next/static/* instead. If you keep it, add a Purge Everything (or a purge call from CI) as the last step of every deploy. On Cloudflare Pages there is no zone Cache Rule to edit: the platform\'s asset cache holds files for up to a week, and Cloudflare recommends Purge Everything when stale assets are served after a new deployment.', code: null };
    case 'html-redirect':
      return { text: `Run curl -sIL on the page so curl follows the redirect${ctx.location ? ` to ${ctx.location}` : ''}, or run curl -sI directly on the final URL, and paste that.`, code: null };
    case 'input-no-status':
      return { text: 'Paste the output of curl -sI (or curl -sIL), which always starts with a line such as "HTTP/2 200". In DevTools, the status code is in the General section above the response headers.', code: null };
    case 'chunk-blocked':
      if (ctx.status === 403) return { text: 'A missing object on S3 (and CloudFront in front of it) answers 403, not 404, unless the reader has s3:ListBucket — so treat this as "the chunk is gone" first: check the key exists in the bucket for this build. If it does, fix the bucket policy / Origin Access Control or the WAF rule that blocks it.', code: DEPLOYMENT_ID_SNIPPET };
      if (ctx.status === 401) return { text: 'Authentication is required for a static file. Exclude /_next/static/ from the auth proxy/middleware matcher, or — on Vercel — from Deployment Protection if you are testing a protected preview URL.', code: PROXY_MATCHER_SNIPPET };
      if (ctx.status === 429) return { text: 'A rate limiter (WAF, CDN or app) is throttling static files. Exempt /_next/static/ from the rate-limit rule: one page load requests many chunks at once.', code: null };
      return { text: 'Something in front of the origin refuses the static file. Exclude /_next/static/ from auth, WAF and rewrite rules so the hashed file is served as is.', code: PROXY_MATCHER_SNIPPET };
    case 'chunk-css-wrong-mime':
      return { text: 'Serve .css files with "Content-Type: text/css". On S3 or another object store, set the content type at upload (most sync tools guess it from the extension; a raw upload may default to application/octet-stream or binary/octet-stream).', code: null };
    case 'html-immutable':
    case 'html-browser-max-age': {
      const base = 'Serve HTML with a zero freshness lifetime so browsers revalidate it on every visit — Next.js does this by default for dynamic pages. Only the hashed files under /_next/static/ should be long-lived.';
      if (h === 'cloudflare') return { text: `${base} On Cloudflare, check your Cache Rules for one matching HTML pages. On Cloudflare Pages, _headers rules are not applied to responses generated by Pages Functions (next-on-pages) — set it in next.config.js.`, code: NEXT_HTML_HEADERS_SNIPPET };
      if (h === 'nginx') return { text: `${base} Look for "expires" or "add_header Cache-Control" in the location that serves HTML — "expires" with a positive time emits max-age.`, code: NEXT_HTML_HEADERS_SNIPPET };
      if (h === 'netlify') return { text: `${base} Check netlify.toml [[headers]] and _headers for a "/*" rule with a max-age; Netlify's own default for static files is "public, max-age=0, must-revalidate".`, code: NEXT_HTML_HEADERS_SNIPPET };
      if (h === 'vercel') return { text: `${base} Check vercel.json "headers" and next.config.js headers() for a rule covering pages.`, code: NEXT_HTML_HEADERS_SNIPPET };
      return { text: base, code: NEXT_HTML_HEADERS_SNIPPET };
    }
    case 'html-shared-cacheable':
      if (h === 'vercel') return { text: 'On Vercel this is expected for prerendered/ISR pages: Vercel sends the browser "public, max-age=0, must-revalidate" when you use s-maxage. Open tabs are what break — Skew Protection (Pro/Enterprise) keeps old tabs on their own deployment, on by default for projects created after 19 November 2024.', code: null };
      if (h === 'netlify') return { text: 'Netlify invalidates its CDN cache on every deploy for that deploy context, so a CDN-held HTML page does not survive a deploy — unless a Netlify-Cache-ID header opts the response out.', code: null };
      if (h === 'cloudflare') return { text: 'Cloudflare respects origin cache headers. If a Cache Rule makes HTML eligible, every deploy must be followed by Caching → Configuration → Purge Everything (or a purge from your CI), or drop s-maxage from HTML.', code: null };
      if (h === 'nginx') return { text: 'An upstream Cache-Control has priority over proxy_cache_valid, so s-maxage on HTML lets proxy_cache keep it. Either do not cache HTML in nginx or purge the cache as the last step of a deploy.', code: NGINX_HTML_SNIPPET };
      return { text: 'Whatever shared cache sits in front must be purged as part of every deploy, or HTML must not carry s-maxage.', code: null };
    case 'html-cf-cache-hit':
      return { text: 'On a proxied site, Cloudflare only caches HTML when a Cache Rule tells it to: exclude HTML from that rule, or purge on every deploy (Caching → Configuration → Purge Everything). On Cloudflare Pages, assets have a one-week TTL and Cloudflare itself recommends Purge Everything when stale assets are served after a new deployment.', code: null };
    case 'html-nginx-cache-hit':
      return { text: 'nginx proxy_cache keeps the HTML for proxy_cache_valid (or the upstream Cache-Control/X-Accel-Expires, which take priority). A deploy does not clear it. Stop caching HTML, or clear the cache directory as the last deploy step.', code: NGINX_HTML_SNIPPET };
    case 'html-vercel-cache-hit':
      return { text: 'Normal on Vercel for static/ISR pages. Keep Skew Protection enabled (Pro/Enterprise; default for projects created after 19 November 2024) so tabs opened before a deploy keep loading their own chunks.', code: null };
    case 'html-netlify-cache-hit':
      return { text: 'Netlify invalidates the CDN cache on each deploy, so this hit is not stale across deploys. Look at open tabs (deploymentId) or a service worker instead.', code: DEPLOYMENT_ID_SNIPPET };
    case 'html-cache-status-hit':
    case 'html-age':
      return { text: 'Find which cache in front of the origin stored this HTML and either stop it caching documents or purge it on every deploy. The Age value is how long this copy has been held.', code: null };
    case 'chunk-redirect':
      return { text: `Something between the browser and /_next/static/ redirects the chunk${ctx.location ? ` to ${ctx.location}` : ''}. The usual culprit is an auth proxy/middleware whose matcher does not exclude _next/static — the Next.js docs warn this can "unintentionally block CSS, JS, or images from loading".`, code: PROXY_MATCHER_SNIPPET };
    case 'chunk-missing':
      if (h === 'vercel') return { text: 'The chunk belongs to a deployment Vercel is no longer routing to. Skew Protection keeps the old deployment reachable for open tabs (default maximum age: one day). If the HTML you tested is fresh and still 404s its own chunk, the build output itself is incomplete.', code: DEPLOYMENT_ID_SNIPPET };
      if (h === 'nginx') return { text: 'Self-hosted: with output: "standalone", public and .next/static are not copied by default — every chunk 404s until you copy them. For rolling deploys, set deploymentId so a mismatched client does a full reload.', code: `cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/\n\n${DEPLOYMENT_ID_SNIPPET}` };
      return { text: 'The HTML that referenced this chunk came from an older build. Make sure HTML is never served from a cache after a deploy (see the HTML findings), and set deploymentId so open tabs hard-reload instead of requesting the old chunk.', code: DEPLOYMENT_ID_SNIPPET };
    case 'chunk-404-cached':
      return { text: 'Cloudflare caches 404/410 for 3 minutes by default when the origin sends no Cache-Control. Chunks requested moments before a deploy finished stay 404 for that window. Purge after the deploy completes, or have the origin send "Cache-Control: no-store" on 404s.', code: null };
    case 'chunk-server-error':
      return { text: 'The origin or proxy failed while serving a static file. Check the logs of the server that owns /_next/static/ at the time of the request; retrying the same URL should succeed once it recovers.', code: null };
    case 'chunk-html-fallback':
      if (h === 'cloudflare') return { text: 'For a static export on Cloudflare Pages without a top-level 404.html, Pages assumes a single-page app and serves the root page for unknown paths — so a missing chunk comes back as 200 HTML. Add a 404.html so missing files return 404, then fix why the chunk is missing.', code: null };
      if (h === 'nginx') return { text: 'A catch-all try_files (…/index.html) internally redirects missing files to your HTML. Give /_next/static/ its own location that ends in =404.', code: NGINX_STATIC_SNIPPET };
      return { text: 'A rewrite or SPA fallback is answering the chunk URL with your HTML page. Exclude /_next/static/ from every catch-all rewrite and proxy so a missing chunk returns a real 404 — then fix why it is missing.', code: PROXY_MATCHER_SNIPPET };
    case 'chunk-wrong-mime':
      return { text: 'Serve .js with a JavaScript MIME type (text/javascript) and .css with text/css. A proxy or object store that sets application/octet-stream or text/plain makes the browser block the file under nosniff.', code: null };
    case 'chunk-not-immutable':
      if (h === 'netlify') return { text: 'Netlify\'s default for static files is "Cache-Control: public, max-age=0, must-revalidate" (the CDN caches them for a year and invalidates on deploy). Browsers will revalidate each chunk — slower, but it does not cause ChunkLoadError.', code: null };
      if (h === 'cloudflare') return { text: 'If this is Cloudflare Pages, its default is "public, max-age=0, must-revalidate". If Cloudflare only proxies another origin, something there rewrote the header Next.js sets. Either way browsers revalidate each chunk — slower, not the cause of ChunkLoadError.', code: null };
      if (h === 'nginx') return { text: 'Something between Next.js and the browser rewrote the header Next.js sets. If nginx serves the files itself, add the immutable header on /_next/static/.', code: NGINX_STATIC_SNIPPET };
      return { text: 'Next.js sets "public, max-age=31536000, immutable" on these hashed files and it cannot be overridden in next.config.js — so a different value was set by a proxy or CDN in front. This costs performance, but it is not what causes ChunkLoadError.', code: null };
    case 'chunk-not-static-path':
      return { text: 'Test a real hashed file: open DevTools → Network, filter by "_next/static/chunks", copy one URL and run curl -I on it.', code: null };
    case 'deployment-id-mismatch':
      return { text: 'This is the version skew Next.js detects: when the ids differ it performs a hard navigation instead of a client-side one. If users still see ChunkLoadError, the HTML they load after that reload is itself stale — fix the HTML caching findings.', code: null };
    case 'service-worker-cache':
      return { text: 'Serve navigations network-first, version the cache name and delete old caches in the activate event. A new worker only activates once no page uses the old one, so the first reload after a deploy may still be served by the old worker.', code: SW_SNIPPET };
    default:
      return { text: '', code: null };
  }
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const JS_MIME = /^(text|application)\/(javascript|ecmascript|x-javascript)\b/i;
const CSS_MIME = /^text\/css\b/i;

function finding(ruleId, severity, title, why, host, ctx) {
  const fix = fixFor(ruleId, host, ctx);
  return { ruleId, severity, title, why, fix: fix.text, code: fix.code, source: RULE_SOURCE[ruleId] };
}

/**
 * Diagnose pasted headers.
 * @param {{ htmlHeaders?: string, chunkHeaders?: string, host?: string, serviceWorker?: boolean }} input
 */
export function diagnose(input = {}) {
  const { htmlHeaders = '', chunkHeaders = '', host = 'auto', serviceWorker = false } = input || {};
  const htmlParsed = parseResponseHeaders(htmlHeaders);
  const chunkParsed = parseResponseHeaders(chunkHeaders);
  const html = finalResponse(htmlParsed);
  const chunk = finalResponse(chunkParsed);
  const detected = detectHosts(html, chunk);
  const effectiveHost = host && host !== 'auto' ? host : (detected[0] || 'other');

  const findings = [];
  const passes = [];
  const add = (ruleId, severity, title, why, ctx) => findings.push(finding(ruleId, severity, title, why, effectiveHost, ctx));

  // ---- input sanity -------------------------------------------------------
  for (const [label, text, res] of [['HTML document', htmlHeaders, html], ['chunk', chunkHeaders, chunk]]) {
    if (!String(text || '').trim()) {
      add('input-missing', 'info', `No ${label} headers pasted`,
        label === 'chunk'
          ? 'The chunk tells us whether the file exists and what the server really returns for it. Copy one URL from DevTools → Network ("_next/static/chunks/…") and run curl -I on it.'
          : 'The HTML document decides which chunk URLs the browser asks for — and whether an old copy of it can be served after a deploy. Run curl -I on the page URL.');
    } else if (!res || (!res.headers.length && res.status === null)) {
      add('input-unparsed', 'info', `Could not read the ${label} headers`,
        'No HTTP status line ("HTTP/2 200", "HTTP/1.1 200 OK") or "Name: value" header was found. Paste the raw output of curl -I (or curl -sIL to follow redirects).');
    } else if (res.status === null) {
      // Headers without a status line (a DevTools copy of the header list
      // only): the one fact that decides most chunk rules is missing.
      add('input-no-status', 'info', `No status line in the ${label} headers`,
        `The ${label} headers were read, but without the status code ("HTTP/2 200", "HTTP/1.1 404 Not Found") the tool cannot tell whether ${label === 'chunk' ? 'the file exists, was redirected or was refused' : 'this is the page itself or a redirect'}. The checks below use the headers alone.`);
    }
  }

  // ---- HTML document ------------------------------------------------------
  const isRedirect = (s) => s >= 300 && s < 400 && s !== 304; // RFC 9110 §15.4.5: 304 is a revalidation
  if (html && isRedirect(html.status)) {
    // The pasted "page" is a redirect (i18n, trailing slash, auth): its
    // Cache-Control describes the redirect, not the HTML document.
    const loc = getHeader(html, 'location');
    const location = loc ? maskUrlSecrets(loc) : null;
    add('html-redirect', 'info', `The page headers are a ${html.status} redirect${location ? ` to ${location}` : ''}`,
      'A 3xx response only points elsewhere — its caching headers belong to the redirect, not to the HTML document that lists the chunks, so the document checks were skipped.',
      { location });
  } else if (html && (html.headers.length || html.status !== null)) {
    const cc = parseCacheControl(getHeader(html, 'cache-control'));
    const maxAge = seconds(cc['max-age']);
    const sMaxage = seconds(cc['s-maxage']);
    const noStore = cc['no-store'] === true;
    const noCache = cc['no-cache'] === true;
    const isPrivate = cc.private === true;
    const layers = cacheLayers(html);
    const hosts = new Set(detectHosts(html));

    const ct = getHeader(html, 'content-type');
    if (ct && !/text\/html/i.test(ct)) {
      add('input-unparsed', 'info', `The "HTML" response is ${ct}, not text/html`,
        'The first box should hold the headers of a page URL (the document that lists the chunks), not of an API route or asset.');
    }

    // Rule: immutable on HTML. RFC 8246 §2: clients SHOULD NOT revalidate
    // during the freshness lifetime — so it only bites with max-age > 0.
    // Source: https://www.rfc-editor.org/rfc/rfc8246.html
    if (cc.immutable && maxAge > 0 && !noStore && !noCache) {
      add('html-immutable', 'critical', 'HTML is marked immutable',
        `Cache-Control on the page says "immutable" with max-age=${maxAge}. RFC 8246 tells browsers not to revalidate an immutable response while it is fresh, even on reload — so after a deploy the browser keeps the old HTML and keeps requesting chunk hashes that no longer exist. "immutable" belongs on hashed files only.`);
    } else if (maxAge > 0 && !noStore && !noCache) {
      // Rule: browser freshness. RFC 9111 §5.2.2.1 — stale only after
      // max-age seconds. Source: https://www.rfc-editor.org/rfc/rfc9111.html#name-max-age-2
      add('html-browser-max-age', maxAge >= 3600 ? 'critical' : 'warning', `HTML is cached by the browser for ${maxAge}s`,
        `With max-age=${maxAge}, the browser reuses this HTML for up to ${maxAge} seconds without asking the server. A visitor returning within that window after a deploy gets the old HTML, which points at old chunk hashes — the deploy removed them, so the chunk request fails with "Loading chunk … failed".`);
    } else if (noStore || noCache || maxAge === 0) {
      passes.push({ ruleId: 'html-browser-max-age', text: `HTML is not reused by the browser without revalidation (${getHeader(html, 'cache-control')}).` });
    } else if (maxAge === null) {
      // No max-age: RFC 9111 §4.2.1 falls back to Expires minus Date, then
      // §4.2.2 allows heuristic freshness from Last-Modified ("a typical
      // setting of this fraction might be 10%"). Classic static export on
      // nginx / Apache / S3 with no Cache-Control on index.html.
      // Sources: https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-freshness-lifet
      //          https://www.rfc-editor.org/rfc/rfc9111.html#name-calculating-heuristic-fresh
      const dateMs = httpDate(getHeader(html, 'date'));
      const expiresRaw = getHeader(html, 'expires');
      const lastModMs = httpDate(getHeader(html, 'last-modified'));
      if (expiresRaw) {
        const expMs = httpDate(expiresRaw);
        const lifetime = expMs !== null && dateMs !== null ? Math.round((expMs - dateMs) / 1000) : null;
        if (lifetime > 0) {
          add('html-expires', lifetime >= 3600 ? 'critical' : 'warning', `HTML is cached by the browser for ${duration(lifetime)} (Expires)`,
            `There is no max-age, so the browser takes the freshness lifetime from Expires minus Date: ${lifetime} seconds. During that window a returning visitor gets the old HTML without asking the server, and after a deploy its chunk URLs no longer exist — "Loading chunk … failed".`);
        } else if (expMs !== null && dateMs === null) {
          add('html-expires', 'warning', `HTML carries Expires: ${expiresRaw}`,
            'There is no max-age, so the browser treats this HTML as fresh until the Expires date (measured against the response Date, which is missing from this paste). Until then, after a deploy, it reuses the old HTML whose chunk URLs no longer exist.');
        } else {
          passes.push({ ruleId: 'html-expires', text: `Expires (${expiresRaw}) is not in the future: the browser treats the HTML as already stale.` });
        }
      } else if (lastModMs !== null) {
        const est = dateMs !== null && dateMs > lastModMs ? Math.round((dateMs - lastModMs) / 10000) : null;
        add('html-heuristic-freshness', 'warning', est
          ? `HTML may be reused for about ${duration(est)} (heuristic freshness)`
          : 'HTML may be reused heuristically (Last-Modified, no Cache-Control)',
          `This HTML has Last-Modified but no max-age, no-cache or Expires. RFC 9111 lets caches — browsers included — then pick a freshness lifetime themselves, typically 10% of the time since Last-Modified${est ? ` (here about ${est} seconds)` : ''}. A page that changed rarely before a deploy can therefore be reused without revalidation after it, pointing at chunks that are gone.`);
      }
    }

    // Rule: shared-cache storable. RFC 9111 §5.2.2.10: s-maxage overrides
    // max-age for shared caches. Also CDN-Cache-Control /
    // Netlify-CDN-Cache-Control (https://docs.netlify.com/platform/caching/).
    const cdnCc = parseCacheControl(getHeader(html, 'netlify-cdn-cache-control') || getHeader(html, 'cdn-cache-control'));
    const cdnTtl = Math.max(sMaxage || 0, seconds(cdnCc['s-maxage']) || 0, seconds(cdnCc['max-age']) || 0);
    // Evidence that a shared cache actually stores this HTML: a layer that
    // served it, or one that says it was eligible (MISS / EXPIRED, RFC 9211
    // fwd=miss…), or Age > 0. Cloudflare DYNAMIC ("not eligible for cache")
    // and BYPASS ("not cacheable") are evidence AGAINST — cache-responses doc.
    const eligible = (l) => l.fromCache || /^(MISS|EXPIRED)$/.test(l.value) || /fwd=(uri-miss|vary-miss|miss|stale)/.test(l.value);
    const ageSeconds = seconds(getHeader(html, 'age'));
    const hasSharedEvidence = layers.some(eligible) || ageSeconds > 0;
    const provedUncached = !hasSharedEvidence && layers.length > 0;
    if (cdnTtl > 0 && !isPrivate && !noStore) {
      const benign = hosts.has('vercel') || hosts.has('netlify') || effectiveHost === 'vercel' || effectiveHost === 'netlify';
      const severity = hasSharedEvidence && !benign ? 'warning' : 'info';
      const tail = provedUncached
        ? ` Here ${layers.map((l) => `${l.header}: ${l.value}`).join(', ')} says the cache did not store it, so today this is harmless — it becomes a risk the day a cache rule makes HTML eligible.`
        : hasSharedEvidence ? '' : ' No cache header is visible on this response, so it may not be cached at all.';
      add('html-shared-cacheable', severity, `HTML may be held by a shared cache for ${cdnTtl}s`,
        `The page allows shared caches (CDN, reverse proxy) to keep it for ${cdnTtl} seconds. Next.js does this on purpose for prerendered and ISR pages. It only turns into ChunkLoadError when that cache is not cleared on deploy: it keeps handing out the old HTML while the old chunks are gone.${tail}`);
    }

    // Rule: CDN / proxy served this HTML from cache — per layer.
    const age = seconds(getHeader(html, 'age'));
    let namedHit = false;
    for (const l of layers) {
      if (!l.fromCache) continue;
      namedHit = true;
      const revalidated = l.value === 'REVALIDATED';
      if (l.layer === 'cloudflare') {
        // Cloudflare does not cache HTML by default:
        // https://developers.cloudflare.com/cache/concepts/default-cache-behavior/
        // REVALIDATED = "the origin confirmed the cached resource was
        // unchanged" (cache-responses doc): current, but proves caching is on.
        add('html-cf-cache-hit', revalidated ? 'warning' : 'critical', `Cloudflare served this HTML from its cache (cf-cache-status: ${l.value})`,
          `${revalidated
            ? 'The origin confirmed this copy is current, so this particular response is fine — but it proves Cloudflare is storing your HTML.'
            : `Until this cached copy expires or is purged, visitors get the HTML Cloudflare stored before your deploy${age ? ` (this copy is ${age}s old)` : ''} — and its chunk URLs 404 once the new build is live.`} Cloudflare's CDN does not cache HTML by default on a proxied site, so a Cache Rule is probably making it cacheable; on Cloudflare Pages, the platform's own asset cache can also hold it.`);
      } else if (l.layer === 'nginx') {
        add('html-nginx-cache-hit', revalidated ? 'info' : 'warning', `nginx proxy_cache served this HTML (${l.header}: ${l.value})`,
          `The header ${l.header} is not sent by nginx on its own — someone exposed $upstream_cache_status with add_header, and it says the page came from proxy_cache${revalidated ? ' after the upstream confirmed it was unchanged' : ''}. That cache knows nothing about your deploys, so it can hand out the old HTML after a release.`);
      } else if (l.layer === 'vercel') {
        add('html-vercel-cache-hit', 'info', `Vercel CDN served this HTML from cache (x-vercel-cache: ${l.value})`,
          'Expected for static and ISR pages on Vercel. The ChunkLoadError risk on Vercel is tabs opened before a deploy, which Skew Protection handles.');
      } else if (l.layer === 'netlify') {
        add('html-netlify-cache-hit', 'info', `Netlify Edge served this HTML from cache (${l.value})`,
          'Netlify invalidates its CDN cache on every deploy by default, so this copy belongs to the current deploy.');
      } else {
        add('html-cache-status-hit', 'warning', `A cache served this HTML (Cache-Status: ${l.value})`,
          'Per RFC 9211, "hit" means the response came from that cache without contacting the origin. If that cache is not purged on deploy, it keeps serving HTML that references deleted chunks.');
      }
    }
    // Rule: Age > 0 without a named cache hit. MDN: Age is the time in
    // seconds the object was in a proxy cache; 0 means probably fetched from
    // origin. Source: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Age
    const benignAgeLayer = layers.some((l) => (l.layer === 'vercel' || l.layer === 'netlify'));
    if (!namedHit && age > 0 && !benignAgeLayer) {
      add('html-age', age >= 300 ? 'warning' : 'info', `This HTML sat in a cache for ${age}s (Age: ${age})`,
        'Age is the time the response spent in a proxy cache. Some cache between you and the origin is storing your HTML; if it outlives a deploy, it serves pages that point at chunks the deploy deleted.');
    }
    // Rule: Cloudflare says the HTML is cache-ELIGIBLE even though this copy
    // came from the origin. Cache-responses doc: MISS = "eligible for cache
    // but was not present", EXPIRED = "found in cache but was expired",
    // BYPASS = "considered the asset eligible for cache … but the origin
    // response was ultimately not cacheable". DYNAMIC = "not eligible". HTML
    // is not cached by default, so eligibility means a Cache Rule includes it;
    // with an Edge TTL override the origin's no-store is ignored and the next
    // request is a HIT. Source: https://developers.cloudflare.com/cache/concepts/cache-responses/
    const cfLayer = layers.find((l) => l.layer === 'cloudflare');
    const alreadyShared = findings.some((f) => f.ruleId === 'html-shared-cacheable' && f.severity !== 'info');
    if (cfLayer && /^(MISS|EXPIRED|BYPASS)$/.test(cfLayer.value) && !alreadyShared) {
      const bypass = cfLayer.value === 'BYPASS';
      add('html-cf-cache-eligible', bypass ? 'info' : 'warning', `Cloudflare treats this HTML as cacheable (cf-cache-status: ${cfLayer.value})`,
        bypass
          ? 'BYPASS means Cloudflare wanted to cache this HTML but the origin\'s Cache-Control stopped it. That protects you today; the day the Cache Rule gets an Edge TTL override, the origin header is ignored and HTML is cached across deploys.'
          : `${cfLayer.value === 'MISS' ? 'MISS means the HTML is eligible for Cloudflare\'s cache but was not in it yet' : 'EXPIRED means Cloudflare had this HTML in its cache and it expired'} — this copy came from the origin, but the next request can be a HIT. Cloudflare does not cache HTML by default, so a Cache Rule (for example "cache everything" or an Edge TTL override) is including your pages, and a cached page survives a deploy until it expires or is purged.`);
    }
    if (!findings.some((f) => f.ruleId.startsWith('html-')) && layers.length && !layers.some((l) => l.fromCache)) {
      passes.push({ ruleId: 'html-cf-cache-hit', text: `No cache served this HTML (${layers.map((l) => `${l.header}: ${l.value}`).join(', ')}).` });
    }
  }

  // ---- chunk --------------------------------------------------------------
  if (chunk && (chunk.headers.length || chunk.status !== null)) {
    const status = chunk.status;
    const target = chunkParsed.requestTargets[chunkParsed.requestTargets.length - 1] || null;
    const path = pathOf(target);
    // 304 Not Modified is a revalidation, not a redirection (RFC 9110 §15.4.5).
    const chain = chunkParsed.blocks.filter((b) => isRedirect(b.status));
    const ct = getHeader(chunk, 'content-type') || '';
    const nosniff = /nosniff/i.test(getHeader(chunk, 'x-content-type-options') || '');
    const isHtml = /text\/html/i.test(ct);
    const expectCss = path ? /\.css$/i.test(path) : false;

    const notStatic = Boolean(path && !/\/_next\/static\//.test(path));
    if (notStatic) {
      add('chunk-not-static-path', 'info', 'That is not a /_next/static/ file',
        `The request path was ${maskUrlSecrets(path)}. Hashed chunks live under /_next/static/ — that is where Next.js applies its immutable caching and where ChunkLoadError URLs point.`);
    }

    // Next.js sets public, max-age=31536000, immutable on hashed assets and
    // it cannot be overridden in next.config.js.
    // Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/headers#cache-control
    const checkImmutable = () => {
      if (isHtml || notStatic) return;
      const cc = parseCacheControl(getHeader(chunk, 'cache-control'));
      const maxAge = seconds(cc['max-age']);
      if (cc.immutable && maxAge >= 31536000) {
        passes.push({ ruleId: 'chunk-not-immutable', text: 'The chunk is cached as immutable for a year, as Next.js intends.' });
      } else {
        add('chunk-not-immutable', 'info', 'The chunk is not cached as immutable',
          `Received "${getHeader(chunk, 'cache-control') || '(no Cache-Control)'}" instead of Next.js's "public, max-age=31536000, immutable". Browsers will revalidate or re-download this file — a performance cost, not the cause of ChunkLoadError. Hashed files are safe to cache forever precisely because a new build gives them a new name.`);
      }
    };

    const endsOnAsset = status === 304 || (status >= 200 && status < 300 && (JS_MIME.test(ct) || CSS_MIME.test(ct)));
    if (isRedirect(status) || (chain.length && !endsOnAsset)) {
      // Proxy matcher doc: without a negative matcher, auth logic or
      // redirects "can unintentionally block CSS, JS, or images from
      // loading". Source: https://nextjs.org/docs/app/api-reference/file-conventions/proxy#matcher
      const loc = getHeader(isRedirect(status) ? chunk : chain[0], 'location');
      const location = loc ? maskUrlSecrets(loc) : null;
      add('chunk-redirect', 'critical', `The chunk is redirected (${chain[0]?.status || status}${location ? ` → ${location}` : ''})`,
        'A script request that ends on anything other than the JavaScript file fails to load. Redirects on /_next/static/ usually come from auth logic in proxy/middleware or a host rule matching every path.',
        { location });
    }

    if (status === null) {
      // No status line (input-no-status already says so). The Content-Type
      // still speaks: text/html on a chunk URL is either an error page or an
      // SPA fallback, and the browser can run neither.
      if (isHtml) {
        add('chunk-html-fallback', 'warning', 'The chunk URL answers with HTML (status unknown)',
          'This response is text/html, so it is not the JavaScript or CSS file: either an error page (a 404, the file is gone) or a rewrite / single-page-app fallback returning your page. Both mean the chunk does not load. Paste the status line to tell them apart.');
      }
    } else if (status === 304) {
      // RFC 9110 §15.4.5: 304 = the conditional request matched and the
      // cached copy is still valid. DevTools shows it for chunks on hosts
      // that send "max-age=0, must-revalidate" (Netlify, Cloudflare Pages).
      passes.push({ ruleId: 'chunk-revalidated', text: 'The chunk exists: 304 Not Modified means the server confirmed the browser\'s cached copy (a revalidation, not a redirect). For the full picture, run a plain curl -I without conditional headers.' });
      if (getHeader(chunk, 'cache-control')) checkImmutable();
    } else if (status === 404 || status === 410) {
      // Next.js self-hosting "Version Skew": "Missing assets: The client
      // requests JavaScript or CSS files that no longer exist on the server".
      // Source: https://nextjs.org/docs/app/guides/self-hosting#version-skew
      add('chunk-missing', 'critical', `The chunk returns ${status}: the file no longer exists`,
        'This is the textbook ChunkLoadError. The page that referenced this hashed file came from an older build; the deploy replaced the file with a new hash. Next.js calls it version skew — "the client requests JavaScript or CSS files that no longer exist on the server". In webpack builds the message reads "Loading chunk N failed. (error: <url>)".');
      const cf = getHeader(chunk, 'cf-cache-status');
      if (cf && CF_FROM_CACHE.has(cf.toUpperCase().trim())) {
        // Cloudflare default edge TTL: 404/410 → 3m without cache-control.
        // Source: https://developers.cloudflare.com/cache/how-to/configure-cache-status-code/
        add('chunk-404-cached', 'warning', `Cloudflare is serving a cached ${status} (cf-cache-status: ${cf.toUpperCase().trim()})`,
          `The 404 itself came from Cloudflare's cache. When the origin sends no Cache-Control, Cloudflare caches 404 and 410 for 3 minutes by default — so a chunk requested while the deploy was rolling out keeps failing for a while after the file exists.`);
      }
    } else if (status >= 500 && status < 600) {
      // webpack runtime: errorType = event.type ('error' for a failed load).
      // Source: https://github.com/webpack/webpack/blob/main/lib/web/JsonpChunkLoadingRuntimeModule.js
      add('chunk-server-error', 'warning', `The chunk returns ${status}`,
        'A server error on a static file makes the script load fail; in webpack builds the message reads "Loading chunk N failed. (error: <url>)". Unlike a 404, this is usually transient — but it is not a caching problem.');
    } else if (status >= 200 && status < 300) {
      if (isHtml) {
        // webpack runtime: a script that "loads" but never registers its chunk
        // yields errorType 'missing' (event.type === 'load' ? 'missing' : …).
        // MDN nosniff: destination "script" + non-JS MIME → blocked.
        add('chunk-html-fallback', 'critical', 'The chunk URL returns an HTML page (200, text/html)',
          `The server answered a JavaScript request with HTML — a rewrite or single-page-app fallback is catching a missing file and returning your page instead of a 404. ${nosniff
            ? 'With X-Content-Type-Options: nosniff the browser blocks it outright; in webpack builds the message reads "Loading chunk N failed. (error: <url>)".'
            : 'The browser tries to run the HTML as JavaScript and fails; the chunk never registers, so in webpack builds the message reads "Loading chunk N failed. (missing: <url>)".'} Either way the real file is missing, and the fallback hides the 404 from your monitoring.`);
      } else if (expectCss && !CSS_MIME.test(ct)) {
        // HTML Standard, link type "stylesheet": "If the resource's
        // Content-Type metadata is not text/css, then set success to false."
        // No nosniff condition; the only exception is a quirks-mode,
        // same-origin document. Source: https://html.spec.whatwg.org/multipage/links.html#link-type-stylesheet
        add('chunk-css-wrong-mime', 'critical', ct ? `The CSS chunk is served as ${ct}, not text/css` : 'The CSS chunk is served without a Content-Type',
          'The HTML Standard makes a stylesheet fail when its Content-Type is not text/css, with or without X-Content-Type-Options: nosniff (the only exception is a quirks-mode page on the same origin, and Next.js pages are not in quirks mode). The link element fires its error event, which is what "Loading CSS chunk N failed" reports.');
      } else if (ct && nosniff && !expectCss && !(JS_MIME.test(ct) || CSS_MIME.test(ct))) {
        add('chunk-wrong-mime', 'warning', `The chunk is served as ${ct} with nosniff`,
          `For a script request, X-Content-Type-Options: nosniff makes the browser block any response whose MIME type is not a JavaScript type. The file exists, but it will never run.`);
      } else {
        passes.push({ ruleId: 'chunk-missing', text: `The chunk exists (${status}${ct ? `, ${ct}` : ''}).` });
      }
      checkImmutable();
    } else {
      // Any other final status (401, 403, 400, 429…) is not an "ok status".
      // HTML Standard, fetch a classic script: "response's status is not an
      // ok status … run onComplete given null" → the script's error event.
      // S3 answers 403 (not 404) for a missing key without s3:ListBucket.
      // Sources: https://html.spec.whatwg.org/multipage/webappapis.html#fetch-a-classic-script
      //          https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
      const is4xx = status >= 400 && status < 500;
      let detail = '';
      if (status === 403) detail = ' A 403 on a static file often means the file is simply gone: Amazon S3 (and CloudFront in front of it) returns "403 Access Denied" instead of 404 for a missing object when the reader lacks the s3:ListBucket permission. Otherwise a WAF, bucket policy or auth rule is refusing it.';
      else if (status === 401) detail = ' A 401 means authentication stands in front of the static file: an auth proxy/middleware, or deployment protection on a preview URL.';
      add('chunk-blocked', is4xx ? 'critical' : 'warning', `The chunk returns ${status}: the browser cannot load it`,
        `Only a 2xx response runs as a script: the HTML Standard fails any other status, so in webpack builds the message reads "Loading chunk N failed. (error: <url>)".${detail}`,
        { status });
    }
  }

  // ---- deployment ids -----------------------------------------------------
  // deploymentId doc: Next.js adds x-nextjs-deployment-id to navigation
  // responses and ?dpl=<id> to static asset URLs; a mismatch triggers a hard
  // navigation. Source: https://nextjs.org/docs/app/api-reference/config/next-config-js/deploymentId
  const htmlDpl = getHeader(html, 'x-nextjs-deployment-id');
  const chunkDpl = getHeader(chunk, 'x-nextjs-deployment-id')
    || dplFromTarget(chunkParsed.requestTargets[chunkParsed.requestTargets.length - 1]);
  if (htmlDpl && chunkDpl) {
    if (htmlDpl.trim() !== chunkDpl.trim()) {
      add('deployment-id-mismatch', 'warning', 'HTML and chunk belong to different deployments',
        `The page reports deployment "${maskUrlSecrets(htmlDpl)}" but the chunk carries "${maskUrlSecrets(chunkDpl)}". Next.js compares deployment ids and, on a mismatch, does a full page reload instead of a client-side navigation — a chunk URL from another deployment is the version skew that reload exists for.`);
    } else {
      passes.push({ ruleId: 'deployment-id-mismatch', text: `HTML and chunk share deployment id "${maskUrlSecrets(htmlDpl)}".` });
    }
  }

  // ---- service worker -----------------------------------------------------
  // MDN Cache: "Items in a Cache do not get updated unless explicitly
  // requested; they don't expire unless deleted." Source: https://developer.mozilla.org/en-US/docs/Web/API/Cache
  if (serviceWorker) {
    const htmlClean = !findings.some((f) => f.ruleId.startsWith('html-') && f.severity !== 'info');
    add('service-worker-cache', 'warning', 'Your service worker can serve old HTML whatever these headers say',
      `curl never runs a service worker, so these headers ${htmlClean ? 'look clean but ' : ''}do not show what a returning visitor gets. Entries in the Cache API "do not get updated unless explicitly requested; they don't expire unless deleted" — a worker that answers navigations from its cache keeps serving pre-deploy HTML, and its chunk URLs 404.`);
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const INCOMPLETE_RULES = new Set(['input-missing', 'input-unparsed', 'input-no-status', 'html-redirect']);
  const incomplete = findings.some((f) => INCOMPLETE_RULES.has(f.ruleId));
  const verdict = counts.critical ? 'cause-found' : counts.warning ? 'suspects' : incomplete ? 'incomplete' : 'clean';

  return {
    findings,
    passes,
    counts,
    verdict,
    host: effectiveHost,
    detectedHosts: detected,
    html: html ? { status: html.status, httpVersion: html.httpVersion, headers: maskedHeaders(html) } : null,
    chunk: chunk ? { status: chunk.status, httpVersion: chunk.httpVersion, headers: maskedHeaders(chunk) } : null,
  };
}

// Realistic example: Cloudflare "cache everything" in front of a Next.js app,
// one deploy later.
export const EXAMPLE_HTML = `HTTP/2 200
date: Fri, 25 Sep 2026 09:12:04 GMT
content-type: text/html; charset=utf-8
cache-control: public, max-age=14400
cf-cache-status: HIT
age: 5231
x-nextjs-deployment-id: dpl_3f9a1c
server: cloudflare
cf-ray: 8c1f2e3d4a5b6c7d-LHR
set-cookie: session=abc123secret; Path=/; HttpOnly`;

export const EXAMPLE_CHUNK = `HTTP/2 404
date: Fri, 25 Sep 2026 09:12:05 GMT
content-type: text/plain; charset=utf-8
cf-cache-status: HIT
age: 41
server: cloudflare
cf-ray: 8c1f2e3e5b6c7d8e-LHR`;
