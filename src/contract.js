// dev-error-explainers/contract — ONE normalised result shared by every
// interface (CLI --json, GitHub Action, MCP server, web page).
//
//   diagnose(text, options?) → { version, matched, redactions, results: Diagnosis[] }
//
// It adds no diagnosis of its own. It redacts the text, asks each module
// through the same recogniser `detect()` uses, and maps each module's native
// findings onto one shape with a STABLE rule id. Unknown input gives
// `{ matched: false, results: [] }` — never a guess. The full contract, the
// rule-id table and the redaction limits are in docs/CONTRACT.md.

import { redact } from './redact.js';
import { diagnose as diagnoseCors } from './cors-error-explainer.js';
import { explain as explainEsmCjs } from './esm-cjs-explainer.js';
import { analyseEresolveLog, SOURCES as NPM_SOURCES } from './npm-eresolve-explainer.js';
import {
  diagnose as diagnoseChunkCache,
  parseResponseHeaders,
  finalResponse,
  getHeader,
} from './chunk-cache-explainer.js';
import {
  diagnose as diagnoseDatabaseUrl,
  parseConnectionString,
  normaliseInput as normaliseDatabaseUrl,
} from './database-url-doctor.js';
import { decode as decodeBuildError } from './build-error-decoder.js';
import { explain as explainDatabaseConnection } from './database-connection-explainer.js';

/** Contract version. Bumped only when the result shape or a rule id changes. */
export const CONTRACT_VERSION = '0.1';

/** Families, in the order results are reported (same order as `MODULES`). */
export const FAMILIES = ['cors', 'esm-cjs', 'npm-eresolve', 'chunk-cache', 'database-url', 'next-build', 'database-connection'];

const MODULE_OF = {
  cors: 'cors-error-explainer',
  'esm-cjs': 'esm-cjs-explainer',
  'npm-eresolve': 'npm-eresolve-explainer',
  'chunk-cache': 'chunk-cache-explainer',
  'database-url': 'database-url-doctor',
  'next-build': 'build-error-decoder',
  'database-connection': 'database-connection-explainer',
};

// Rule-id prefix per family. A rule id is `<prefix>.<native id>`, where the
// native id is the module's own finding id — so ids only change if a module
// renames a finding, which is a breaking change of that module too.
const PREFIX = {
  cors: 'cors',
  'esm-cjs': 'esm',
  'npm-eresolve': 'npm-eresolve',
  'chunk-cache': 'chunk-cache',
  'database-url': 'database-url',
  'next-build': 'next-build',
  'database-connection': 'database-connection',
};

const MAX_INPUT = 50000;
const SITE = 'https://www.iloveblogs.blog';

// ---------------------------------------------------------------------------
// Catalogue: every rule id the contract can emit, with a STATIC title (module
// titles interpolate the pasted values) and a STATIC confidence.
//
// Confidence:
//   high   — the module keys on an explicit signal: an exact error code, an
//            exact browser / Node.js / npm / Next.js message, or a parsed
//            header or URL component value.
//   medium — a looser pattern, a generic fallback, or a finding the module
//            itself words as "check whether…".
// ---------------------------------------------------------------------------

const H = 'high';
const M = 'medium';

