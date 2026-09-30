/**
 * chunk-cache-explainer — every diagnostic rule gets a positive case and at
 * least one input that must NOT trigger it. Header shapes are real curl
 * output (HTTP/1.1 with CRLF, HTTP/2 lower-case, curl -v, curl -L chains) and
 * real values documented by Next.js, Cloudflare, Vercel, Netlify and nginx.
 */

import { describe, it, expect } from '@jest/globals';
import {
  parseResponseHeaders, finalResponse, getHeader, parseCacheControl, parseCacheStatus,
  cacheLayers, detectHosts, maskHeaderValue, maskUrlSecrets, diagnose, RULES,
  EXAMPLE_HTML, EXAMPLE_CHUNK,
} from '../src/chunk-cache-explainer.js';

const ids = (r) => r.findings.map((f) => f.ruleId);
const byId = (r, id) => r.findings.find((f) => f.ruleId === id);

// Next.js dynamic page, straight from the docs' documented header value.
const NEXT_DYNAMIC_HTML = 'HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: private, no-cache, no-store, max-age=0, must-revalidate\r\nX-Powered-By: Next.js\r\n';
// A healthy hashed chunk (Next.js immutable header).
const GOOD_CHUNK = `HTTP/2 200
content-type: application/javascript; charset=UTF-8
cache-control: public, max-age=31536000, immutable
content-length: 18234`;

describe('parseResponseHeaders', () => {
  it('parses HTTP/1.1 with CRLF and case-insensitive names', () => {
    const p = parseResponseHeaders(NEXT_DYNAMIC_HTML);
    const r = finalResponse(p);
    expect(r.status).toBe(200);
    expect(r.httpVersion).toBe('1.1');
    expect(getHeader(r, 'CACHE-CONTROL')).toMatch(/no-store/);
  });

  it('parses HTTP/2 and HTTP/3 status lines', () => {
    expect(finalResponse(parseResponseHeaders('HTTP/2 404\ncontent-type: text/html')).status).toBe(404);
    expect(finalResponse(parseResponseHeaders('HTTP/3 200\nage: 12')).httpVersion).toBe('3');
  });

  it('keeps the last final response of a curl -L chain and skips 100 Continue', () => {
    const p = parseResponseHeaders(`HTTP/1.1 100 Continue

HTTP/1.1 307 Temporary Redirect
Location: /login?next=%2F_next%2Fstatic%2Fchunks%2F5760.js

HTTP/1.1 200 OK
Content-Type: text/html`);
    expect(p.blocks).toHaveLength(3);
    expect(finalResponse(p).status).toBe(200);
  });

  it('understands curl -v prefixes and captures the request target', () => {
    const p = parseResponseHeaders(`* Connected to example.com (93.184.215.14) port 443
> HEAD /_next/static/chunks/5760-40c839657ea31a15.js?dpl=dpl_new HTTP/2
> Host: example.com
> Authorization: Bearer should-not-appear
< HTTP/2 200
< content-type: application/javascript`);
    expect(p.requestTargets[0]).toMatch(/dpl=dpl_new/);
    const r = finalResponse(p);
    expect(getHeader(r, 'authorization')).toBeNull(); // request headers are never read as response headers
  });

  it('joins repeated headers', () => {
    const r = finalResponse(parseResponseHeaders('HTTP/2 200\ncache-control: public\ncache-control: max-age=60'));
    expect(parseCacheControl(getHeader(r, 'cache-control'))['max-age']).toBe('60');
  });

  it('returns nothing for empty or garbage input and never throws', () => {
    expect(parseResponseHeaders('').blocks).toEqual([]);
    expect(parseResponseHeaders(undefined).blocks).toEqual([]);
    expect(parseResponseHeaders('lorem ipsum dolor\n!!!\n{{}}').blocks).toEqual([]);
  });
});

