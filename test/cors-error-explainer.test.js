/**
 * cors-error-explainer — every rule is exercised with the real browser wording
 * it was built from (Chromium cors_error_string.cc, WebKit
 * CrossOriginAccessControl.cpp / CrossOriginPreflightResultCache.cpp /
 * ThreadableLoader.cpp, Mozilla's MDN CORS error reference), plus negative
 * cases that must NOT fire and garbage input.
 */
import {
  diagnose,
  parseConsoleError,
  parseHeaders,
  maskSecrets,
  buildFix,
  fixParams,
  describeOriginDiff,
  STACKS,
  EXAMPLES,
} from '../src/cors-error-explainer.js';

const ids = (r) => r.findings.map((f) => f.id);

// Chrome wrapper as built by Chromium GetErrorStringForConsoleMessage.
const chrome = (reason, { url = 'https://api.example.com/v1/items', origin = 'http://localhost:3000', preflight = false } = {}) =>
  `Access to fetch at '${url}' from origin '${origin}' has been blocked by CORS policy: ${preflight ? "Response to preflight request doesn't pass access control check: " : ''}${reason}`;

// Firefox wrapper as quoted on MDN's CORS errors page.
const firefox = (reason, url = 'https://api.example.com/v1/items', status = 200) =>
  `Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at ${url}. (Reason: ${reason}). Status code: ${status}.`;