const CATALOG_ROWS = [
  // --- cors-error-explainer (console text; header-only rules need headers,
  //     which the contract does not split out of a paste — see CONTRACT.md) ---
  ['cors', 'missing-allow-origin', 'No Access-Control-Allow-Origin header on the response', H],
  ['cors', 'origin-not-allowed', 'The origin is not in the allowed list', H],
  ['cors', 'wildcard-with-credentials', 'Access-Control-Allow-Origin "*" with a credentialed request', H],
  ['cors', 'multiple-allow-origin', 'Access-Control-Allow-Origin sent more than once', H],
  ['cors', 'allow-origin-mismatch', 'Access-Control-Allow-Origin does not match the requesting origin', H],
  ['cors', 'invalid-allow-origin', 'Access-Control-Allow-Origin has an invalid value', H],
  ['cors', 'allow-credentials-not-true', 'Access-Control-Allow-Credentials is not "true"', H],
  ['cors', 'preflight-not-ok', 'The preflight (OPTIONS) response is not a 2xx', H],
  ['cors', 'preflight-redirect', 'The preflight was redirected', H],
  ['cors', 'header-not-allowed', 'A request header is not in Access-Control-Allow-Headers', H],
  ['cors', 'method-not-allowed', 'The method is not in Access-Control-Allow-Methods', H],
  ['cors', 'invalid-allow-token', 'Invalid token in Access-Control-Allow-Headers / -Methods', H],
  ['cors', 'request-did-not-succeed', 'The request never got a response (not a CORS problem)', H],
  ['cors', 'preflight-channel-failed', 'The CORS preflight channel failed', H],
  ['cors', 'not-http', 'The request URL is not http(s)', H],
  ['cors', 'mixed-content', 'Mixed content: an https page calling an http URL', H],
  ['cors', 'vary-origin-missing', 'Origin-dependent response without Vary: Origin', H],
  ['cors', 'auth-not-covered-by-wildcard', 'Authorization is not covered by Access-Control-Allow-Headers "*"', H],
  ['cors', 'wildcard-lists-with-credentials', 'Wildcard allow-lists do not apply to credentialed requests', H],
  ['cors', 'preflight-maybe-unhandled', 'A 401/403/404/405 without CORS headers — possibly an unhandled preflight', M],
  ['cors', 'server-error-behind-cors', 'A server error hidden behind the CORS message', H],
  ['cors', 'no-cors-opaque', "mode: 'no-cors' returns an unreadable opaque response", H],
  ['cors', 'no-cors-suggestion', "Chrome's \"set the request's mode to 'no-cors'\" suggestion", H],
  ['cors', 'safari-generic', 'Safari\'s generic "due to access control checks" line', M],
  ['cors', 'unrecognised-cors', 'A CORS block whose reason was not in the paste', M],

  // --- esm-cjs-explainer (every rule keys on a Node.js error code or message) ---
  ['esm-cjs', 'require-async-module', 'require() of an ES module graph with top-level await', H],
  ['esm-cjs', 'require-esm', 'ERR_REQUIRE_ESM: require() of an ES module', H],
  ['esm-cjs', 'import-outside-module', 'Cannot use import statement outside a module', H],
  ['esm-cjs', 'cjs-global-in-esm', 'A CommonJS global (require, module, __dirname…) used in an ES module', H],
  ['esm-cjs', 'ts-in-node-modules', 'Type stripping refused for TypeScript under node_modules', H],
  ['esm-cjs', 'ts-unsupported-syntax', 'TypeScript syntax that type stripping cannot handle', H],
  ['esm-cjs', 'unknown-file-extension', 'ERR_UNKNOWN_FILE_EXTENSION', H],
  ['esm-cjs', 'dir-import', 'Directory import is not supported in ES modules', H],
  ['esm-cjs', 'module-not-found-extension', 'ES module import without a file extension', H],
  ['esm-cjs', 'module-not-found-file', 'ES module import of a file that does not exist', H],
  ['esm-cjs', 'package-not-found', 'Cannot find package (ES module resolution)', H],
  ['esm-cjs', 'import-assert', 'Import assertions (assert { type }) are no longer supported', H],
  ['esm-cjs', 'import-attribute-missing', 'JSON / non-JS import without an import attribute', H],
  ['esm-cjs', 'package-path-not-exported', 'Subpath not exported by the package "exports"', H],

  // --- npm-eresolve-explainer (one Diagnosis per ERESOLVE report in the log) ---
  ['npm-eresolve', 'conflict', 'npm ERESOLVE: a dependency range cannot be satisfied', H],
  ['npm-eresolve', 'overriding-peer-dependency', 'npm WARN ERESOLVE overriding peer dependency', H],
  ['npm-eresolve', 'unparsed', 'npm ERESOLVE, but the report could not be parsed', M],

  // --- chunk-cache-explainer (response headers of an HTML page OR a chunk) ---
  ['chunk-cache', 'html-immutable', 'HTML document marked immutable', H],
  ['chunk-cache', 'html-browser-max-age', 'HTML document cached by the browser (max-age)', H],
  ['chunk-cache', 'html-expires', 'HTML document cached by the browser until Expires', H],
  ['chunk-cache', 'html-heuristic-freshness', 'HTML document can be reused heuristically (Last-Modified, no freshness)', M],
  ['chunk-cache', 'html-shared-cacheable', 'HTML document storable by a shared cache', H],
  ['chunk-cache', 'html-cf-cache-hit', 'Cloudflare served the HTML from its cache', H],
  ['chunk-cache', 'html-cf-cache-eligible', 'Cloudflare treats the HTML as cache-eligible', H],
  ['chunk-cache', 'html-nginx-cache-hit', 'nginx proxy_cache served the HTML', H],
  ['chunk-cache', 'html-vercel-cache-hit', 'Vercel CDN served the HTML from cache', H],
  ['chunk-cache', 'html-netlify-cache-hit', 'Netlify Edge served the HTML from cache', H],
  ['chunk-cache', 'html-cache-status-hit', 'Cache-Status hit on the HTML document', H],
  ['chunk-cache', 'html-age', 'HTML document sat in a proxy cache (Age > 0)', H],
  ['chunk-cache', 'chunk-redirect', 'The chunk request is redirected', H],
  ['chunk-cache', 'chunk-missing', 'The chunk answers 404/410: the hashed file is gone', H],
  ['chunk-cache', 'chunk-404-cached', 'Cloudflare is serving a cached 404 for the chunk', H],
  ['chunk-cache', 'chunk-server-error', 'The chunk answers 5xx', H],
  ['chunk-cache', 'chunk-blocked', 'The chunk answers a 4xx other than 404/410', H],
  ['chunk-cache', 'chunk-revalidated', 'The chunk answers 304 Not Modified', H],
  ['chunk-cache', 'chunk-html-fallback', 'The chunk URL answers 200 with text/html', H],
  ['chunk-cache', 'chunk-wrong-mime', 'The chunk has a non-JavaScript MIME type under nosniff', H],
  ['chunk-cache', 'chunk-css-wrong-mime', 'The CSS chunk has a Content-Type other than text/css', H],
  ['chunk-cache', 'chunk-not-immutable', 'The chunk is not cached as immutable', H],
  ['chunk-cache', 'chunk-not-static-path', 'The chunk path is not under /_next/static/', H],
  ['chunk-cache', 'deployment-id-mismatch', 'HTML and chunk carry different deployment ids', H],
  ['chunk-cache', 'service-worker-cache', 'A service worker can serve old HTML', M],

  // --- database-url-doctor (parsed URL components; the doctor's own finding ids) ---
  ['database-url', 'placeholder-left', 'Template placeholder left in the connection string', H],
  ['database-url', 'password-needs-encoding', 'Unencoded characters in the password or user name', H],
  ['database-url', 'dollar-in-password', 'The password contains "$" (expanded by Next.js .env)', H],
  ['database-url', 'invalid-port', 'The port is not a valid port number', H],
  ['database-url', 'host-invalid', 'The host contains a character a host cannot have', H],
  ['database-url', 'supabase-api-host', 'Supabase API host used as a database host', H],
  ['database-url', 'pooler-username', 'Supabase shared pooler needs user "<role>.<project-ref>"', H],
  ['database-url', 'direct-username', 'Supabase direct connection uses plain "postgres"', H],
  ['database-url', 'pooler-port', 'Unexpected or missing port on a Supabase host', H],
  ['database-url', 'direct-ipv6', 'Supabase direct host is IPv6 unless the IPv4 add-on is enabled', H],
  ['database-url', 'prisma-pgbouncer-missing', 'Transaction mode with Prisma without ?pgbouncer=true', H],
  ['database-url', 'prisma-pgbouncer-unneeded', 'pgbouncer=true on a session / direct connection', H],
  ['database-url', 'drizzle-prepare-false', 'Transaction mode with postgres.js needs { prepare: false }', H],
  ['database-url', 'pg-named-queries', 'Transaction mode with pg: avoid named queries', H],
  ['database-url', 'pgbouncer-param-wrong-client', 'pgbouncer=true is a Prisma-only flag', H],
  ['database-url', 'migrations-through-transaction-pooler', 'Migrations / psql through the transaction pooler (6543)', H],
  ['database-url', 'prisma-migrations-url', 'Where Prisma reads the migration URL', H],
  ['database-url', 'sslmode-invalid', 'Invalid sslmode value', H],
  ['database-url', 'sslmode-disable-supabase', 'SSL disabled on a Supabase connection', H],
  ['database-url', 'sslmode-missing-supabase', 'No sslmode on a Supabase connection', H],
  ['database-url', 'prisma7-sslmode', 'Prisma 7 reads sslmode as full certificate verification', H],
  ['database-url', 'pg-sslmode-verifies', 'node-postgres reads sslmode as full certificate verification', H],
  ['database-url', 'pg-sslmode-no-verify', 'sslmode=no-verify turns certificate verification off', H],
  ['database-url', 'missing-database', 'No database name in the URL', H],
  ['database-url', 'missing-port', 'No port in the URL', H],
  ['database-url', 'localhost', 'localhost only works on the machine running the code', H],
  ['database-url', 'missing-user', 'No user name in the URL', H],

  // --- build-error-decoder (regex signatures of next build / next dev output) ---
  ['next-build', 'suspense-searchparams', 'useSearchParams() needs a <Suspense> boundary', H],
  ['next-build', 'chunk-load-error', 'ChunkLoadError: a JavaScript chunk failed to load', H],
  ['next-build', 'dynamic-server-usage', 'Dynamic server usage during static rendering', H],
  ['next-build', 'window-undefined', 'Browser global (window / document / self) used on the server', H],
  ['next-build', 'module-not-found', "Module not found: Can't resolve", H],
  ['next-build', 'tsconfig-paths', 'The "@/" path alias does not resolve', H],
  ['next-build', 'heap-oom', 'JavaScript heap out of memory', H],
  ['next-build', 'hydration-mismatch', 'Hydration mismatch between server and client', M],
  ['next-build', 'turbopack-stuck', 'Dev server stuck on compiling', M],
  ['next-build', 'port-in-use', 'EADDRINUSE: the port is already in use', H],
  ['next-build', 'env-undefined', 'Environment variable undefined', M],
  ['next-build', 'next-babel', "Cannot find module 'next/babel'", H],
  ['next-build', 'image-hostname', 'next/image hostname is not configured', H],
  ['next-build', 'next-lint-removed', '`next lint` is removed / deprecated', M],

  // --- database-connection-explainer (exact Node.js / PostgreSQL / Prisma /
  //     node-postgres messages; generic network and TLS codes only with a
  //     Postgres signal in the text). The native ids carry a "db." prefix,
  //     dropped here. P1017 is medium: the module can only list checks, Prisma
  //     documents no cause for it. ---
  ['database-connection', 'econnrefused-ipv6-localhost', 'ECONNREFUSED on ::1 only: localhost resolved to the IPv6 loopback', H],
  ['database-connection', 'econnrefused', 'ECONNREFUSED: nothing accepted the TCP connection', H],
  ['database-connection', 'etimedout', 'connect ETIMEDOUT: the server never answered', H],
  ['database-connection', 'enotfound', 'getaddrinfo ENOTFOUND: the host name did not resolve', H],
  ['database-connection', 'eai-again', 'getaddrinfo EAI_AGAIN: temporary name-resolution failure', H],
  ['database-connection', 'prisma-p1001', "Prisma P1001: can't reach the database server", H],
  ['database-connection', 'prisma-p1000', 'Prisma P1000: authentication failed', H],
  ['database-connection', 'prisma-p1017', 'Prisma P1017: the server closed the connection', M],
  ['database-connection', 'password-auth-failed', 'PostgreSQL: password authentication failed for user', H],
  ['database-connection', 'pg-hba-no-entry', 'PostgreSQL: no pg_hba.conf entry for host', H],
  ['database-connection', 'too-many-connections', 'PostgreSQL: too many clients / connection slots reserved', H],
  ['database-connection', 'tls-self-signed', 'Self-signed certificate in the chain (PostgreSQL TLS)', H],
  ['database-connection', 'server-no-ssl', 'The server does not support SSL connections', H],
];