describe('parseCacheControl / parseCacheStatus', () => {
  it('parses directives and quoted values', () => {
    const cc = parseCacheControl('public, max-age=31536000, immutable, no-cache="set-cookie"');
    expect(cc.public).toBe(true);
    expect(cc['max-age']).toBe('31536000');
    expect(cc.immutable).toBe(true);
    expect(cc['no-cache']).toBe('set-cookie');
  });

  it('parses the Netlify RFC 9211 examples', () => {
    expect(parseCacheStatus('"Netlify Edge"; hit')[0]).toMatchObject({ cache: 'Netlify Edge', hit: true });
    expect(parseCacheStatus('"Netlify Edge"; fwd=miss')[0]).toMatchObject({ hit: false, fwd: 'miss' });
  });
});

describe('secret masking', () => {
  it('masks cookies, authorization and token-like query parameters', () => {
    expect(maskHeaderValue('set-cookie', 'session=abc123secret; Path=/; HttpOnly')).toBe('session=****; Path=/; HttpOnly');
    expect(maskHeaderValue('Authorization', 'Bearer eyJhbGciOi')).toBe('****');
    expect(maskUrlSecrets('https://x.s3.amazonaws.com/a.js?X-Amz-Signature=deadbeef&v=2')).toBe('https://x.s3.amazonaws.com/a.js?X-Amz-Signature=****&v=2');
    expect(maskUrlSecrets('https://user:hunter2@example.com/login?token=abc&next=/')).toBe('https://user:****@example.com/login?token=****&next=/');
  });

  it('never echoes a secret in the diagnosis output', () => {
    const r = diagnose({ htmlHeaders: EXAMPLE_HTML, chunkHeaders: EXAMPLE_CHUNK });
    expect(JSON.stringify(r)).not.toContain('abc123secret');
  });
});

describe('host detection', () => {
  it('detects Cloudflare, Vercel, Netlify and nginx from their documented headers', () => {
    const b = (t) => finalResponse(parseResponseHeaders(t));
    expect(detectHosts(b('HTTP/2 200\ncf-ray: 8c1f-LHR\ncf-cache-status: DYNAMIC'))).toEqual(['cloudflare']);
    expect(detectHosts(b('HTTP/2 200\nserver: Vercel\nx-vercel-cache: PRERENDER'))).toEqual(['vercel']);
    expect(detectHosts(b('HTTP/2 200\ncache-status: "Netlify Edge"; fwd=miss'))).toEqual(['netlify']);
    expect(detectHosts(b('HTTP/1.1 200 OK\nServer: nginx/1.25.3'))).toEqual(['nginx']);
  });
});