describe('cors-error-explainer — missing Access-Control-Allow-Origin', () => {
  test('Chrome simple request: missing header, context parsed', () => {
    const r = diagnose({ error: chrome("No 'Access-Control-Allow-Origin' header is present on the requested resource.") });
    expect(ids(r)).toContain('missing-allow-origin');
    expect(r.isCorsProblem).toBe(true);
    expect(r.context).toMatchObject({ browser: 'chrome', origin: 'http://localhost:3000', url: 'https://api.example.com/v1/items', preflight: false });
    expect(r.fix).not.toBeNull();
    expect(r.fix.code).toContain("'http://localhost:3000'");
    expect(r.findings[0].source.url).toMatch(/^https:\/\/developer\.mozilla\.org\//);
  });

  test('Chrome preflight variant is flagged as a preflight', () => {
    const r = diagnose({ error: chrome("No 'Access-Control-Allow-Origin' header is present on the requested resource.", { preflight: true }) });
    const f = r.findings.find((x) => x.id === 'missing-allow-origin');
    expect(r.context.preflight).toBe(true);
    expect(f.title).toMatch(/preflight/i);
  });

  test('Firefox wording, wrapped across lines by DevTools', () => {
    const text = "Cross-Origin Request Blocked: The Same Origin Policy disallows\n reading the remote resource at https://api.example.com/data.\n (Reason: CORS header \u2018Access-Control-Allow-Origin\u2019 missing). Status code: 200.";
    const r = diagnose({ error: text });
    expect(ids(r)).toContain('missing-allow-origin');
    expect(r.context.browser).toBe('firefox');
    expect(r.context.url).toBe('https://api.example.com/data');
    expect(ids(r)).not.toContain('server-error-behind-cors');
  });

  test('Safari "Origin … is not allowed" + generic line; Supabase URL picks the Supabase stack', () => {
    const r = diagnose({
      error: 'Origin https://app.example.com is not allowed by Access-Control-Allow-Origin. Status code: 204\nFetch API cannot load https://abcd.supabase.co/functions/v1/hello due to access control checks.',
    });
    expect(ids(r)).toContain('origin-not-allowed');
    expect(ids(r)).not.toContain('safari-generic');
    expect(r.context.browser).toBe('safari');
    expect(r.stack).toBe('supabase-edge');
    expect(r.stackGuessed).toBe(true);
    expect(r.fix.code).toContain("npm:@supabase/supabase-js@^2/cors");
  });
});

describe('cors-error-explainer — credentials', () => {
  test.each([
    ['Chrome', chrome("The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.")],
    ['Firefox', firefox("Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '*'")],
    ['Safari', 'Cannot use wildcard in Access-Control-Allow-Origin when credentials flag is true.'],
  ])('%s wildcard-with-credentials → explicit origin + Allow-Credentials in the fix', (_, error) => {
    const r = diagnose({ error, stack: 'express' });
    expect(ids(r)).toContain('wildcard-with-credentials');
    expect(r.context.credentials).toBe(true);
    expect(r.fix.code).toContain('credentials: true');
  });

  test.each([
    ['Chrome', chrome("The value of the 'Access-Control-Allow-Credentials' header in the response is '' which must be 'true' when the request's credentials mode is 'include'.")],
    ['Firefox', firefox("expected 'true' in CORS header 'Access-Control-Allow-Credentials'")],
    ['Safari', 'Credentials flag is true, but Access-Control-Allow-Credentials is not "true".'],
  ])('%s allow-credentials-not-true', (_, error) => {
    const r = diagnose({ error, stack: 'cloudflare-worker' });
    expect(ids(r)).toEqual(['allow-credentials-not-true']);
    expect(r.fix.code).toContain("'Access-Control-Allow-Credentials'] = 'true'");
    expect(r.fix.code).toContain("Vary: 'Origin'");
  });
});

describe('cors-error-explainer — origin value problems', () => {
  test.each([
    ['Chrome', chrome("The 'Access-Control-Allow-Origin' header contains multiple values 'https://a.com, https://b.com', but only one is allowed.")],
    ['Firefox', firefox("Multiple CORS header 'Access-Control-Allow-Origin' not allowed")],
    ['Safari', 'Access-Control-Allow-Origin cannot contain more than one origin.'],
  ])('%s multiple values', (_, error) => {
    expect(ids(diagnose({ error }))).toContain('multiple-allow-origin');
  });

  test('Chrome mismatch names the difference (www vs apex)', () => {
    const r = diagnose({
      error: chrome("The 'Access-Control-Allow-Origin' header has a value 'https://example.com' that is not equal to the supplied origin.", { origin: 'https://www.example.com' }),
    });
    const f = r.findings.find((x) => x.id === 'allow-origin-mismatch');
    expect(f).toBeDefined();
    expect(f.explanation).toMatch(/www vs no www/);
  });

  test('describeOriginDiff: trailing slash, scheme, port', () => {
    expect(describeOriginDiff('https://app.com/', 'https://app.com')).toMatch(/trailing slash/);
    expect(describeOriginDiff('http://app.com', 'https://app.com')).toMatch(/scheme http vs https/);
    expect(describeOriginDiff('http://localhost:3000', 'http://localhost:5173')).toMatch(/port 3000 vs 5173/);
    expect(describeOriginDiff('https://app.com', 'https://app.com')).toBeNull();
  });
});

describe('cors-error-explainer — preflight', () => {
  test('Chrome "not ok status" + net::ERR_FAILED 401 explains auth on OPTIONS', () => {
    const error = `${chrome('It does not have HTTP ok status.', { preflight: true })}\nPOST https://api.example.com/v1/items net::ERR_FAILED 401 (Unauthorized)`;
    const r = diagnose({ error });
    const f = r.findings.find((x) => x.id === 'preflight-not-ok');
    expect(f.title).toMatch(/401/);
    expect(f.explanation).toMatch(/never carry credentials/);
    // preflight failure is a CORS config problem, not a hidden 5xx
    expect(ids(r)).not.toContain('server-error-behind-cors');
  });

  test('Safari "Preflight response is not successful. Status code: 404"', () => {
    const r = diagnose({ error: 'Preflight response is not successful. Status code: 404\nXMLHttpRequest cannot load https://api.example.com/x due to access control checks.' });
    const f = r.findings.find((x) => x.id === 'preflight-not-ok');
    expect(f.explanation).toMatch(/nothing on the server handles OPTIONS/);
  });

  test('Chrome redirect on preflight mentions the Next.js trailing-slash default', () => {
    const r = diagnose({ error: chrome('Redirect is not allowed for a preflight request.', { preflight: true }) });
    const f = r.findings.find((x) => x.id === 'preflight-redirect');
    expect(f.explanation).toMatch(/trailing-slash/);
    expect(f.sources.map((s) => s.url)).toContain('https://nextjs.org/docs/15/app/api-reference/config/next-config-js/trailingSlash');
  });

  test('Chrome header not allowed: header extracted and added to the Next.js route fix', () => {
    const r = diagnose({ error: chrome('Request header field x-client-info is not allowed by Access-Control-Allow-Headers in preflight response.', { preflight: true }) });
    expect(r.context.header).toBe('x-client-info');
    const f = r.findings.find((x) => x.id === 'header-not-allowed');
    expect(f.explanation).toMatch(/supabase-js/);
    expect(r.fix.code).toContain('X-Client-Info');
    expect(r.fix.code).toContain('export async function OPTIONS');
  });

  test('Firefox missing token + Safari header wording', () => {
    const ff = diagnose({ error: firefox("missing token 'x-api-version' in CORS header 'Access-Control-Allow-Headers' from CORS preflight channel") });
    expect(ff.context.header).toBe('x-api-version');
    expect(ids(ff)).toContain('header-not-allowed');
    const sf = diagnose({ error: 'Request header field X-Requested-With is not allowed by Access-Control-Allow-Headers.' });
    expect(sf.context.header).toBe('x-requested-with');
  });

  test('method not allowed: Chrome extracts PUT and the fix lists it', () => {
    const r = diagnose({ error: chrome('Method PUT is not allowed by Access-Control-Allow-Methods in preflight response.', { preflight: true }), stack: 'nextjs-middleware' });
    expect(r.context.method).toBe('PUT');
    expect(ids(r)).toContain('method-not-allowed');
    expect(r.fix.code).toMatch(/Access-Control-Allow-Methods': '[^']*PUT/);
    const ff = diagnose({ error: firefox("Did not find method in CORS header 'Access-Control-Allow-Methods'") });
    expect(ids(ff)).toContain('method-not-allowed');
  });

  test('invalid token in Allow-Methods (Firefox) and parse failure (Chrome)', () => {
    expect(ids(diagnose({ error: firefox("invalid token 'GET;POST' in CORS header 'Access-Control-Allow-Methods'") }))).toContain('invalid-allow-token');
    expect(ids(diagnose({ error: chrome('Cannot parse Access-Control-Allow-Headers response header field in preflight response.', { preflight: true }) }))).toContain('invalid-allow-token');
  });
});

describe('cors-error-explainer — not really CORS', () => {
  test('a 500 hiding behind a missing-header error', () => {
    const ex = EXAMPLES.find((e) => e.id === 'chrome-500');
    const r = diagnose({ error: ex.error });
    expect(r.findings[0].id).toBe('server-error-behind-cors');
    expect(r.isCorsProblem).toBe(false);
    expect(r.context.status).toBe(500);
    // Chrome's no-cors suggestion is answered, but the user did not USE no-cors
    expect(ids(r)).toContain('no-cors-suggestion');
    expect(ids(r)).not.toContain('no-cors-opaque');
  });

  test('mixed content (Chromium wording) is not CORS', () => {
    const r = diagnose({
      error: "Mixed Content: The page at 'https://app.example.com/dashboard' was loaded over HTTPS, but requested an insecure resource 'http://api.example.com/v1/stats'. This request has been blocked; the content must be served over HTTPS.",
    });
    expect(ids(r)).toEqual(['mixed-content']);
    expect(r.isCorsProblem).toBe(false);
    expect(r.fix).toBeNull();
  });

  test('Firefox "CORS request did not succeed" is a network failure', () => {
    const r = diagnose({ error: "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at http://localhost:8000/api. (Reason: CORS request did not succeed). Status code: (null)." });
    expect(ids(r)).toEqual(['request-did-not-succeed']);
    expect(r.isCorsProblem).toBe(false);
  });

  test('file:// pages: Firefox "not HTTP" and Chromium scheme message', () => {
    expect(ids(diagnose({ error: firefox('CORS request not HTTP', 'file:///C:/site/data.json') }))).toContain('not-http');
    expect(ids(diagnose({ error: "Access to XMLHttpRequest at 'file:///C:/site/data.json' from origin 'null' has been blocked by CORS policy: Cross origin requests are only supported for protocol schemes: chrome, chrome-extension, data, http, https." }))).toContain('not-http');
  });

  test("user code with mode: 'no-cors' → opaque-response warning", () => {
    const r = diagnose({ error: "const res = await fetch(url, { mode: 'no-cors' })\nconsole.log(res.status) // 0\nSyntaxError: Unexpected end of JSON input" });
    expect(ids(r)).toContain('no-cors-opaque');
    expect(r.findings.find((f) => f.id === 'no-cors-opaque').source.url).toBe('https://developer.mozilla.org/en-US/docs/Web/API/Request/mode');
  });

  test('Safari generic line alone asks for the specific reason', () => {
    const r = diagnose({ error: 'Fetch API cannot load https://api.example.com/v1/items due to access control checks.' });
    expect(ids(r)).toEqual(['safari-generic']);
    expect(r.isCorsProblem).toBeNull();
  });
});

describe('cors-error-explainer — header analysis', () => {
  test("'*' with Allow-Credentials: true (header-only)", () => {
    const r = diagnose({ headers: 'HTTP/1.1 200 OK\nAccess-Control-Allow-Origin: *\nAccess-Control-Allow-Credentials: true\nContent-Type: application/json' });
    const f = r.findings.find((x) => x.id === 'wildcard-with-credentials');
    expect(f).toBeDefined();
    expect(f.fromHeaders).toBe(true);
  });

  test('duplicate ACAO lines', () => {
    const r = diagnose({ headers: 'HTTP/2 200\naccess-control-allow-origin: https://app.example.com\naccess-control-allow-origin: https://app.example.com\nvary: Origin' });
    expect(ids(r)).toContain('multiple-allow-origin');
  });

  test('ACAO with a trailing slash is invalid', () => {
    const r = diagnose({ headers: 'HTTP/2 200\nAccess-Control-Allow-Origin: https://app.example.com/\nVary: Origin' });
    expect(ids(r)).toContain('invalid-allow-origin');
  });

  test('Allow-Headers: * does not cover Authorization (example input)', () => {
    const ex = EXAMPLES.find((e) => e.id === 'chrome-preflight-auth');
    const r = diagnose({ error: ex.error, headers: ex.headers });
    expect(ids(r)).toEqual(expect.arrayContaining(['header-not-allowed', 'auth-not-covered-by-wildcard']));
    expect(r.findings.find((f) => f.id === 'auth-not-covered-by-wildcard').sources.map((s) => s.url))
      .toContain('https://fetch.spec.whatwg.org/#cors-non-wildcard-request-header-name');
  });

  test('curl -v preflight: request side parsed, 405 and missing method detected, Vary warning', () => {
    const verbose = [
      '> OPTIONS /api/items HTTP/2',
      '> Host: api.example.com',
      '> Origin: http://localhost:3000',
      '> Access-Control-Request-Method: DELETE',
      '< HTTP/2 405',
      '< access-control-allow-origin: http://localhost:3000',
      '< access-control-allow-methods: GET, POST',
    ].join('\n');
    const h = parseHeaders(verbose);
    expect(h.requestMethod).toBe('OPTIONS');
    expect(h.request.origin).toEqual(['http://localhost:3000']);
    const r = diagnose({ headers: verbose });
    expect(ids(r)).toEqual(expect.arrayContaining(['preflight-not-ok', 'method-not-allowed', 'vary-origin-missing']));
    expect(r.findings.find((f) => f.id === 'preflight-not-ok').title).toMatch(/405/);
  });

  test('a correct response produces no finding', () => {
    const r = diagnose({ headers: 'HTTP/2 200\nAccess-Control-Allow-Origin: https://app.example.com\nVary: Origin\nContent-Type: application/json' });
    expect(r.recognised).toBe(false);
    expect(r.findings).toEqual([]);
  });
});

describe('cors-error-explainer — negative and garbage input', () => {
  test('a CSP violation is not a CORS error', () => {
    const r = diagnose({ error: "Refused to connect to 'https://api.example.com/v1' because it violates the following Content Security Policy directive: \"connect-src 'self'\"." });
    expect(r.recognised).toBe(false);
    expect(r.fix).toBeNull();
  });

  test('a plain TypeError without CORS text does not trigger any rule', () => {
    const r = diagnose({ error: 'Uncaught (in promise) TypeError: Failed to fetch\n    at loadItems (page.js:12:21)' });
    expect(r.findings).toEqual([]);
    expect(r.isCorsProblem).toBeNull();
  });

  test('"Status code: 200" alone is not a server error and "credentials" prose alone triggers nothing', () => {
    const r = diagnose({ error: 'Status code: 200. We use credentials for the admin area.' });
    expect(r.findings).toEqual([]);
  });

  test('empty, whitespace, non-string and random bytes', () => {
    expect(diagnose({}).empty).toBe(true);
    expect(diagnose({ error: '   \n\t ' }).empty).toBe(true);
    expect(diagnose({ error: 42, headers: null }).findings).toEqual([]);
    const noise = Array.from({ length: 2000 }, (_, i) => String.fromCharCode((i * 7919) % 255)).join('');
    const r = diagnose({ error: noise, headers: noise });
    expect(Array.isArray(r.findings)).toBe(true);
    expect(parseConsoleError(undefined).browser).toBeNull();
  });

  test('a huge paste is capped and still returns quickly', () => {
    const big = chrome("No 'Access-Control-Allow-Origin' header is present on the requested resource.") + ' x'.repeat(200000);
    const t0 = Date.now();
    const r = diagnose({ error: big });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ids(r)).toContain('missing-allow-origin');
  });
});

describe('cors-error-explainer — secrets never echoed', () => {
  test('bearer JWT, token query param, cookie and URL password are masked everywhere', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJlLXNlY3JldA';
    const error = chrome("No 'Access-Control-Allow-Origin' header is present on the requested resource.", {
      url: 'https://admin:hunter2pass@api.example.com/v1/items?token=sk_live_SECRET123&page=2',
    });
    const headers = `> GET /v1/items HTTP/2\n> Authorization: Bearer ${jwt}\n> Cookie: session=abcdef123456\n< HTTP/2 500\n< set-cookie: sid=zzzsecretzzz; HttpOnly\n< apikey: ${jwt}`;
    const r = diagnose({ error, headers });
    const out = JSON.stringify(r);
    for (const secret of [jwt, 'sk_live_SECRET123', 'hunter2pass', 'abcdef123456', 'zzzsecretzzz']) {
      expect(out).not.toContain(secret);
    }
    expect(r.context.url).toContain('page=2');
  });

  test('maskSecrets leaves ordinary text alone', () => {
    const s = "Access to fetch at 'https://api.example.com/v1?page=2' from origin 'http://localhost:3000'";
    expect(maskSecrets(s)).toBe(s);
    expect(maskSecrets(undefined)).toBe('');
  });
});

describe('cors-error-explainer — fix snippets', () => {
  test('every stack builds a snippet that sets Vary: Origin (or uses cors()) and names its source', () => {
    for (const s of STACKS) {
      const fix = buildFix(s.id, fixParams({ origin: 'https://app.example.com', header: 'x-api-version', method: 'PUT' }, { credentials: true }));
      expect(fix.code.length).toBeGreaterThan(100);
      expect(fix.source.url).toMatch(/^https:\/\//);
      if (s.id === 'express') expect(fix.code).toContain('app.use(cors(corsOptions))');
      else expect(fix.code).toMatch(/Vary/);
      expect(fix.code).not.toMatch(/Access-Control-Allow-Origin'?:?\s*'\*'/);
    }
  });

  test('Cloudflare Worker preflight test does not require Access-Control-Request-Headers', () => {
    const fix = buildFix('cloudflare-worker', fixParams({}));
    expect(fix.code).toContain("request.headers.get('Access-Control-Request-Method') !== null");
    expect(fix.code).not.toContain("request.headers.get('Access-Control-Request-Headers') !== null");
  });

  test('Supabase fix extends the SDK allow-list with a custom header instead of replacing it', () => {
    const fix = buildFix('supabase-edge', fixParams({ header: 'x-tenant-id' }));
    expect(fix.code).toContain("...corsHeaders");
    expect(fix.code).toContain('x-tenant-id');
    expect(fix.code).not.toMatch(/Allow-Headers[^\n]*x-client-info, x-client-info/);
  });

  test('Supabase + wildcard-with-credentials: the CODE (not just a note) sets origin, credentials and Vary', () => {
    const r = diagnose({
      error: chrome("The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.", { origin: 'https://app.example.com' }),
      stack: 'supabase-edge',
    });
    expect(r.fix.code).toContain("'Access-Control-Allow-Credentials': 'true'");
    expect(r.fix.code).toContain("Vary: 'Origin'");
    expect(r.fix.code).toContain("const ALLOWED_ORIGINS = ['https://app.example.com']");
    // without credentials the SDK headers are used as-is
    const plain = buildFix('supabase-edge', fixParams({}));
    expect(plain.code).toContain('const cors = (req) => baseHeaders');
    expect(plain.code).not.toContain('Access-Control-Allow-Credentials');
  });

  test('unknown stack falls back to the Next.js route handler', () => {
    const r = diagnose({ error: chrome("No 'Access-Control-Allow-Origin' header is present on the requested resource."), stack: 'django' });
    expect(r.stack).toBe('nextjs-route');
    expect(r.fix.filename).toMatch(/route\.js$/);
  });
});

// Regressions from the adversarial review (2026-09-25). Firefox wordings are the
// current strings in dom/locales/en-US/chrome/security/security.properties
// (typographic quotes and backticks exactly as Firefox prints them).
describe('cors-error-explainer — review regressions', () => {
  const FF = 'Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/orders.';

  test('current Firefox "CORS preflight response did not succeed). Status code: 405" is diagnosed', () => {
    const r = diagnose({ error: `${FF} (Reason: CORS preflight response did not succeed). Status code: 405.` });
    expect(r.context.preflight).toBe(true);
    expect(r.context.status).toBe(405);
    const f = r.findings.find((x) => x.id === 'preflight-channel-failed');
    expect(f.title).toMatch(/405/);
    expect(f.explanation).toMatch(/nothing on the server handles OPTIONS/);
    expect(r.isCorsProblem).toBe(true);
    expect(r.fix).not.toBeNull();
    const auth = diagnose({ error: `${FF} (Reason: CORS preflight response did not succeed). Status code: 401.` });
    expect(auth.findings.find((x) => x.id === 'preflight-channel-failed').explanation).toMatch(/never carry credentials/);
    // no status at all → network-level failure wording kept
    const legacy = diagnose({ error: firefox('CORS preflight channel did not succeed') .replace(/ Status code: 200\./, '') });
    expect(legacy.findings.find((x) => x.id === 'preflight-channel-failed').title).toMatch(/itself failed/);
  });

  test('current Firefox "header ‘x’ is not allowed according to header ‘Access-Control-Allow-Headers’" extracts the header', () => {
    const r = diagnose({ error: `${FF} (Reason: header ‘x-client-info’ is not allowed according to header ‘Access-Control-Allow-Headers’ from CORS preflight response).` });
    expect(r.context.header).toBe('x-client-info');
    expect(r.context.preflight).toBe(true);
    expect(ids(r)).toContain('header-not-allowed');
    expect(r.findings.find((x) => x.id === 'header-not-allowed').explanation).toMatch(/supabase-js/);
    expect(r.fix).not.toBeNull();
  });

  test('Firefox missing ACAO + Status code 405: not dismissed as "not CORS", OPTIONS flagged', () => {
    const r = diagnose({ error: `${FF} (Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 405.` });
    expect(ids(r)).toContain('preflight-maybe-unhandled');
    expect(ids(r)).not.toContain('server-error-behind-cors');
    expect(r.isCorsProblem).toBe(true);
    expect(r.findings.find((x) => x.id === 'preflight-maybe-unhandled').explanation).toMatch(/OPTIONS/);
    // A Firefox 500 is still a server error behind the CORS line
    const r500 = diagnose({ error: `${FF} (Reason: CORS header ‘Access-Control-Allow-Origin’ missing). Status code: 500.` });
    expect(ids(r500)).toContain('server-error-behind-cors');
    expect(r500.isCorsProblem).toBe(false);
    // Chrome names the preflight explicitly, so a plain Chrome 404 stays a server error
    const c404 = diagnose({ error: `${chrome("No 'Access-Control-Allow-Origin' header is present on the requested resource.")}\nGET https://api.example.com/v1/items net::ERR_FAILED 404 (Not Found)` });
    expect(ids(c404)).toContain('server-error-behind-cors');
  });

  test('Firefox mixed active content is not CORS', () => {
    const r = diagnose({ error: 'Blocked loading mixed active content “http://api.example.com/data”' });
    expect(ids(r)).toEqual(['mixed-content']);
    expect(r.isCorsProblem).toBe(false);
  });

  test('ACAO differing from the request Origin only by letter case is a mismatch', () => {
    const r = diagnose({ headers: '< HTTP/2 200\n< access-control-allow-origin: https://App.example.com\n< vary: Origin\n> Origin: https://app.example.com' });
    const f = r.findings.find((x) => x.id === 'allow-origin-mismatch');
    expect(f).toBeDefined();
    expect(r.isCorsProblem).toBe(true);
    expect(describeOriginDiff('https://App.example.com', 'https://app.example.com')).toMatch(/letter case/);
    expect(f.explanation).toMatch(/letter case/);
  });

  test('Firefox Authorization-with-wildcard warning is recognised from the console text', () => {
    const r = diagnose({ error: 'Cross-Origin Request Warning: The Same Origin Policy will disallow reading the remote resource at https://api.example.com/me soon. (Reason: When the `Access-Control-Allow-Headers` is `*`, the `Authorization` header is not covered. To include the `Authorization` header, it must be explicitly listed in CORS header `Access-Control-Allow-Headers`).' });
    expect(ids(r)).toContain('auth-not-covered-by-wildcard');
    expect(r.fix.code).toMatch(/Access-Control-Allow-Headers': '[^']*Authorization/);
  });

  test('Next.js middleware fix mentions the Next.js 16 proxy rename and links its docs', () => {
    const fix = buildFix('nextjs-middleware', fixParams({}));
    expect(fix.notes.join(' ')).toMatch(/proxy\.js/);
    expect(fix.notes.join(' ')).toMatch(/export function proxy/);
    expect(fix.sources.map((s) => s.url)).toContain('https://nextjs.org/docs/app/api-reference/file-conventions/proxy');
  });

  test('__proto__ / constructor header names never crash diagnose()', () => {
    for (const headers of ['HTTP/2 200\n__proto__: x', 'HTTP/2 200\nconstructor: x', '> __proto__: x\n< HTTP/2 200', '> constructor: y\n< HTTP/2 200\nconstructor: x\ntoString: z']) {
      expect(() => diagnose({ error: '', headers })).not.toThrow();
    }
    const h = parseHeaders('HTTP/2 200\n__proto__: x\nconstructor: y');
    expect(h.response.__proto__).toEqual(['x']);
    expect(h.response.constructor).toEqual(['y']);
  });

  test('userinfo password in a pasted origin never reaches the fix or the findings', () => {
    const r = diagnose({ error: "Access to fetch at 'https://api.x.com/a' from origin 'https://bob:hunter2@app.x.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource." });
    expect(JSON.stringify(r)).not.toContain('hunter2');
    expect(r.fix.code).toContain("'https://app.x.com'");
    const r2 = diagnose({ headers: '> Origin: https://bob:hunter2@app.x.com\n< HTTP/2 200\n< access-control-allow-origin: https://other.x.com\n< vary: Origin' });
    expect(JSON.stringify(r2)).not.toContain('hunter2');
    expect(ids(r2)).toContain('allow-origin-mismatch');
  });
});