/** Every rule id the contract can emit: `{ rule, family, module, title, confidence }`. */
export const RULES = Object.freeze(CATALOG_ROWS.map(([family, id, title, confidence]) => Object.freeze({
  rule: `${PREFIX[family]}.${id}`,
  family,
  module: MODULE_OF[family],
  title,
  confidence,
})));

const BY_RULE = new Map(RULES.map((r) => [r.rule, r]));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

function labelFor(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    const tail = path.split('/').filter(Boolean).slice(-2).join('/');
    return tail ? `${u.hostname} — ${tail}` : u.hostname;
  } catch {
    return url;
  }
}

function absolute(href) {
  if (!href) return null;
  return /^https?:\/\//.test(href) ? href : `${SITE}${href.startsWith('/') ? '' : '/'}${href}`;
}

/** De-duplicated evidence list, order preserved. Accepts `{url,label}`, URL strings, nullish. */
function evidenceList(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const url = typeof item === 'string' ? item : item.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: typeof item === 'string' ? labelFor(url) : (item.label || labelFor(url)) });
  }
  return out;
}

function fix(title, detail, code) {
  const f = { title };
  if (detail) f.detail = detail;
  if (code) f.code = code;
  return f;
}

function make(family, nativeId, parts) {
  const rule = `${PREFIX[family]}.${nativeId}`;
  const entry = BY_RULE.get(rule);
  const d = {
    rule,
    family,
    title: parts.title || (entry ? entry.title : nativeId),
    severity: parts.severity,
    // A native id the catalogue does not know yet (a module gained a rule) is
    // still reported, at medium confidence; the drift test in
    // test/contract.test.js fails until the catalogue is updated.
    confidence: entry ? entry.confidence : M,
    cause: parts.cause || '',
  };
  if (parts.why) d.why = parts.why;
  d.fixes = parts.fixes || [];
  d.evidence = parts.evidence || [];
  d.module = MODULE_OF[family];
  return d;
}