describe('diagnose — HTML document rules', () => {
  it('the dynamic Next.js default header is a pass, not a finding', () => {
    const r = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: GOOD_CHUNK });
    expect(r.findings).toEqual([]);
    expect(r.verdict).toBe('clean');
    expect(r.passes.length).toBeGreaterThanOrEqual(2);
  });

  it('flags immutable HTML as critical', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: public, max-age=31536000, immutable' });
    expect(byId(r, 'html-immutable').severity).toBe('critical');
    expect(ids(r)).not.toContain('html-browser-max-age');
  });

  it('does NOT flag immutable when max-age=0 (RFC 8246 only applies while fresh)', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: max-age=0, immutable' });
    expect(ids(r)).not.toContain('html-immutable');
    expect(ids(r)).not.toContain('html-browser-max-age');
  });

  it('flags a browser max-age on HTML, but not no-cache with max-age', () => {
    const hit = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: public, max-age=600' });
    expect(byId(hit, 'html-browser-max-age').severity).toBe('warning');
    const long = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: max-age=86400' });
    expect(byId(long, 'html-browser-max-age').severity).toBe('critical');
    const miss = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: no-cache, max-age=600' });
    expect(ids(miss)).not.toContain('html-browser-max-age');
  });

  it('Cloudflare HIT on HTML is critical (HTML is not cached by default)', () => {
    const r = diagnose({ htmlHeaders: EXAMPLE_HTML, chunkHeaders: EXAMPLE_CHUNK });
    expect(byId(r, 'html-cf-cache-hit').severity).toBe('critical');
    expect(r.host).toBe('cloudflare');
    expect(r.verdict).toBe('cause-found');
  });

  it('cf-cache-status DYNAMIC, x-vercel-cache PRERENDER and Age: 0 do not count as stale HTML', () => {
    const cf = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncf-cache-status: DYNAMIC\nage: 0' });
    expect(ids(cf).filter((i) => i.startsWith('html-'))).toEqual([]);
    const v = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: public, max-age=0, must-revalidate\nx-vercel-cache: PRERENDER\nage: 0' });
    expect(ids(v).filter((i) => i.startsWith('html-'))).toEqual([]);
  });

  it('a Netlify HTML hit is informational, never a warning', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: public, max-age=0, must-revalidate\ncache-status: "Netlify Edge"; hit\nage: 900' });
    expect(byId(r, 'html-netlify-cache-hit').severity).toBe('info');
    expect(ids(r)).not.toContain('html-age');
    expect(r.counts.warning + r.counts.critical).toBe(0);
  });

  it('a Vercel HTML HIT is informational and points at Skew Protection', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: public, max-age=0, must-revalidate\nx-vercel-cache: HIT\nage: 3000' });
    const f = byId(r, 'html-vercel-cache-hit');
    expect(f.severity).toBe('info');
    expect(f.fix).toMatch(/Skew Protection/);
  });

  it('nginx X-Cache-Status HIT on HTML is a warning with an nginx fix', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nServer: nginx/1.25.3\nContent-Type: text/html\nX-Cache-Status: HIT' });
    const f = byId(r, 'html-nginx-cache-hit');
    expect(f.severity).toBe('warning');
    expect(f.code).toMatch(/proxy_no_cache/);
  });

  it('s-maxage on HTML is a warning only with evidence of a shared cache', () => {
    const noEvidence = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: s-maxage=31536000' });
    expect(byId(noEvidence, 'html-shared-cacheable').severity).toBe('info');
    const withCf = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: s-maxage=3600, stale-while-revalidate\ncf-cache-status: MISS' });
    expect(byId(withCf, 'html-shared-cacheable').severity).toBe('warning');
  });

  it('s-maxage with cf-cache-status DYNAMIC stays info (real next-on-pages ISR header)', () => {
    // Captured from www.iloveblogs.blog (Cloudflare Pages + next-on-pages), 2026-09-25.
    const r = diagnose({ htmlHeaders: `HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: public, max-age=0, s-maxage=3600, stale-while-revalidate=86400
x-nextjs-prerender: 1
cf-cache-status: DYNAMIC
Server: cloudflare` });
    const f = byId(r, 'html-shared-cacheable');
    expect(f.severity).toBe('info');
    expect(f.why).toMatch(/did not store it/);
    expect(ids(r)).not.toContain('html-browser-max-age');
  });

  it('Age > 0 with no named cache is reported', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nAge: 1800' });
    expect(byId(r, 'html-age').severity).toBe('warning');
  });
});

