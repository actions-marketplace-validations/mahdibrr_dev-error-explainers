/**
 * redact — every masked shape has positive cases, and ordinary error text
 * (paths, versions, codes, credential-free URLs, CORS wordings, npm/Next.js
 * output) must come through byte-for-byte.
 *
 * Every token-shaped value is ASSEMBLED AT RUNTIME: GitHub push protection
 * blocks token-shaped literals, and none may exist in this file.
 */
import { redact, REDACTED } from '../src/redact.js';

const j = (...parts) => parts.join('');
const alnum = (n, seed = 'aB3') => seed.repeat(Math.ceil(n / seed.length)).slice(0, n);

// Fake credentials (never real, never literal).
const GHP = j('gh', 'p_', alnum(36));
const GHO = j('gh', 'o_', alnum(36, 'Zy9'));
const GH_PAT = j('github', '_pat_', alnum(22), '_', alnum(59, 'Qw1'));
const GLPAT = j('gl', 'pat-', alnum(20, 'Xx7'));
const NPM_TOKEN = j('np', 'm_', alnum(36, 'Nn4'));
const SK_LIVE = j('sk', '_live_', alnum(24, 'Ss5'));
const SK_TEST = j('sk', '_test_', alnum(24, 'Tt6'));
const XOXB = j('xo', 'xb-', '1234567890-', alnum(24, 'Kk2'));
const XOXP = j('xo', 'xp-', '1234567890-', alnum(24, 'Pp8'));
const AKIA = j('AK', 'IA', 'ABCDEFGHIJKLMNOP');
const SB_SECRET = j('sb', '_secret_', alnum(32, 'Rr0'));
const JWT = j('ey', 'JhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', '.', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.', alnum(43, 'Sg1'));
const OPAQUE = j('opaque', 'Secret', 'Value', '42');

const masks = (input, secret) => {
  const r = redact(input);
  expect(r.text).not.toContain(secret);
  expect(r.text).toContain(REDACTED);
  expect(r.redactions).toBeGreaterThan(0);
  return r;
};

const untouched = (input) => {
  const r = redact(input);
  expect(r).toEqual({ text: input, redactions: 0 });
};

describe('redact — URL userinfo passwords', () => {
  test.each([
    ['postgres', `postgresql://postgres:${OPAQUE}@db.abcd.supabase.co:5432/postgres`],
    ['mysql', `mysql://root:${OPAQUE}@localhost:3306/db`],
    ['redis', `redis://default:${OPAQUE}@cache.example.com:6379`],
    ['https', `https://user:${OPAQUE}@git.example.com/org/repo.git`],
    ['mongodb+srv', `mongodb+srv://app:${OPAQUE}@cluster0.abcde.mongodb.net/test?retryWrites=true`],
    ['in a sentence', `connecting to postgres://u:${OPAQUE}@10.0.0.5:5432/app failed`],
    ['quoted .env', `DATABASE_URL="postgresql://u:${OPAQUE}@db.example.com:5432/app"`],
  ])('%s', (_, input) => {
    const r = masks(input, OPAQUE);
    expect(r.redactions).toBe(1);
  });

  test('keeps user, host, port and database', () => {
    const r = redact(`postgresql://postgres:${OPAQUE}@db.abcd.supabase.co:5432/postgres`);
    expect(r.text).toBe(`postgresql://postgres:${REDACTED}@db.abcd.supabase.co:5432/postgres`);
  });

  test('a password containing unencoded @ and # is masked whole', () => {
    const r = redact(`postgresql://postgres:p@ss#${OPAQUE}@localhost:5432/linker`);
    expect(r.text).toBe(`postgresql://postgres:${REDACTED}@localhost:5432/linker`);
  });

  test('an @ in the query does not swallow the host', () => {
    const r = redact(`postgresql://u:${OPAQUE}@db.example.com:5432/app?application_name=me@work`);
    expect(r.text).toContain('@db.example.com:5432/app');
    expect(r.text).not.toContain(OPAQUE);
  });

  test('template placeholders are not secrets', () => {
    untouched('postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres');
    untouched('postgresql://user:<password>@host:5432/db');
    untouched('postgresql://user:${DB_PASSWORD}@host:5432/db');
  });
});

describe('redact — headers', () => {
  test.each([
    ['Authorization Bearer', `Authorization: Bearer ${OPAQUE}`, `Authorization: Bearer ${REDACTED}`],
    ['lower-case authorization Basic', `authorization: Basic ${OPAQUE}`, `authorization: Basic ${REDACTED}`],
    ['curl -v request line', `> Authorization: Bearer ${OPAQUE}`, `> Authorization: Bearer ${REDACTED}`],
    ['Proxy-Authorization', `Proxy-Authorization: Basic ${OPAQUE}`, `Proxy-Authorization: Basic ${REDACTED}`],
    ['bare token value', `Authorization: ${OPAQUE}`, `Authorization: ${REDACTED}`],
    ['x-api-key', `x-api-key: ${OPAQUE}`, `x-api-key: ${REDACTED}`],
    ['Supabase apikey', `apikey: ${OPAQUE}`, `apikey: ${REDACTED}`],
    ['curl -H argument', `curl -H "Authorization: Bearer ${OPAQUE}" https://api.example.com`, `curl -H "Authorization: Bearer ${REDACTED}" https://api.example.com`],
    ['JS object key', `headers: { 'Authorization': 'Bearer ${OPAQUE}' }`, `headers: { 'Authorization': 'Bearer ${REDACTED}' }`],
  ])('%s', (_, input, expected) => {
    expect(redact(input)).toEqual({ text: expected, redactions: 1 });
  });

  test('Cookie keeps cookie names and masks every value', () => {
    expect(redact(`Cookie: session=${OPAQUE}; theme=dark`)).toEqual({
      text: `Cookie: session=${REDACTED}; theme=${REDACTED}`,
      redactions: 2,
    });
  });

  test('Set-Cookie masks the value and keeps the attributes', () => {
    expect(redact(`set-cookie: session=${OPAQUE}; Path=/; HttpOnly`)).toEqual({
      text: `set-cookie: session=${REDACTED}; Path=/; HttpOnly`,
      redactions: 1,
    });
  });
});

describe('redact — secret-named assignments', () => {
  test.each([
    ['API_KEY', `API_KEY=${OPAQUE}`, `API_KEY=${REDACTED}`],
    ['export + quotes', `export STRIPE_SECRET_KEY="${OPAQUE}"`, `export STRIPE_SECRET_KEY="${REDACTED}"`],
    ['single quotes', `DB_PASSWORD='${OPAQUE}'`, `DB_PASSWORD='${REDACTED}'`],
    ['PGPASS-style PASS', `SMTP_PASS=${OPAQUE}`, `SMTP_PASS=${REDACTED}`],
    ['PWD', `MYSQL_PWD=${OPAQUE}`, `MYSQL_PWD=${REDACTED}`],
    ['CREDENTIALS', `GOOGLE_CREDENTIALS=${OPAQUE}`, `GOOGLE_CREDENTIALS=${REDACTED}`],
    ['PRIVATE_KEY', `JWT_PRIVATE_KEY=${OPAQUE}`, `JWT_PRIVATE_KEY=${REDACTED}`],
    ['GITHUB_TOKEN', `GITHUB_TOKEN=${OPAQUE}`, `GITHUB_TOKEN=${REDACTED}`],
    ['query string access_token', `https://api.example.com/v1?access_token=${OPAQUE}&page=2`, `https://api.example.com/v1?access_token=${REDACTED}&page=2`],
    ['.npmrc _authToken', `//registry.npmjs.org/:_authToken=${OPAQUE}`, `//registry.npmjs.org/:_authToken=${REDACTED}`],
    ['camelCase apiKey', `apiKey=${OPAQUE}`, `apiKey=${REDACTED}`],
  ])('%s', (_, input, expected) => {
    expect(redact(input)).toEqual({ text: expected, redactions: 1 });
  });

  test.each([
    ['DATABASE_URL name alone', 'DATABASE_URL=postgresql://localhost:5432/app'],
    ['NEXTAUTH_URL', 'NEXTAUTH_URL=http://localhost:3000'],
    ['API_KEY_ID describes a key', 'API_KEY_ID=key-1234'],
    ['PASSWORD_FILE', 'POSTGRES_PASSWORD_FILE=/run/secrets/db'],
    ['keyword= is not "key"', 'https://example.com/search?keyword=react&page=1'],
    ['passive= is not "pass"', 'passive=true'],
    ['npm_config_ env var', 'npm_config_legacy_peer_deps=true'],
    ['placeholder value', 'API_KEY=<your-key>'],
    ['env reference', 'API_KEY=$API_KEY'],
    ['already redacted', `API_KEY=${REDACTED}`],
    ['sslmode', 'postgresql://localhost:5432/app?sslmode=require&connect_timeout=10'],
    ['boolean flag withCredentials', 'xhr.withCredentials = true;'],
    ['.npmrc always-auth', 'always-auth=true'],
    ['quoted boolean', 'USE_AUTH="false"'],
  ])('leaves %s alone', (_, input) => untouched(input));
});

describe('redact — bearer, JWT and well-known token prefixes', () => {
  test('bearer token in prose', () => {
    expect(redact(`request failed with Bearer ${OPAQUE} attached`)).toEqual({
      text: `request failed with Bearer ${REDACTED} attached`,
      redactions: 1,
    });
  });

  test('JWT anywhere', () => {
    const r = masks(`supabase anon: ${JWT} (expired)`, JWT);
    expect(r.text).toBe(`supabase anon: ${REDACTED} (expired)`);
  });

  test.each([
    ['GitHub classic PAT', GHP],
    ['GitHub OAuth token', GHO],
    ['GitHub fine-grained PAT', GH_PAT],
    ['GitLab PAT', GLPAT],
    ['npm token', NPM_TOKEN],
    ['Stripe live key', SK_LIVE],
    ['Stripe test key', SK_TEST],
    ['Slack bot token', XOXB],
    ['Slack user token', XOXP],
    ['AWS access key id', AKIA],
    ['Supabase secret key', SB_SECRET],
  ])('%s', (_, token) => {
    const r = redact(`token in log: ${token} end`);
    expect(r).toEqual({ text: `token in log: ${REDACTED} end`, redactions: 1 });
  });

  test('a token inside a secret-named assignment is counted once', () => {
    expect(redact(`NPM_TOKEN=${NPM_TOKEN}`)).toEqual({ text: `NPM_TOKEN=${REDACTED}`, redactions: 1 });
  });

  test('several secrets in one paste are all counted', () => {
    const text = [
      `Authorization: Bearer ${OPAQUE}`,
      `DATABASE_URL=postgresql://u:${OPAQUE}@db.example.com:5432/app`,
      `using ${GHP}`,
    ].join('\n');
    const r = redact(text);
    expect(r.redactions).toBe(3);
    expect(r.text).not.toContain(OPAQUE);
    expect(r.text).not.toContain(GHP);
  });
});

describe('redact — ordinary error text is not mangled', () => {
  test.each([
    ['CORS Chrome wording', "Access to fetch at 'https://api.example.com/v1/orders' from origin 'http://localhost:3000' has been blocked by CORS policy: Request header field authorization is not allowed by Access-Control-Allow-Headers in preflight response."],
    ['CORS Firefox wording', "Cross-Origin Request Blocked: The Same Origin Policy disallows reading the remote resource at https://api.example.com/me. (Reason: Credential is not supported if the CORS header 'Access-Control-Allow-Origin' is '*')."],
    ['Allow-Headers list', 'Access-Control-Allow-Headers: Content-Type, Authorization\nVary: Origin, Cookie'],
    ['ERR_REQUIRE_ESM', 'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.'],
    ['Windows path', 'C:\\Users\\someone\\AppData\\Local\\npm-cache\\eresolve-report.txt'],
    ['npm peer range', 'npm error peer react@"^18.0.0" from @testing-library/react@13.4.0'],
    ['semver + prerelease', 'react@19.0.0-rc-66855b96-20241106'],
    ['URL with port and @ in path', 'http://localhost:3000/users/@alice'],
    ['URL without credentials', 'https://registry.npmjs.org/@angular%2fcore'],
    ['git remote', 'git@github.com:vercel/next.js.git'],
    ['email address', 'contact me at dev@example.com'],
    ['Next.js chunk hash', '/_next/static/chunks/5760-40c839657ea31a15.js'],
    ['cf-ray / cache status', 'cf-ray: 8c1f2e3d4a5b6c7d-LHR\ncf-cache-status: BYPASS'],
    ['git sha', 'commit 1fa59f6c0b9e8d7a6f5e4d3c2b1a09f8e7d6c5b4'],
    ['EADDRINUSE', 'Error: listen EADDRINUSE: address already in use :::3000'],
    ['key: value prose', 'The primary key: id must be unique'],
    ['Bearer word alone', 'Use a Bearer token in the Authorization header.'],
    ['short eyJ prefix', 'eyJ is how every JWT starts'],
    ['placeholder header', 'Authorization: Bearer <token>'],
  ])('%s', (_, input) => untouched(input));
});

describe('redact — contract', () => {
  test('non-string and empty input', () => {
    expect(redact('')).toEqual({ text: '', redactions: 0 });
    expect(redact(undefined)).toEqual({ text: '', redactions: 0 });
    expect(redact(null)).toEqual({ text: '', redactions: 0 });
    expect(redact(42)).toEqual({ text: '', redactions: 0 });
  });

  test('idempotent: redacting twice changes nothing more', () => {
    const once = redact(`Authorization: Bearer ${OPAQUE}\nAPI_KEY=${OPAQUE}\n${JWT}\npostgres://u:${OPAQUE}@h:5432/d`);
    expect(redact(once.text)).toEqual({ text: once.text, redactions: 0 });
  });

  test('deterministic', () => {
    const text = `x-api-key: ${OPAQUE}\n${GHP}`;
    expect(redact(text)).toEqual(redact(text));
  });

  test('handles a very large paste quickly', () => {
    const big = `${'lorem ipsum dolor sit amet '.repeat(20000)}API_KEY=${OPAQUE}`;
    const t = Date.now();
    const r = redact(big);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.redactions).toBe(1);
  });
});