// ---------------------------------------------------------------------------
// Per-family adapters. Each receives the REDACTED text (except database-url,
// see below) and returns Diagnosis[] — empty when the module does not
// recognise the text.
// ---------------------------------------------------------------------------

function fromCors(text) {
  const r = diagnoseCors({ error: text });
  if (!r.recognised) return [];
  // The server-side snippet goes on the first finding that is not a hint.
  const fixCarrier = r.fix ? r.findings.find((f) => f.kind !== 'hint') : null;
  return r.findings.map((f) => {
    const fixes = (f.steps || []).map((s) => fix(s));
    if (f === fixCarrier) fixes.push(fix(`Server fix (${r.stack})`, `Suggested file: ${r.fix.filename}`, r.fix.code));
    return make('cors', f.id, {
      title: f.title,
      severity: f.severity,
      cause: f.explanation,
      fixes,
      evidence: evidenceList([f.source, ...(f.sources || [])]),
    });
  });
}

function fromEsm(text, options) {
  const input = { error: text };
  if (typeof options.nodeVersion === 'string' && options.nodeVersion.trim()) input.nodeVersion = options.nodeVersion;
  const r = explainEsmCjs(input);
  return r.findings.map((f) => make('esm-cjs', f.id, {
    title: f.title,
    // Every esm-cjs finding is a hard Node.js error: the program did not run.
    severity: 'critical',
    cause: f.cause,
    why: f.why,
    fixes: f.fixes.map((x) => fix(x.title, x.detail, x.code)),
    evidence: evidenceList([f.source, f.extraSource]),
  }));
}