describe('diagnose — chunk rules', () => {
  it('404 chunk is critical and explains the webpack (error:) variant', () => {
    const r = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: 'HTTP/2 404\ncontent-type: text/html; charset=utf-8' });
    const f = byId(r, 'chunk-missing');
    expect(f.severity).toBe('critical');
    expect(f.why).toMatch(/\(error: <url>\)/);
    expect(ids(r)).not.toContain('chunk-html-fallback'); // a 404 HTML body is a 404, not a fallback
  });

  it('Cloudflare cached 404 adds the 3-minute negative-cache finding', () => {
    const r = diagnose({ chunkHeaders: EXAMPLE_CHUNK });
    expect(ids(r)).toEqual(expect.arrayContaining(['chunk-missing', 'chunk-404-cached']));
  });

  it('200 text/html on a chunk is the SPA-fallback trap', () => {
    const r = diagnose({ chunkHeaders: 'HTTP/1.1 200 OK\nServer: nginx\nContent-Type: text/html\n', host: 'nginx' });
    const f = byId(r, 'chunk-html-fallback');
    expect(f.severity).toBe('critical');
    expect(f.why).toMatch(/missing: <url>/);
    expect(f.code).toMatch(/try_files \$uri =404/);
    expect(ids(r)).not.toContain('chunk-not-immutable');
  });

  it('with nosniff the HTML fallback is reported as blocked (error:)', () => {
    const r = diagnose({ chunkHeaders: 'HTTP/2 200\ncontent-type: text/html\nx-content-type-options: nosniff' });
    expect(byId(r, 'chunk-html-fallback').why).toMatch(/blocks it outright/);
  });

  it('a redirected chunk (auth middleware) is critical and the Location is masked', () => {
    const r = diagnose({ chunkHeaders: 'HTTP/2 307\nlocation: https://app.example.com/login?token=s3cr3t&next=/_next/static/chunks/app/layout.js' });
    const f = byId(r, 'chunk-redirect');
    expect(f.severity).toBe('critical');
    expect(f.code).toMatch(/_next\/static/);
    expect(JSON.stringify(r)).not.toContain('s3cr3t');
  });

  it('a non-immutable chunk is info (performance), and host-specific on Netlify', () => {
    const r = diagnose({ chunkHeaders: 'HTTP/2 200\ncontent-type: application/javascript\ncache-control: public, max-age=0, must-revalidate\ncache-status: "Netlify Edge"; hit' });
    const f = byId(r, 'chunk-not-immutable');
    expect(f.severity).toBe('info');
    expect(f.fix).toMatch(/Netlify/);
    expect(r.counts.critical + r.counts.warning).toBe(0);
  });

  it('the healthy immutable chunk produces no chunk finding', () => {
    const r = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: GOOD_CHUNK });
    expect(ids(r).filter((i) => i.startsWith('chunk-'))).toEqual([]);
  });

  it('wrong MIME type under nosniff is flagged; the same MIME without nosniff is not', () => {
    const bad = diagnose({ chunkHeaders: 'HTTP/2 200\ncontent-type: application/octet-stream\nx-content-type-options: nosniff\ncache-control: public, max-age=31536000, immutable' });
    expect(byId(bad, 'chunk-wrong-mime').severity).toBe('warning');
    const ok = diagnose({ chunkHeaders: 'HTTP/2 200\ncontent-type: text/css\nx-content-type-options: nosniff\ncache-control: public, max-age=31536000, immutable' });
    expect(ids(ok)).not.toContain('chunk-wrong-mime');
  });

  it('a 5xx chunk is a warning, not a cache finding', () => {
    const r = diagnose({ chunkHeaders: 'HTTP/1.1 502 Bad Gateway\nServer: nginx' });
    expect(byId(r, 'chunk-server-error').severity).toBe('warning');
  });
});

describe('diagnose — deployment id, service worker, bad input', () => {
  it('flags mismatched deployment ids (?dpl= on the chunk vs header on the HTML)', () => {
    const r = diagnose({
      htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: private, no-cache, no-store, max-age=0, must-revalidate\nx-nextjs-deployment-id: dpl_new',
      chunkHeaders: '> GET /_next/static/chunks/5760-40c839657ea31a15.js?dpl=dpl_old HTTP/2\n< HTTP/2 200\n< content-type: application/javascript\n< cache-control: public, max-age=31536000, immutable',
    });
    expect(byId(r, 'deployment-id-mismatch').severity).toBe('warning');
  });

  it('matching deployment ids are a pass', () => {
    const r = diagnose({
      htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\nx-nextjs-deployment-id: dpl_same',
      chunkHeaders: '> GET /_next/static/chunks/a.js?dpl=dpl_same HTTP/2\n< HTTP/2 200\n< content-type: application/javascript\n< cache-control: public, max-age=31536000, immutable',
    });
    expect(ids(r)).not.toContain('deployment-id-mismatch');
    expect(r.passes.some((p) => p.ruleId === 'deployment-id-mismatch')).toBe(true);
  });

  it('the service-worker checkbox adds its warning only when ticked', () => {
    expect(ids(diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: GOOD_CHUNK, serviceWorker: true }))).toContain('service-worker-cache');
    expect(ids(diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: GOOD_CHUNK, serviceWorker: false }))).not.toContain('service-worker-cache');
  });

  it('empty input asks for both pastes; garbage input reports unparsed', () => {
    const empty = diagnose({});
    expect(ids(empty).filter((i) => i === 'input-missing')).toHaveLength(2);
    const junk = diagnose({ htmlHeaders: 'this is not a header dump', chunkHeaders: '<!doctype html><html>' });
    expect(ids(junk).filter((i) => i === 'input-unparsed')).toHaveLength(2);
    expect(junk.verdict).toBe('incomplete');
    expect(empty.verdict).toBe('incomplete');
    expect(() => diagnose(null)).not.toThrow();
  });

  it('a half-pasted input is incomplete, not clean', () => {
    expect(diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML }).verdict).toBe('incomplete');
  });

  it('a malformed %-escape in ?dpl= does not throw', () => {
    const run = () => diagnose({
      htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\nx-nextjs-deployment-id: dpl_new',
      chunkHeaders: '> GET /_next/static/chunks/a.js?dpl=%zz HTTP/2\n< HTTP/2 200\n< content-type: application/javascript',
    });
    expect(run).not.toThrow();
    expect(ids(run())).toContain('deployment-id-mismatch');
  });

  it('curl -L http→https 301 ending on the JS file is NOT a chunk redirect', () => {
    const r = diagnose({ chunkHeaders: `HTTP/1.1 301 Moved Permanently
Location: https://example.com/_next/static/chunks/5760-40c839657ea31a15.js

HTTP/2 200
content-type: application/javascript; charset=UTF-8
cache-control: public, max-age=31536000, immutable` });
    expect(ids(r)).not.toContain('chunk-redirect');
  });

  it('curl -L chain ending on a login page IS a chunk redirect', () => {
    const r = diagnose({ chunkHeaders: `HTTP/2 307
location: /login

HTTP/2 200
content-type: text/html; charset=utf-8` });
    expect(ids(r)).toEqual(expect.arrayContaining(['chunk-redirect', 'chunk-html-fallback']));
  });

  it('masks secret-looking headers that are not on the fixed list', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\nx-access-token: abc-very-secret\nx-supabase-auth: eyJhbGci' });
    const out = JSON.stringify(r);
    expect(out).not.toContain('abc-very-secret');
    expect(out).not.toContain('eyJhbGci');
  });

  it('cf-cache-status REVALIDATED on HTML is a warning, not critical', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncf-cache-status: REVALIDATED' });
    expect(byId(r, 'html-cf-cache-hit').severity).toBe('warning');
  });

  it('warns when the chunk path is not under /_next/static/', () => {
    const r = diagnose({ chunkHeaders: 'https://example.com/favicon.ico\nHTTP/2 200\ncontent-type: image/x-icon' });
    expect(ids(r)).toContain('chunk-not-static-path');
  });
});