function fromNpm(text) {
  const r = analyseEresolveLog(text);
  if (!r.detected) return [];
  if (!r.conflicts.length) {
    return [make('npm-eresolve', 'unparsed', {
      severity: 'info',
      cause: 'npm reported ERESOLVE, but the "While resolving / Found / Could not resolve" report was not in the paste (or not in a shape this parser reads). Paste the full npm output, or the eresolve-report.txt file npm points to.',
      fixes: [fix('Print the dependency paths npm could not reconcile', 'npm explain prints why each version of a package is in the tree.', 'npm explain <package>')],
      evidence: evidenceList([NPM_SOURCES.explainEresolve, NPM_SOURCES.npmExplain]),
    })];
  }
  return r.conflicts.map((c) => {
    const main = c.findings.find((f) => f.id === 'conflict');
    const others = c.findings.filter((f) => f.id !== 'conflict');
    const fixes = c.fixes.map((x) => {
      const code = x.commands ? x.commands.join('\n') : x.snippet;
      const detail = [x.body, x.tradeoff ? `Trade-off: ${x.tradeoff}` : ''].filter(Boolean).join(' ');
      return fix(x.title, detail, code);
    });
    return make('npm-eresolve', c.kind === 'warning' ? 'overriding-peer-dependency' : 'conflict', {
      title: main ? main.title : undefined,
      severity: c.kind === 'warning' ? 'warning' : 'critical',
      cause: main ? main.body : '',
      why: others.map((f) => `${f.title}: ${f.body}`).join('\n') || undefined,
      fixes,
      evidence: evidenceList([
        ...c.findings.map((f) => f.source),
        ...c.fixes.flatMap((x) => [x.source, x.extraSource]),
      ]),
    });
  });
}