describe('sources', () => {
  it('every rule and every emitted finding cites an https primary source from RULES', () => {
    const ruleSources = new Set(RULES.map((r) => r.source));
    for (const r of RULES) expect(r.source).toMatch(/^https:\/\//);
    const inputs = [
      { htmlHeaders: EXAMPLE_HTML, chunkHeaders: EXAMPLE_CHUNK, serviceWorker: true },
      { htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncache-control: public, max-age=31536000, immutable\ncache-status: ExampleCache; hit\nx-nextjs-deployment-id: a', chunkHeaders: 'HTTP/2 307\nlocation: /login' },
      { chunkHeaders: 'HTTP/2 200\ncontent-type: text/html' },
      {},
    ];
    for (const input of inputs) {
      for (const f of diagnose(input).findings) {
        expect(ruleSources.has(f.source)).toBe(true);
        expect(RULES.some((r) => r.id === f.ruleId)).toBe(true);
      }
    }
  });

  it('cacheLayers reports RFC 9211 hits from unknown caches', () => {
    const b = finalResponse(parseResponseHeaders('HTTP/2 200\ncache-status: ExampleCache; hit; ttl=376'));
    expect(cacheLayers(b)[0]).toMatchObject({ layer: 'cache-status', fromCache: true });
  });
});

describe('regressions from the adversarial review (2026-09-25)', () => {
  const IMMUTABLE_JS = 'HTTP/2 200\ncontent-type: application/javascript\ncache-control: public, max-age=31536000, immutable';

  it('a 304 chunk is a revalidation (RFC 9110 §15.4.5), never a redirect', () => {
    const r = diagnose({
      htmlHeaders: NEXT_DYNAMIC_HTML,
      chunkHeaders: 'HTTP/1.1 304 Not Modified\ncache-control: public, max-age=0, must-revalidate\netag: "abc"\nserver: Netlify',
      host: 'netlify',
    });
    expect(ids(r)).not.toContain('chunk-redirect');
    expect(r.counts.critical + r.counts.warning).toBe(0);
    expect(r.passes.some((p) => p.ruleId === 'chunk-revalidated')).toBe(true);
    // a 301 → 304 curl -L chain ends on the asset too
    const chain = diagnose({ chunkHeaders: 'HTTP/1.1 301 Moved Permanently\nLocation: https://x.com/_next/static/chunks/a.js\n\nHTTP/1.1 304 Not Modified\netag: "a"' });
    expect(ids(chain)).not.toContain('chunk-redirect');
  });

  it('a 403 / 401 / 429 chunk is critical, never clean; 403 mentions S3 missing keys', () => {
    const s3 = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: 'HTTP/2 403\ncontent-type: application/xml\nserver: AmazonS3\nx-cache: Error from cloudfront' });
    expect(byId(s3, 'chunk-blocked').severity).toBe('critical');
    expect(byId(s3, 'chunk-blocked').why).toMatch(/s3:ListBucket/);
    expect(s3.verdict).toBe('cause-found');
    const auth = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: 'HTTP/2 401\ncontent-type: text/html\nserver: Vercel' });
    expect(byId(auth, 'chunk-blocked').fix).toMatch(/Deployment Protection/);
    expect(auth.verdict).toBe('cause-found');
    expect(byId(diagnose({ chunkHeaders: 'HTTP/2 429' }), 'chunk-blocked').severity).toBe('critical');
  });

  it('cf-cache-status MISS / EXPIRED on HTML is a cache-eligible warning, not a "no cache" pass', () => {
    const miss = diagnose({ htmlHeaders: `${NEXT_DYNAMIC_HTML}cf-cache-status: MISS\r\ncf-ray: 1-LHR\r\n`, chunkHeaders: GOOD_CHUNK });
    expect(byId(miss, 'html-cf-cache-eligible').severity).toBe('warning');
    expect(miss.verdict).toBe('suspects');
    expect(miss.passes.some((p) => /No cache served/.test(p.text))).toBe(false);
    expect(byId(diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncf-cache-status: EXPIRED' }), 'html-cf-cache-eligible').severity).toBe('warning');
    expect(byId(diagnose({ htmlHeaders: 'HTTP/2 200\ncontent-type: text/html\ncf-cache-status: BYPASS' }), 'html-cf-cache-eligible').severity).toBe('info');
    // DYNAMIC is "not eligible": still a pass
    const dyn = diagnose({ htmlHeaders: `${NEXT_DYNAMIC_HTML}cf-cache-status: DYNAMIC\r\n`, chunkHeaders: GOOD_CHUNK });
    expect(ids(dyn)).not.toContain('html-cf-cache-eligible');
    expect(dyn.verdict).toBe('clean');
  });

  it('Expires without max-age is browser freshness (RFC 9111 §4.2.1)', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nDate: Fri, 25 Sep 2026 09:00:00 GMT\nExpires: Sat, 26 Sep 2026 09:00:00 GMT', chunkHeaders: IMMUTABLE_JS });
    const f = byId(r, 'html-expires');
    expect(f.severity).toBe('critical');
    expect(f.why).toMatch(/86400 seconds/);
    // Expires: 0 is "already expired": no finding
    expect(ids(diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nDate: Fri, 25 Sep 2026 09:00:00 GMT\nExpires: 0' }))).not.toContain('html-expires');
    // an explicit no-cache wins over Expires
    expect(ids(diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: no-cache\nDate: Fri, 25 Sep 2026 09:00:00 GMT\nExpires: Sat, 26 Sep 2026 09:00:00 GMT' }))).not.toContain('html-expires');
  });

  it('Last-Modified without explicit freshness is heuristic freshness (RFC 9111 §4.2.2)', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nServer: nginx/1.25.3\nDate: Fri, 25 Sep 2026 09:00:00 GMT\nContent-Type: text/html\nLast-Modified: Mon, 01 Jun 2026 00:00:00 GMT\nETag: "abc"', chunkHeaders: IMMUTABLE_JS });
    const f = byId(r, 'html-heuristic-freshness');
    expect(f.severity).toBe('warning');
    expect(f.title).toMatch(/\d+(\.\d)? days/); // 10% of ~116 days
    expect(f.fix).toMatch(/no-cache/);
    expect(ids(diagnose({ htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nCache-Control: no-cache\nLast-Modified: Mon, 01 Jun 2026 00:00:00 GMT' }))).not.toContain('html-heuristic-freshness');
  });

  it('a chunk paste without a status line is never clean; text/html still raises the fallback', () => {
    const r = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: 'content-type: text/html; charset=utf-8\ncache-control: private, no-cache, no-store, max-age=0, must-revalidate\nx-powered-by: Next.js' });
    expect(ids(r)).toContain('input-no-status');
    expect(byId(r, 'chunk-html-fallback').severity).toBe('warning');
    expect(r.verdict).not.toBe('clean');
    const js = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: 'content-type: application/javascript' });
    expect(js.verdict).toBe('incomplete');
  });

  it('parses the HTTP/2 ":status" and ":path" pseudo-headers', () => {
    const r = diagnose({ htmlHeaders: NEXT_DYNAMIC_HTML, chunkHeaders: ':status: 404\ncontent-type: text/html; charset=utf-8\ndate: Fri, 25 Sep 2026 09:00:00 GMT' });
    expect(r.chunk.status).toBe(404);
    expect(byId(r, 'chunk-missing').severity).toBe('critical');
    expect(ids(r)).not.toContain('input-no-status');
    const p = parseResponseHeaders(':path: /_next/static/css/a.css\ncontent-type: text/css\n:status: 200');
    expect(p.requestTargets).toEqual(['/_next/static/css/a.css']);
    expect(finalResponse(p).status).toBe(200);
  });

  it('a CSS chunk with a non-text/css type fails with or without nosniff (HTML Standard)', () => {
    const plain = diagnose({ chunkHeaders: '> GET /_next/static/css/abc.css HTTP/2\n< HTTP/2 200\n< content-type: text/plain\n< cache-control: public, max-age=31536000, immutable' });
    expect(byId(plain, 'chunk-css-wrong-mime').severity).toBe('critical');
    expect(plain.passes.some((p) => /chunk exists/.test(p.text))).toBe(false);
    const octet = diagnose({ chunkHeaders: 'https://example.com/_next/static/css/a1b2c3.css\nHTTP/2 200\ncontent-type: application/octet-stream\ncache-control: public, max-age=31536000, immutable' });
    expect(ids(octet)).toContain('chunk-css-wrong-mime');
    const ok = diagnose({ chunkHeaders: 'https://example.com/_next/static/css/a1b2c3.css\nHTTP/2 200\ncontent-type: text/css; charset=utf-8\ncache-control: public, max-age=31536000, immutable' });
    expect(ids(ok).filter((i) => i.startsWith('chunk-'))).toEqual([]);
    // JS without nosniff keeps its behaviour (no MIME finding)
    const js = diagnose({ chunkHeaders: 'https://example.com/_next/static/chunks/a.js\nHTTP/2 200\ncontent-type: text/plain\ncache-control: public, max-age=31536000, immutable' });
    expect(ids(js)).not.toContain('chunk-wrong-mime');
    expect(ids(js)).not.toContain('chunk-css-wrong-mime');
  });

  it('a 3xx page paste is reported as a redirect and its headers are not diagnosed as the HTML', () => {
    const r = diagnose({ htmlHeaders: 'HTTP/2 307\nlocation: /en\ncache-control: public, max-age=3600', chunkHeaders: GOOD_CHUNK });
    expect(ids(r)).toContain('html-redirect');
    expect(ids(r)).not.toContain('html-browser-max-age');
    expect(r.verdict).toBe('incomplete');
    expect(byId(r, 'html-redirect').fix).toMatch(/curl -sIL/);
  });

  it('masks tokens in URL fragments', () => {
    expect(maskUrlSecrets('https://app.example.com/cb#access_token=eyJsecret&state=x')).toBe('https://app.example.com/cb#access_token=****&state=x');
    const r = diagnose({ chunkHeaders: 'HTTP/2 302\nlocation: https://app.example.com/cb#access_token=eyJsecret&state=x' });
    expect(JSON.stringify(r)).not.toContain('eyJsecret');
  });

  it('degenerate 200 KB pastes stay fast (no quadratic regex)', () => {
    const inputs = [
      { htmlHeaders: `HTTP/1.1 200${' '.repeat(200000)}x` },
      { htmlHeaders: `${' \t'.repeat(100000)}x` },
      { htmlHeaders: `HTTP/2 200\nlink: ${'a+'.repeat(100000)}` },
      { chunkHeaders: `HTTP/2 307\nlocation: ${'a?'.repeat(100000)}` },
      { chunkHeaders: `HTTP/2 307\nlocation: ${'://a'.repeat(50000)}` },
    ];
    const t0 = Date.now();
    for (const input of inputs) diagnose(input);
    maskUrlSecrets('a+'.repeat(100000));
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('every new rule cites a source listed in RULES', () => {
    const ruleSources = new Set(RULES.map((r) => r.source));
    const inputs = [
      { htmlHeaders: 'HTTP/2 307\nlocation: /en', chunkHeaders: 'HTTP/2 403' },
      { htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\ncf-cache-status: MISS\nLast-Modified: Mon, 01 Jun 2026 00:00:00 GMT', chunkHeaders: 'content-type: text/html' },
      { htmlHeaders: 'HTTP/1.1 200 OK\nContent-Type: text/html\nDate: Fri, 25 Sep 2026 09:00:00 GMT\nExpires: Sat, 26 Sep 2026 09:00:00 GMT', chunkHeaders: 'https://e.com/_next/static/css/a.css\nHTTP/2 200\ncontent-type: text/plain' },
    ];
    for (const input of inputs) {
      for (const f of diagnose(input).findings) {
        expect(ruleSources.has(f.source)).toBe(true);
        expect(f.source).toMatch(/^https:\/\//);
      }
    }
  });
});