// Which box of the chunk-cache explainer does a single paste belong to? Only
// decided on explicit evidence; anything else is not diagnosed (no guess).
function chunkRole(text) {
  const parsed = parseResponseHeaders(text);
  const res = finalResponse(parsed);
  if (!res || res.status === null || res.status === undefined) return null;
  const targets = parsed.requestTargets || [];
  if (targets.some((t) => /\/_next\/static\//.test(t))) return 'chunk';
  const ct = getHeader(res, 'content-type') || '';
  if (/text\/html/i.test(ct)) return 'html';
  if (/javascript|ecmascript|text\/css/i.test(ct)) return 'chunk';
  return null;
}

// Findings about the INPUT (a box left empty, headers without a status line)
// describe the web form, not the site: they are never reported.
const CHUNK_INPUT_RULES = new Set(['input-missing', 'input-unparsed', 'input-no-status']);

function fromChunk(text) {
  const role = chunkRole(text);
  if (!role) return [];
  return chunkDiagnoses(role === 'html' ? { htmlHeaders: text } : { chunkHeaders: text });
}

function chunkDiagnoses(input) {
  const r = diagnoseChunkCache(input);
  return r.findings
    .filter((f) => !CHUNK_INPUT_RULES.has(f.ruleId) && f.ruleId !== 'html-redirect')
    .map((f) => make('chunk-cache', f.ruleId, {
      title: f.title,
      severity: f.severity,
      cause: f.why,
      fixes: f.fix || f.code ? [fix('Fix', f.fix || undefined, f.code || undefined)] : [],
      evidence: evidenceList([f.source]),
    }));
}

// The database-url doctor is the ONE module that reads the unredacted text:
// whether a password needs percent-encoding, and where the user/host split
// falls, depends on the password's exact characters — "[REDACTED]" would itself
// be reported as a template placeholder. It receives only the postgres:// line
// (never the rest of the paste), and its own contract is that the password never
// appears in its result; test/contract.test.js asserts it on every family.
function fromDatabaseUrl(originalText, options) {
  const line = normaliseDatabaseUrl(originalText.slice(0, MAX_INPUT));
  if (!parseConnectionString(line).ok) return [];
  const opts = {};
  if (typeof options.client === 'string') opts.client = options.client;
  const r = diagnoseDatabaseUrl(line, opts);
  if (!r.ok) return [];
  // The corrected string(s) (password as [YOUR-PASSWORD], never the real one)
  // go on the FIRST diagnosis as one more fix: the Diagnosis shape has no other
  // place for them, and one copy is enough.
  const corrected = (r.corrected || []).filter((x) => x && x.name && x.value);
  return r.findings.map((f, i) => {
    const fixes = f.fix ? [fix('Fix', undefined, f.fix)] : [];
    if (i === 0 && corrected.length) {
      const notes = corrected.map((x) => x.note).filter(Boolean).join(' ');
      fixes.push(fix(
        'Corrected connection string (password masked)',
        notes || undefined,
        corrected.map((x) => `${x.name}="${x.value}"`).join('\n'),
      ));
    }
    return make('database-url', f.id, {
      title: f.title,
      severity: f.severity,
      cause: f.body,
      fixes,
      evidence: evidenceList([f.source, f.link ? { url: absolute(f.link.href), label: f.link.label } : null]),
    });
  });
}

function fromBuild(text) {
  return decodeBuildError(text).map((rule) => make('next-build', rule.id, {
    title: rule.title,
    severity: rule.severity,
    cause: rule.body,
    fixes: rule.fix ? [fix(rule.link && rule.link.label ? rule.link.label : 'Fix', undefined, rule.fix)] : [],
    evidence: evidenceList([rule.link ? { url: absolute(rule.link.href), label: rule.link.label } : null]),
  }));
}

// "Can't connect to the database" errors. The module reads the redacted text:
// what it keys on (error codes, addresses, ports, PostgreSQL / Prisma messages)
// never contains a credential, and it never echoes a connection string.
function fromDatabaseConnection(text) {
  const r = explainDatabaseConnection({ error: text });
  if (!r.recognised) return [];
  return r.findings.map((f) => make('database-connection', f.id.replace(/^db\./, ''), {
    title: f.title,
    severity: f.severity,
    cause: f.cause,
    why: f.why,
    fixes: f.fixes.map((x) => fix(x.title, x.detail, x.code)),
    evidence: evidenceList([f.source, ...(f.extraSources || [])]),
  }));
}

function onlyFilter(only) {
  if (only === undefined || only === null) return null;
  const list = Array.isArray(only) ? only : [only];
  return new Set(list.filter((f) => FAMILIES.includes(f)));
}

/**
 * Diagnose a pasted error, log, header dump or connection string.
 *
 * @param {string} text
 * @param {{ nodeVersion?: string, client?: 'prisma'|'drizzle'|'pg'|'psql', only?: string|string[] }} [options]
 * @returns {{ version: string, matched: boolean, redactions: number, results: object[] }}
 */
export function diagnose(text, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  if (typeof text !== 'string' || !text.trim()) {
    return { version: CONTRACT_VERSION, matched: false, redactions: 0, results: [] };
  }
  // Redact the WHOLE text before cutting it, so a token is never split in two.
  const { text: masked, redactions } = redact(text);
  const input = masked.slice(0, MAX_INPUT);
  const only = onlyFilter(opts.only);
  const want = (family) => !only || only.has(family);

  const results = [];
  const push = (family, list) => list.forEach((d, i) => results.push({ d, f: FAMILIES.indexOf(family), i }));
  if (want('cors')) push('cors', fromCors(input));
  if (want('esm-cjs')) push('esm-cjs', fromEsm(input, opts));
  if (want('npm-eresolve')) push('npm-eresolve', fromNpm(input));
  if (want('chunk-cache')) push('chunk-cache', fromChunk(input));
  if (want('database-url')) push('database-url', fromDatabaseUrl(text, opts));
  if (want('next-build')) push('next-build', fromBuild(input));
  if (want('database-connection')) push('database-connection', fromDatabaseConnection(input));

  // Severity first, then family order, then the module's own order.
  results.sort((a, b) => SEVERITY_ORDER[a.d.severity] - SEVERITY_ORDER[b.d.severity] || a.f - b.f || a.i - b.i);
  const out = results.map((x) => x.d);
  return { version: CONTRACT_VERSION, matched: out.length > 0, redactions, results: out };
}

/**
 * The chunk-cache explainer with BOTH header dumps — the HTML page and a failing
 * chunk (`curl -sI` of each) — which a single paste cannot carry. Same
 * envelope as `diagnose()`; only the chunk-cache family can match. Both dumps
 * are redacted first and `redactions` is the sum of both counts.
 *
 * @param {{ htmlHeaders?: string, chunkHeaders?: string }} [input]
 * @returns {{ version: string, matched: boolean, redactions: number, results: object[] }}
 */
export function diagnoseHeaders(input = {}) {
  const i = input && typeof input === 'object' ? input : {};
  const html = redact(typeof i.htmlHeaders === 'string' ? i.htmlHeaders : '');
  const chunk = redact(typeof i.chunkHeaders === 'string' ? i.chunkHeaders : '');
  const redactions = html.redactions + chunk.redactions;
  if (!html.text.trim() && !chunk.text.trim()) {
    return { version: CONTRACT_VERSION, matched: false, redactions, results: [] };
  }
  const out = chunkDiagnoses({ htmlHeaders: html.text.slice(0, MAX_INPUT), chunkHeaders: chunk.text.slice(0, MAX_INPUT) })
    .map((d, idx) => ({ d, idx }))
    .sort((a, b) => SEVERITY_ORDER[a.d.severity] - SEVERITY_ORDER[b.d.severity] || a.idx - b.idx)
    .map((x) => x.d);
  return { version: CONTRACT_VERSION, matched: out.length > 0, redactions, results: out };
}
