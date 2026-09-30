// database-url-doctor — pure diagnostic logic for a Postgres / Supabase
// connection string. No React, no DOM, no network: the component calls these
// functions in the browser and nothing the user types leaves it.
//
// Every rule below carries the primary source it was verified against
// (fetched 2026-09-25). A rule that could not be verified was dropped rather
// than guessed — see the header of each finding's `source`.

export const SOURCES = {
  // Supabase: host/port/username formats, IPv6 note, SSL "require", which
  // connection to use for migrations / pg_dump.
  supabaseConnect: 'https://supabase.com/docs/guides/database/connecting-to-postgres',
  // Supabase: per-driver setting to disable prepared statements in transaction mode.
  supabaseDrivers: 'https://supabase.com/docs/guides/database/connecting-to-postgres/serverless-drivers',
  // Supabase: "Tenant or user not found" — pooler username + host rules.
  supabaseTenant: 'https://supabase.com/docs/guides/troubleshooting/tenant-or-user-not-found',
  // Supabase: IPv6 by default, IPv4 add-on, IPv4-only platforms.
  supabaseIpv4: 'https://supabase.com/docs/guides/platform/ipv4-address',
  // Supabase: SSL optional by default, verify-full recommended.
  supabaseSsl: 'https://supabase.com/docs/guides/platform/ssl-enforcement',
  // Supabase: Prisma DATABASE_URL (?pgbouncer=true on 6543) + DIRECT_URL (session 5432).
  supabasePrisma: 'https://supabase.com/docs/guides/database/prisma',
  // Supabase: Drizzle + postgres.js `prepare: false`.
  supabaseDrizzle: 'https://supabase.com/docs/guides/database/drizzle',
  // Supabase: REST API lives at https://<project_ref>.supabase.co/rest/v1.
  supabaseApi: 'https://supabase.com/docs/guides/api/creating-routes',
  // Prisma: pgbouncer=true disables named prepared statements; Migrate needs a
  // single direct connection; error `prepared statement "s0" already exists`.
  prismaPgbouncer: 'https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer',
  // Prisma 7 upgrade guide: `url`/`directUrl` in the datasource block are
  // deprecated; the migration URL goes in prisma.config.ts `url`. Driver
  // adapters are required (@prisma/adapter-pg → node-pg), and SSL certificate
  // defaults changed: pass `ssl` to PrismaPg.
  prisma7: 'https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7',
  // PostgreSQL libpq: URI form, percent-encoding, schemes, dbname default, sslmode values.
  libpq: 'https://www.postgresql.org/docs/current/libpq-connect.html',
  // RFC 3986 §2.2 / §3.2 / §3.2.1: gen-delims, authority termination, userinfo ABNF.
  rfc3986: 'https://www.rfc-editor.org/rfc/rfc3986#section-3.2.1',
  // node-postgres: prepared statements only when a query config has a `name`.
  nodePgQueries: 'https://node-postgres.com/features/queries',
  // node-postgres: sslmode in the connection string replaces the `ssl` object.
  nodePgSsl: 'https://node-postgres.com/features/ssl',
  // postgres.js: `prepare` defaults to true; `prepare: false` for PgBouncer transaction mode.
  postgresJs: 'https://github.com/porsager/postgres/blob/master/README.md',
  // pg-connection-string: sslmode=require → full verification;
  // sslmode=no-verify → ssl: { rejectUnauthorized: false }.
  pgConnectionString: 'https://github.com/brianc/node-postgres/blob/master/packages/pg-connection-string/README.md',
  // Next.js: `$VAR` expansion inside .env files; escape a literal `$` as `\$`.
  nextEnv: 'https://nextjs.org/docs/app/guides/environment-variables',
};

export const CLIENTS = {
  prisma: 'Prisma',
  drizzle: 'Drizzle + postgres.js',
  pg: 'node-postgres (pg)',
  psql: 'Supabase CLI / psql',
};

// Articles on this site that go deeper on a finding.
const ARTICLES = {
  encoding: { href: '/post/prisma-cant-connect-to-postgresql', label: 'Percent-encoding a DATABASE_URL password' },
  pooling: { href: '/guides/supabase-connection-pooling-vercel', label: 'Supabase connection pooling on serverless' },
  s0: { href: '/post/prisma-postres-error-prepared-statement-s0-already-exists', label: 'prepared statement "s0" already exists' },
  migrate: { href: '/post/prisma-migrate-command-gets-stuck', label: 'Prisma Migrate stuck behind the pooler' },
};

// The "What gets checked" list the /tools page renders — kept next to the code
// so the page cannot drift from what the rules actually do.
export const RULES = [
  { id: 'password-needs-encoding', name: 'Unencoded characters in the password or user', detail: '@ / ? # [ ] spaces and stray % break URL parsing (RFC 3986); the fix is percent-encoding, not a new password.', source: SOURCES.rfc3986 },
  { id: 'placeholder-left', name: 'Template placeholders left in', detail: '[YOUR-PASSWORD], [PROJECT-REF] or [POOLER-HOST] copied verbatim from the docs.', source: SOURCES.supabaseConnect },
  { id: 'pooler-username', name: 'Pooler username format', detail: 'the shared pooler needs postgres.<project-ref>; direct connections use plain postgres.', source: SOURCES.supabaseTenant },
  { id: 'port-mode', name: '5432 vs 6543', detail: 'session mode vs transaction mode on the pooler, direct vs dedicated pooler on db.<ref>.supabase.co.', source: SOURCES.supabaseConnect },
  { id: 'direct-ipv6', name: 'db.<ref>.supabase.co is IPv6', detail: 'the direct connection (5432) and the dedicated pooler (6543) alike, unless you bought the IPv4 add-on — Vercel, GitHub Actions and Render are IPv4-only.', source: SOURCES.supabaseConnect },
  { id: 'prepared-statements', name: 'Prepared statements in transaction mode', detail: 'pgbouncer=true for Prisma, prepare: false for postgres.js, named queries for pg.', source: SOURCES.supabaseDrivers },
  { id: 'migrations-through-transaction-pooler', name: 'Migrations through the transaction pooler', detail: 'Prisma Migrate and pg_dump need a direct or session connection (directUrl / prisma.config.ts).', source: SOURCES.prismaPgbouncer },
  { id: 'sslmode', name: 'sslmode', detail: 'invalid values, SSL disabled on Supabase, no-verify, and how node-postgres (and Prisma 7 through @prisma/adapter-pg) reads sslmode=require.', source: SOURCES.libpq },
  { id: 'generic', name: 'Generic Postgres checks', detail: 'missing database name or port, localhost in a deployed config, Supabase API URL pasted instead of a database URL.', source: SOURCES.libpq },
];

const MASK = '••••••••';
// Components table: query parameters listed before collapsing into "+N more".
const MAX_PARAM_ROWS = 50;
const PASSWORD_PLACEHOLDER = '[YOUR-PASSWORD]';
const SSLMODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];

// RFC 3986 §2.2 gen-delims that cannot appear raw inside userinfo, plus
// whitespace and a `%` that does not start a valid %XX escape. Sub-delims
// (! $ & ' ( ) * + , ; =) and unreserved chars (- . _ ~) are legal there.
const BREAKING_CHARS = {
  '@': 'ends the user:password part — the parser takes what follows as the host',
  '#': 'starts a URL fragment — the authority ends there, so the host and port are lost',
  '/': 'starts the path — the authority ends there',
  '?': 'starts the query string — the authority ends there',
  '[': 'is reserved for IPv6 literals such as [::1]',
  ']': 'is reserved for IPv6 literals such as [::1]',
  ' ': 'is not allowed anywhere in a URL',
  '%': 'starts a %XX escape — a bare % is a malformed escape',
};

const PLACEHOLDER_RE = /\[[A-Za-z][A-Za-z0-9_ -]*\]|<[A-Za-z][A-Za-z0-9_ -]*>/;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function describeChar(c) {
  if (c === ' ') return 'space';
  if (/\s/.test(c)) return 'whitespace';
  return c;
}

/** Characters in a userinfo component that must be percent-encoded. */
export function findUnencodedChars(component) {
  if (!component) return [];
  const found = new Set();
  for (let i = 0; i < component.length; i++) {
    const c = component[i];
    if (c === '%') {
      if (!/^[0-9A-Fa-f]{2}$/.test(component.slice(i + 1, i + 3))) found.add('%');
    } else if (/\s/.test(c)) {
      found.add(' ');
    } else if ('@#/?[]'.includes(c)) {
      found.add(c);
    }
  }
  return [...found];
}

/** Strip what people paste around the URL: `export`, `DATABASE_URL=`, quotes. */
export function normaliseInput(input) {
  if (typeof input !== 'string') return '';
  let s = input.trim();
  // A whole .env may be pasted: diagnose the first line holding a postgres://
  // URL (not NEXT_PUBLIC_SUPABASE_URL above it); else the first real line.
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  s = lines.find((l) => /(^|[=\s'"])postgres(ql)?:\/\//i.test(l)) || lines[0] || '';
  s = s.replace(/^export\s+/, '');
  const assign = s.match(/^[A-Za-z_][A-Za-z0-9_]*\s*=\s*(.*)$/);
  if (assign && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = assign[1].trim();
  // Trailing inline comment after a closing quote.
  const quoted = s.match(/^(['"])(.*)\1(\s+#.*)?$/);
  if (quoted) s = quoted[2];
  // Unquoted value: dotenv reads whitespace + "#" as the start of a comment
  // (`DATABASE_URL=postgresql://…:5432 # dev db`). Left in, the comment would
  // shift the user/host split and echo the password as part of the host.
  else s = s.replace(/\s+#.*$/, '');
  return s.trim();
}

// A host part: anything up to the path, query or fragment with no whitespace
// or "@" (brackets allowed — IPv6 literals and leftover [PLACEHOLDERS] both use
// them). RFC 3986 §3.2: the authority ends at the next "/", "?" or "#".
const HOSTSPEC_RE = /^[^\s/?#@]*(?:[/?#]|$)/;

// A hostspec that clearly names a server: a dotted name, an IPv6 literal (or
// [PLACEHOLDER]), localhost, or an explicit numeric port.
function looksLikeHost(hostspec) {
  const h = hostspec.split(',')[0];
  return h.includes('.') || h.startsWith('[') || /^localhost(:|$)/i.test(h) || /:\d+$/.test(h);
}

/**
 * Parse a Postgres connection URI without the WHATWG URL parser, so a password
 * containing @ # / ? still parses the way the author intended: the host is
 * whatever follows the LAST "@" that is followed by a valid host.
 */
export function parseConnectionString(input) {
  const raw = normaliseInput(input);
  if (!raw) return { ok: false, errorId: 'empty' };

  const m = raw.match(/^([a-z][a-z0-9+.-]*):\/\/(.*)$/is);
  if (!m) return { ok: false, errorId: 'no-scheme', raw };
  const scheme = m[1].toLowerCase();
  const rest = m[2];
  if (scheme !== 'postgres' && scheme !== 'postgresql') {
    const host = (rest.split(/[/?#]/)[0] || '').split('@').pop().split(':')[0].toLowerCase();
    return { ok: false, errorId: 'wrong-scheme', scheme, host };
  }

  // Locate the userinfo / host separator. Candidates are the "@"s followed by
  // a well-formed host part; the LAST one wins (an unencoded "@" in the
  // password comes before the real separator)…
  const candidates = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '@' && HOSTSPEC_RE.test(rest.slice(i + 1))) candidates.push(i);
  }
  let at = candidates.length ? candidates[candidates.length - 1] : -1;
  // …unless it sits in the path or query of an earlier, real host:
  // `…@db.example.com:5432/app?application_name=me@work` (RFC 3986 allows a
  // raw "@" in path and query).
  if (candidates.length > 1) {
    const lastHost = rest.slice(at + 1).split(/[/?#]/)[0];
    for (const i of candidates.slice(0, -1)) {
      const hostspec = rest.slice(i + 1).split(/[/?#]/)[0];
      if (!looksLikeHost(hostspec)) continue;
      const between = rest.slice(i + 1 + hostspec.length, at);
      if (!looksLikeHost(lastHost) || between.includes('?')) {
        at = i;
        break;
      }
    }
  }
  // No "@" is followed by a valid host part (whitespace inside the host, say),
  // but there is one: split there anyway, so what precedes it — the password —
  // can never be reported or rebuilt as part of the host.
  if (at < 0) at = rest.lastIndexOf('@');

  let rawUser = null;
  let rawPassword = null;
  let after = rest;
  if (at >= 0) {
    const userinfo = rest.slice(0, at);
    after = rest.slice(at + 1);
    const colon = userinfo.indexOf(':');
    if (colon >= 0) {
      rawUser = userinfo.slice(0, colon);
      rawPassword = userinfo.slice(colon + 1);
    } else {
      rawUser = userinfo;
    }
  }

  const authEnd = after.search(/[/?#]/);
  const hostspec = authEnd >= 0 ? after.slice(0, authEnd) : after;
  // A "#…" fragment means nothing to Postgres: drop it.
  const tail = authEnd >= 0 ? after.slice(authEnd).replace(/#.*$/, '') : '';

  // Multi-host (libpq allows host1:port1,host2:port2) — diagnose the first.
  const firstHost = hostspec.split(',')[0];
  let host = firstHost;
  let rawPort = null;
  if (firstHost.startsWith('[')) {
    const close = firstHost.indexOf(']');
    host = close >= 0 ? firstHost.slice(0, close + 1) : firstHost;
    const portPart = close >= 0 ? firstHost.slice(close + 1) : '';
    if (portPart.startsWith(':')) rawPort = portPart.slice(1);
  } else {
    const colon = firstHost.lastIndexOf(':');
    if (colon >= 0) {
      host = firstHost.slice(0, colon);
      rawPort = firstHost.slice(colon + 1);
    }
  }

  let rawDb = null;
  let rawQuery = '';
  if (tail.startsWith('/')) {
    const q = tail.indexOf('?');
    rawDb = q >= 0 ? tail.slice(1, q) : tail.slice(1);
    rawQuery = q >= 0 ? tail.slice(q + 1) : '';
  } else if (tail.startsWith('?')) {
    rawQuery = tail.slice(1);
  }

  const params = [];
  if (rawQuery) {
    for (const pair of rawQuery.split('&')) {
      if (!pair) continue;
      const eq = pair.indexOf('=');
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : '';
      params.push({ key: safeDecode(k) ?? k, value: safeDecode(v) ?? v });
    }
  }

  const bracketBody = host.startsWith('[') ? host.slice(1, -1) : null;
  const isIpv6Literal = bracketBody !== null && /^[0-9a-f:.]+(%.+)?$/i.test(bracketBody);

  return {
    ok: true,
    scheme,
    rawUser,
    user: rawUser === null ? null : safeDecode(rawUser) ?? rawUser,
    rawPassword,
    hasPassword: rawPassword !== null && rawPassword !== '',
    host: host.toLowerCase(),
    hostIsIpv6: isIpv6Literal,
    multiHost: hostspec.includes(','),
    rawPort,
    port: rawPort && /^\d+$/.test(rawPort) ? Number(rawPort) : null,
    database: rawDb === null || rawDb === '' ? null : safeDecode(rawDb) ?? rawDb,
    params,
  };
}

function getParam(parsed, key) {
  const p = parsed.params.find((x) => x.key.toLowerCase() === key);
  return p ? p.value : null;
}

/** Classify the endpoint. Formats from SOURCES.supabaseConnect / supabaseTenant. */
export function classifyHost(parsed) {
  const host = parsed.host;
  const direct = host.match(/^db\.([a-z0-9]+|\[[^\]]+\])\.supabase\.co$/);
  const port = parsed.port ?? 5432;
  if (direct) {
    return { provider: 'supabase', kind: port === 6543 ? 'dedicated-pooler' : 'direct', ref: direct[1], transaction: port === 6543 };
  }
  if (/\.pooler\.supabase\.com$/.test(host)) {
    const userRef = parsed.user && parsed.user.includes('.') ? parsed.user.split('.').pop() : null;
    return { provider: 'supabase', kind: port === 6543 ? 'shared-transaction' : 'shared-session', ref: userRef, transaction: port === 6543 };
  }
  const api = host.match(/^([a-z0-9]+)\.supabase\.co$/);
  if (api) return { provider: 'supabase', kind: 'api-host', ref: api[1], transaction: false };
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|host\.docker\.internal)$/.test(host)) {
    return { provider: 'local', kind: 'local', ref: null, transaction: false };
  }
  return { provider: 'generic', kind: 'generic', ref: null, transaction: false };
}

const KIND_LABELS = {
  direct: 'Supabase direct connection (Postgres on 5432)',
  'dedicated-pooler': 'Supabase dedicated pooler (PgBouncer, transaction mode)',
  'shared-session': 'Supabase shared pooler — session mode (Supavisor, 5432)',
  'shared-transaction': 'Supabase shared pooler — transaction mode (Supavisor, 6543)',
  'api-host': 'Supabase API URL — not a database host',
  local: 'Local database',
  generic: 'Postgres (non-Supabase)',
};

function finding(id, severity, title, body, fix, source, link) {
  return { id, severity, title, body, fix, source, link: link || null };
}

function parseFailure(parsed) {
  if (parsed.errorId === 'empty') {
    return [finding('empty', 'info', 'Paste a connection string to start', 'Expected something like postgresql://user:password@host:5432/dbname — a whole .env line such as DATABASE_URL="…" works too.', 'postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres', SOURCES.libpq)];
  }
  if (parsed.errorId === 'wrong-scheme' && /^([a-z0-9]+)\.supabase\.co$/.test(parsed.host || '')) {
    return [finding('supabase-api-host', 'critical', 'This is your Supabase API URL, not a database URL', `https://<project-ref>.supabase.co is the REST/API endpoint used by supabase-js (NEXT_PUBLIC_SUPABASE_URL). Prisma, Drizzle, pg and psql need a Postgres connection string, which you copy from the Connect dialog in the Supabase dashboard.`, 'postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres', SOURCES.supabaseApi, ARTICLES.pooling)];
  }
  if (parsed.errorId === 'wrong-scheme') {
    return [finding('wrong-scheme', 'critical', `"${parsed.scheme}://" is not a Postgres connection string`, 'libpq (and every Postgres driver built on its URI format) accepts only postgresql:// or postgres:// as the scheme.', 'postgresql://user:[YOUR-PASSWORD]@host:5432/dbname', SOURCES.libpq)];
  }
  return [finding('no-scheme', 'critical', 'No postgresql:// scheme found', 'A connection URI starts with postgresql:// or postgres://. Keyword/value strings (host=… port=…) are valid for psql but not for Prisma or Drizzle.', 'postgresql://user:[YOUR-PASSWORD]@host:5432/dbname', SOURCES.libpq)];
}

function decodedPassword(parsed) {
  if (!parsed.hasPassword) return null;
  // Already-valid escapes are decoded once, so they are never double-encoded.
  if (findUnencodedChars(parsed.rawPassword).includes('%')) return parsed.rawPassword;
  return safeDecode(parsed.rawPassword) ?? parsed.rawPassword;
}

function isPlaceholder(s) {
  return !!s && PLACEHOLDER_RE.test(s);
}

/** Build a connection string from parts. Password is inserted as given. */
function buildUrl({ user, password, host, port, database, params }) {
  let auth = '';
  if (user) auth = encodeURIComponent(user).replace(/%5B/g, '[').replace(/%5D/g, ']');
  if (password !== null && password !== undefined) auth += `:${password}`;
  const q = params.length
    ? `?${params.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value).replace(/%5B/g, '[').replace(/%5D/g, ']')}`).join('&')}`
    : '';
  return `postgresql://${auth ? `${auth}@` : ''}${host}${port ? `:${port}` : ''}/${database}${q}`;
}

function targetParams(parsed, cls, client, transaction) {
  let params = parsed.params
    .filter((p) => p.key.toLowerCase() !== 'pgbouncer')
    // Secrets passed as query parameters stay masked in the output too.
    .map((p) => (/pass/i.test(p.key) ? { key: p.key, value: PASSWORD_PLACEHOLDER } : p))
    // Normalise to the lowercase values the libpq docs list when that is the only problem.
    .map((p) => (p.key.toLowerCase() === 'sslmode' && SSLMODES.includes(p.value.toLowerCase()) ? { key: 'sslmode', value: p.value.toLowerCase() } : p));
  if (client === 'prisma' && transaction) params.push({ key: 'pgbouncer', value: 'true' });
  const ssl = getParam({ params }, 'sslmode');
  const sslUnusable = !ssl || ssl === 'disable' || !SSLMODES.includes(ssl);
  if (cls.provider === 'supabase' && (client === 'drizzle' || client === 'psql') && sslUnusable) {
    params = params.filter((p) => p.key.toLowerCase() !== 'sslmode');
    params.push({ key: 'sslmode', value: 'require' });
  }
  if (cls.provider === 'supabase' && client === 'prisma' && ssl && sslUnusable) {
    // Never inject sslmode for Prisma: on Prisma 7 the URL goes through
    // @prisma/adapter-pg → pg-connection-string, where sslmode=require means
    // full verification and replaces the adapter's `ssl` option. Only drop a
    // value that disables SSL or is invalid.
    params = params.filter((p) => p.key.toLowerCase() !== 'sslmode');
  }
  if (client === 'pg' && cls.provider === 'supabase') {
    // A sslmode in the URL replaces pg's `ssl` object (SOURCES.nodePgSsl) —
    // configure SSL in code instead.
    params = params.filter((p) => p.key.toLowerCase() !== 'sslmode');
  }
  return params;
}

function buildCorrected(parsed, cls, client, forMigrations, passwordOut) {
  const role = parsed.user ? parsed.user.split('.')[0] || 'postgres' : 'postgres';
  const ref = cls.ref && !isPlaceholder(cls.ref) ? cls.ref : '[PROJECT-REF]';
  const db = parsed.database || (cls.provider === 'supabase' ? 'postgres' : '[DATABASE]');
  const pw = parsed.hasPassword ? passwordOut : PASSWORD_PLACEHOLDER;

  const make = (target) => {
    if (cls.provider !== 'supabase') {
      const port = parsed.port || 5432;
      return buildUrl({ user: parsed.user || null, password: parsed.hasPassword ? pw : null, host: parsed.host || '[HOST]', port, database: db, params: targetParams(parsed, cls, client, false) });
    }
    const onPooler = cls.kind === 'shared-session' || cls.kind === 'shared-transaction';
    const poolerHost = onPooler && !isPlaceholder(parsed.host) ? parsed.host : '[POOLER-HOST]';
    if (target === 'migration') {
      // IPv4-safe choice from the Supabase Prisma guide: session pooler on 5432.
      if (onPooler) return buildUrl({ user: `${role}.${ref}`, password: pw, host: poolerHost, port: 5432, database: db, params: targetParams(parsed, cls, client, false) });
      return buildUrl({ user: 'postgres', password: pw, host: `db.${ref}.supabase.co`, port: 5432, database: db, params: targetParams(parsed, cls, client, false) });
    }
    // runtime
    if (onPooler) {
      const port = parsed.port === 5432 || parsed.port === 6543 ? parsed.port : 6543;
      return buildUrl({ user: `${role}.${ref}`, password: pw, host: poolerHost, port, database: db, params: targetParams(parsed, cls, client, port === 6543) });
    }
    if (cls.kind === 'dedicated-pooler') {
      return buildUrl({ user: 'postgres', password: pw, host: `db.${ref}.supabase.co`, port: 6543, database: db, params: targetParams(parsed, cls, client, true) });
    }
    return buildUrl({ user: 'postgres', password: pw, host: `db.${ref}.supabase.co`, port: 5432, database: db, params: targetParams(parsed, cls, client, false) });
  };

  if (client === 'prisma' && forMigrations) {
    const out = [{ name: 'DATABASE_URL', value: make('runtime'), note: 'Prisma Client at runtime.' }];
    const direct = make('migration');
    out.push({
      name: 'DIRECT_URL',
      value: direct,
      note: cls.provider === 'supabase'
        ? 'Prisma CLI (migrate, introspect). The session pooler (5432) works from IPv4-only hosts; db.<ref>.supabase.co:5432 is the alternative where IPv6 works. Reference it with directUrl in schema.prisma, or with datasource.url in prisma.config.ts on Prisma 7, where directUrl is deprecated.'
        : 'Prisma CLI (migrate, introspect): reference it with directUrl in schema.prisma, or with datasource.url in prisma.config.ts on Prisma 7.',
    });
    return out;
  }
  if (forMigrations || client === 'psql') {
    return [{ name: 'DATABASE_URL', value: make('migration'), note: 'Direct or session connection — what migrations, psql and pg_dump need.' }];
  }
  return [{ name: 'DATABASE_URL', value: make('runtime'), note: null }];
}

function charList(chars) {
  return chars.map((c) => `"${describeChar(c)}" → ${encodeURIComponent(c === ' ' ? ' ' : c)}`).join(', ');
}

/**
 * Diagnose a connection string.
 * @param {string} input  the URL (or a whole `DATABASE_URL=…` line)
 * @param {{client?: 'prisma'|'drizzle'|'pg'|'psql', forMigrations?: boolean}} [options]
 */
export function diagnose(input, options = {}) {
  return runDiagnosis(input, options, false);
}

/**
 * The corrected strings WITH the user's real (percent-encoded) password.
 * Only for a "copy" click handler — never render its result.
 */
export function correctedWithPassword(input, options = {}) {
  return runDiagnosis(input, options, true).corrected;
}

function runDiagnosis(input, options, revealPassword) {
  const client = CLIENTS[options.client] ? options.client : 'prisma';
  const forMigrations = !!options.forMigrations;
  const parsed = parseConnectionString(input);

  if (!parsed.ok) {
    return { ok: false, client, forMigrations, components: [], findings: parseFailure(parsed), corrected: [], kind: null, kindLabel: null };
  }

  const cls = classifyHost(parsed);
  const findings = [];
  const add = (...a) => findings.push(finding(...a));
  const sslmode = getParam(parsed, 'sslmode');
  const pgbouncer = getParam(parsed, 'pgbouncer');
  const onPooler = cls.kind === 'shared-session' || cls.kind === 'shared-transaction';

  // --- Placeholders copied from the docs template (SOURCES.supabaseConnect) ---
  const placeholderParts = [
    ['user', parsed.rawUser],
    ['password', parsed.rawPassword],
    ['host', parsed.hostIsIpv6 ? null : parsed.host],
    ['database', parsed.database],
  ].filter(([, v]) => isPlaceholder(v)).map(([k]) => k);
  if (placeholderParts.length) {
    add('placeholder-left', 'critical', `Template placeholder left in the ${placeholderParts.join(', ')}`,
      'The Supabase docs show connection strings with [YOUR-PASSWORD], [PROJECT-REF] and [POOLER-HOST] as placeholders. The brackets must be replaced — brackets included — with your real values from the Connect dialog. Left in, "[" and "]" also break URL parsing because they are reserved for IPv6 literals.',
      'postgresql://postgres.abcdefghijklmnopqrst:my-real-password@aws-1-eu-west-2.pooler.supabase.com:6543/postgres\n# ↑ illustrative values — copy yours from Dashboard → Connect',
      SOURCES.supabaseConnect);
  }

  // --- Unencoded characters (RFC 3986 §2.2, §3.2, §3.2.1; libpq URI rules) ---
  // Source: https://www.rfc-editor.org/rfc/rfc3986#section-3.2.1
  for (const [label, value] of [['password', parsed.rawPassword], ['user name', parsed.rawUser]]) {
    if (!value || isPlaceholder(value)) continue;
    const chars = findUnencodedChars(value);
    if (!chars.length) continue;
    add('password-needs-encoding', 'critical', `The ${label} contains characters that break URL parsing`,
      `Your ${label} contains ${chars.map((c) => `"${describeChar(c)}"`).join(', ')}. In a URL, ${chars.map((c) => `"${describeChar(c)}" ${BREAKING_CHARS[c === ' ' ? ' ' : c]}`).join('; ')}. PostgreSQL's libpq requires the URI to be percent-encoded when it contains symbols with special meaning, and strict parsers then report something unrelated — Prisma's "invalid port number" is the classic symptom. This tool guessed the intended split; your driver will not.`,
      `# encode the ${label} once, then paste the result into the URL\nnode -e "console.log(encodeURIComponent(process.argv[1]))" 'your-${label === 'password' ? 'password' : 'user'}'\n# ${charList(chars)}\n# ("Copy with my password" below inserts it already encoded)`,
      SOURCES.rfc3986, ARTICLES.encoding);
  }

  // --- `$` + Next.js .env expansion (SOURCES.nextEnv) ---
  if (parsed.rawPassword && parsed.rawPassword.includes('$') && !isPlaceholder(parsed.rawPassword)) {
    add('dollar-in-password', 'info', 'The password contains "$" — Next.js .env files expand it',
      'Next.js expands $VARIABLE references inside .env* files, so "$abc" in a password can be silently replaced by the value of another variable (usually empty). "$" is legal in a URL, so a parser will not complain — the connection just fails authentication.',
      '# either escape it in .env files loaded by Next.js\nDATABASE_URL="postgresql://user:pa\\$word@host:5432/db"\n# or percent-encode it (works everywhere)\nDATABASE_URL="postgresql://user:pa%24word@host:5432/db"',
      SOURCES.nextEnv);
  }

  // --- Port (libpq URI hostspec: host[:port]) ---
  if (parsed.rawPort !== null && parsed.port === null) {
    add('invalid-port', 'critical', 'The part after the host is not a port number',
      'Everything after the last ":" in the host part is read as the port. If it is not a number, the host part is malformed — usually because a character in the password was not percent-encoded and shifted the split.',
      'postgresql://user:[YOUR-PASSWORD]@host:5432/dbname', SOURCES.libpq, ARTICLES.encoding);
  } else if (parsed.port !== null && (parsed.port < 1 || parsed.port > 65535)) {
    add('invalid-port', 'critical', `Port ${parsed.port} is out of range`, 'TCP ports run from 1 to 65535.', 'postgresql://user:[YOUR-PASSWORD]@host:5432/dbname', SOURCES.libpq);
  }

  // --- Characters that cannot be in a host (RFC 3986 §3.2.2 reg-name) ---
  if (/[\s@#]/.test(parsed.host)) {
    add('host-invalid', 'critical', 'The host part contains a space or another character a host cannot have',
      'A host name is letters, digits, dots and hyphens (or an IPv6 literal in brackets). A space, "#" or "@" there usually means an unencoded character in the password, or text pasted after the URL, moved the user/host split.',
      'postgresql://user:[YOUR-PASSWORD]@host:5432/dbname', SOURCES.rfc3986, ARTICLES.encoding);
  }

  // --- Supabase API host pasted as a DB host (SOURCES.supabaseApi) ---
  if (cls.kind === 'api-host') {
    add('supabase-api-host', 'critical', `${parsed.host} is your Supabase API host, not the database`,
      'The REST API lives at https://<project-ref>.supabase.co — the value of NEXT_PUBLIC_SUPABASE_URL. The Postgres host for a direct connection is db.<project-ref>.supabase.co; the pooler host is shown in the Connect dialog.',
      `postgresql://postgres:[YOUR-PASSWORD]@db.${cls.ref}.supabase.co:5432/postgres`, SOURCES.supabaseApi, ARTICLES.pooling);
  }

  // --- Shared pooler username (SOURCES.supabaseTenant) ---
  if (onPooler && parsed.user && !parsed.user.includes('.') && !isPlaceholder(parsed.rawUser)) {
    add('pooler-username', 'critical', `Shared pooler user must be "${parsed.user}.<project-ref>", not "${parsed.user}"`,
      'The shared pooler (Supavisor) identifies your project from the username, so it must be postgres.<project-ref> — or <role>.<project-ref> for a custom role. With a bare "postgres" it answers "Tenant or user not found", which reads like a wrong password but is not. The host number (aws-0, aws-1…) is a pooler cluster index: copy the host from the Connect dialog rather than composing it from your region.',
      `postgresql://${parsed.user}.[PROJECT-REF]:[YOUR-PASSWORD]@${parsed.host}:${parsed.port || 6543}/postgres`,
      SOURCES.supabaseTenant, ARTICLES.pooling);
  }
  if ((cls.kind === 'direct' || cls.kind === 'dedicated-pooler') && parsed.user && /^[^.]+\..+$/.test(parsed.user)) {
    add('direct-username', 'warning', `Direct connections use "postgres", not "${parsed.user}"`,
      `The postgres.<project-ref> username is for the shared pooler (*.pooler.supabase.com) only. Direct connections and the dedicated pooler on db.<project-ref>.supabase.co use plain "postgres".`,
      `postgresql://postgres:[YOUR-PASSWORD]@${parsed.host}:${parsed.port || 5432}/postgres`,
      SOURCES.supabaseTenant, ARTICLES.pooling);
  }

  // --- Pooler / direct port semantics (SOURCES.supabaseConnect) ---
  if (onPooler && parsed.port === null && parsed.rawPort === null) {
    add('pooler-port', 'info', 'No port on the pooler host — that means 5432, session mode',
      'On the shared pooler, 5432 is session mode (one server connection per client, prepared statements work) and 6543 is transaction mode (connection returned after every transaction, for serverless). Write the port explicitly so nobody has to guess which one you meant.',
      `…@${parsed.host}:6543/postgres   # serverless / edge\n…@${parsed.host}:5432/postgres   # long-lived server, migrations`,
      SOURCES.supabaseConnect, ARTICLES.pooling);
  } else if (onPooler && parsed.port !== null && parsed.port !== 5432 && parsed.port !== 6543) {
    add('pooler-port', 'warning', `Port ${parsed.port} on the pooler — expected 5432 or 6543`,
      'The shared pooler listens on 5432 (session mode) and 6543 (transaction mode).',
      `…@${parsed.host}:6543/postgres`, SOURCES.supabaseConnect, ARTICLES.pooling);
  }
  if (cls.provider === 'supabase' && cls.kind !== 'api-host' && !onPooler && parsed.port !== null && parsed.port !== 5432 && parsed.port !== 6543) {
    add('pooler-port', 'warning', `Port ${parsed.port} on db.<ref>.supabase.co — expected 5432 or 6543`,
      'db.<project-ref>.supabase.co serves the direct connection on 5432 and, on paid plans, the dedicated PgBouncer pooler on 6543.',
      `…@${parsed.host}:5432/postgres`, SOURCES.supabaseConnect);
  }

  // --- IPv6 direct connection (SOURCES.supabaseIpv4, SOURCES.supabaseConnect) ---
  // Supabase's endpoint table: direct connection and dedicated pooler are IPv6
  // on every plan unless the project has the IPv4 add-on; the shared pooler is
  // IPv4 on every plan.
  if (cls.kind === 'direct' || cls.kind === 'dedicated-pooler') {
    const dedicated = cls.kind === 'dedicated-pooler';
    add('direct-ipv6', forMigrations || dedicated ? 'warning' : 'info',
      dedicated ? 'The dedicated pooler (db.<ref>:6543) is IPv6 unless you have the IPv4 add-on' : 'Direct connections are IPv6 unless you have the IPv4 add-on',
      `db.<project-ref>.supabase.co — the direct connection on 5432 and the dedicated pooler on 6543 alike — resolves to IPv6, or to IPv4 only if the project has the IPv4 add-on. Supabase lists Vercel, GitHub Actions, Render and Retool as IPv4-only: from there this host is unreachable. The shared pooler (*.pooler.supabase.com) is IPv4-compatible on every plan — transaction mode on 6543 for serverless runtime traffic, session mode on 5432 for migrations and long-lived servers.`,
      dedicated
        ? `# IPv4-only environment (Vercel, CI…): shared pooler, transaction mode\npostgresql://postgres.${cls.ref}:[YOUR-PASSWORD]@[POOLER-HOST]:6543/postgres\n# [POOLER-HOST]: copy it from Dashboard → Connect — it cannot be derived from the region`
        : `# IPv4-only environment (CI, Vercel…): use the session pooler instead\npostgresql://postgres.${cls.ref}:[YOUR-PASSWORD]@[POOLER-HOST]:5432/postgres\n# serverless runtime traffic: the same host on 6543 (transaction mode)\n# [POOLER-HOST]: copy it from Dashboard → Connect — it cannot be derived from the region`,
      SOURCES.supabaseConnect, ARTICLES.pooling);
  }

  // --- Transaction mode × client: prepared statements (SOURCES.supabaseDrivers) ---
  if (cls.transaction && client === 'prisma' && pgbouncer !== 'true') {
    // Supabase Prisma guide appends ?pgbouncer=true to the 6543 string.
    add('prisma-pgbouncer-missing', 'warning', 'Transaction mode with Prisma: add ?pgbouncer=true',
      'Port 6543 is transaction mode, which does not support prepared statements. Prisma disables its named prepared statements when the URL carries pgbouncer=true; without it you get errors such as `prepared statement "s0" already exists`.',
      'DATABASE_URL="postgresql://…:6543/postgres?pgbouncer=true"', SOURCES.supabasePrisma, ARTICLES.s0);
  }
  if (!cls.transaction && client === 'prisma' && pgbouncer === 'true' && cls.provider === 'supabase') {
    add('prisma-pgbouncer-unneeded', 'info', 'pgbouncer=true on a session/direct connection is unnecessary',
      'The flag only exists to switch off named prepared statements for transaction-mode poolers. On 5432 (direct or session mode) prepared statements work, so the flag just gives them up.',
      'DATABASE_URL="postgresql://…:5432/postgres"   # no pgbouncer=true', SOURCES.prismaPgbouncer);
  }
  if (cls.transaction && client === 'drizzle') {
    add('drizzle-prepare-false', 'warning', 'Transaction mode with postgres.js: pass { prepare: false }',
      'Transaction mode does not support prepared statements, and postgres.js creates prepared statements automatically unless you pass prepare: false — which is exactly what Supabase\'s Drizzle guide does.',
      "import { drizzle } from 'drizzle-orm/postgres-js'\nimport postgres from 'postgres'\n\nconst client = postgres(process.env.DATABASE_URL, { prepare: false })\nexport const db = drizzle(client)",
      SOURCES.supabaseDrizzle, ARTICLES.pooling);
  }
  if (cls.transaction && client === 'pg') {
    add('pg-named-queries', 'info', 'Transaction mode with pg: avoid named queries',
      'node-postgres only creates a prepared statement when a query config has a `name`. Plain `pool.query(text, values)` calls are fine on 6543; a named query can fail because the next transaction may run on a different server connection.',
      "// fine in transaction mode\nawait pool.query('SELECT * FROM users WHERE id = $1', [id])\n// avoid on 6543 — creates a prepared statement\nawait pool.query({ name: 'get-user', text: '…', values: [id] })",
      SOURCES.nodePgQueries, ARTICLES.pooling);
  }
  if (pgbouncer !== null && client !== 'prisma') {
    add('pgbouncer-param-wrong-client', 'info', `pgbouncer=true is a Prisma flag — it does nothing for ${CLIENTS[client]}`,
      'Each driver has its own switch for transaction mode: pgbouncer=true for Prisma, prepare: false for postgres.js / Drizzle. It does not disable prepared statements in other clients.',
      client === 'drizzle' ? "postgres(url, { prepare: false })" : '# remove ?pgbouncer=true from this URL',
      SOURCES.supabaseDrivers);
  }

  // --- Migrations / psql through the transaction pooler ---
  if (cls.transaction && (forMigrations || client === 'psql')) {
    const prismaFix = 'DIRECT_URL="postgresql://postgres.<ref>:[YOUR-PASSWORD]@[POOLER-HOST]:5432/postgres"\n\n// schema.prisma\ndatasource db {\n  provider  = "postgresql"\n  url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")\n}\n\n// prisma.config.ts (Prisma 7 — directUrl is deprecated)\ndatasource: { url: env("DIRECT_URL") }';
    add('migrations-through-transaction-pooler', forMigrations ? 'critical' : 'warning',
      forMigrations ? 'Migrations through the transaction pooler (6543) will fail' : 'psql / pg_dump through the transaction pooler (6543)',
      client === 'prisma'
        ? 'Prisma Migrate\'s schema engine uses a single connection and does not support PgBouncer-style pooling — through a transaction pooler it fails with `prepared statement "s0" already exists`. Point the CLI at a direct or session-mode (5432) URL and keep 6543 for Prisma Client.'
        : 'Supabase recommends a direct connection for migrations, pg_dump, backup/restore and replication — they are single sessions using Postgres native commands. Use db.<ref>.supabase.co:5432, or the session pooler on 5432 from an IPv4-only machine.',
      client === 'prisma' ? prismaFix : 'postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres',
      client === 'prisma' ? SOURCES.prismaPgbouncer : SOURCES.supabaseConnect,
      ARTICLES.migrate);
  } else if (forMigrations && client === 'prisma' && cls.kind !== 'api-host') {
    add('prisma-migrations-url', 'info', 'Where Prisma reads the migration URL',
      'This URL is fine for migrations. Prisma 7 deprecates url and directUrl in the schema.prisma datasource block: the URL the CLI uses moves to prisma.config.ts. Before that move it was directUrl in schema.prisma.',
      '// prisma.config.ts (Prisma 7)\ndatasource: { url: env("DIRECT_URL") }\n\n// schema.prisma (before the move to prisma.config.ts)\ndirectUrl = env("DIRECT_URL")',
      SOURCES.prisma7, ARTICLES.migrate);
  }

  // --- sslmode (SOURCES.libpq, SOURCES.supabaseSsl, pg specifics) ---
  if (sslmode !== null) {
    const valid = SSLMODES.includes(sslmode) || (client === 'pg' && sslmode === 'no-verify');
    if (!valid) {
      add('sslmode-invalid', 'warning', `sslmode=${sslmode} is not a valid value`,
        `libpq accepts disable, allow, prefer (the default), require, verify-ca and verify-full${client === 'pg' ? ' — node-postgres additionally accepts no-verify' : ''}. Use one of those lowercase values.`,
        '?sslmode=require', SOURCES.libpq);
    }
  }
  if (cls.provider === 'supabase' && cls.kind !== 'api-host') {
    if (sslmode === 'disable') {
      add('sslmode-disable-supabase', 'warning', 'SSL is disabled on a Supabase connection',
        'sslmode=disable sends your password and data in clear text over the internet. Supabase recommends sslmode=require at minimum, and verify-full with the root certificate from Database settings to rule out man-in-the-middle attacks.',
        client === 'pg' ? "ssl: { ca: process.env.SUPABASE_CA_CERT }"
          : client === 'prisma' ? "// Prisma 7: drop sslmode from the URL and pass ssl to the adapter\nnew PrismaPg({ connectionString: process.env.DATABASE_URL, ssl: { ca: process.env.SUPABASE_CA_CERT } })\n# Prisma 6 and earlier\n?sslmode=require"
          : '?sslmode=require', SOURCES.supabaseConnect);
    } else if (sslmode === null && client === 'prisma') {
      add('sslmode-missing-supabase', 'info', 'No sslmode — set SSL the way your Prisma version reads it',
        'Supabase accepts non-SSL connections by default. Prisma 7 requires a driver adapter; with @prisma/adapter-pg the URL is parsed by node-postgres, where sslmode=require means full certificate verification and a sslmode in the URL replaces the adapter\'s ssl option — Supabase certificates chain to the Supabase root CA, so that fails with "self-signed certificate in certificate chain". On Prisma 7, keep sslmode out of the URL and pass ssl to the adapter with the CA certificate from Database settings (or trust it through NODE_EXTRA_CA_CERTS). On Prisma 6 and earlier (Rust query engine), ?sslmode=require in the URL is enough.',
        "// Prisma 7 + @prisma/adapter-pg — no sslmode in DATABASE_URL\nconst adapter = new PrismaPg({\n  connectionString: process.env.DATABASE_URL,\n  ssl: { ca: process.env.SUPABASE_CA_CERT },\n})\n\n# Prisma 6 and earlier\nDATABASE_URL=\"postgresql://…/postgres?sslmode=require\"",
        SOURCES.prisma7);
    } else if (sslmode === null && client !== 'pg') {
      add('sslmode-missing-supabase', 'info', 'No sslmode — encryption is not guaranteed',
        'Supabase accepts non-SSL connections by default, and libpq\'s default (prefer) silently falls back to an unencrypted connection. Add sslmode=require, or verify-full with the CA certificate from Database settings for full protection.',
        '?sslmode=require', SOURCES.supabaseSsl);
    } else if (sslmode === null && client === 'pg') {
      add('sslmode-missing-supabase', 'info', 'Set SSL explicitly in your pg config',
        'Supabase accepts non-SSL connections by default, so encryption depends on your client settings. With node-postgres, configure it in code with the CA certificate from Database settings — and keep sslmode out of the URL, because node-postgres documents that a sslmode in the connection string replaces your ssl object.',
        "const pool = new Pool({\n  connectionString: process.env.DATABASE_URL, // no sslmode here\n  ssl: { ca: process.env.SUPABASE_CA_CERT },\n})",
        SOURCES.nodePgSsl);
    }
    if (client === 'prisma' && sslmode !== null && SSLMODES.includes(sslmode) && sslmode !== 'disable') {
      add('prisma7-sslmode', 'info', `On Prisma 7, sslmode=${sslmode} becomes full certificate verification`,
        'Prisma 7 requires a driver adapter, and with @prisma/adapter-pg the URL is parsed by node-postgres: pg-connection-string treats sslmode=prefer, require and verify-ca as verify-full, and a sslmode in the URL replaces the ssl option you pass to the adapter. Supabase certificates chain to the Supabase root CA, so this surfaces as "self-signed certificate in certificate chain". Prisma 6 and earlier (Rust query engine) are not affected.',
        "// Prisma 7: remove sslmode from DATABASE_URL, then:\nconst adapter = new PrismaPg({\n  connectionString: process.env.DATABASE_URL,\n  ssl: { ca: process.env.SUPABASE_CA_CERT },\n})",
        SOURCES.prisma7);
    }
    if (client === 'pg' && sslmode !== null && sslmode !== 'disable' && sslmode !== 'no-verify') {
      add('pg-sslmode-verifies', 'info', `node-postgres reads sslmode=${sslmode} as full certificate verification`,
        'pg-connection-string maps prefer, require, verify-ca and verify-full to ssl: true — full verification — unless you add uselibpqcompat=true. Supabase certificates chain to the Supabase root CA (downloadable from Database settings), which is why this often surfaces as "self-signed certificate in certificate chain". Passing ssl: { ca } alone does not help while sslmode stays in the URL: node-postgres documents that a sslmode in the connection string replaces your ssl object.',
        "// remove sslmode from DATABASE_URL, then:\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  ssl: { ca: process.env.SUPABASE_CA_CERT },\n})",
        SOURCES.pgConnectionString);
    }
  }

  // pg-connection-string README: "sslmode=no-verify - sets ssl to { rejectUnauthorized: false }".
  if (client === 'pg' && sslmode === 'no-verify') {
    add('pg-sslmode-no-verify', 'warning', 'sslmode=no-verify turns certificate verification off',
      'node-postgres maps sslmode=no-verify to ssl: { rejectUnauthorized: false }: the connection is encrypted, but any certificate is accepted, so a man-in-the-middle can impersonate the server. Verify against the provider\'s CA instead — and keep sslmode out of the URL, because it replaces the ssl object you pass in code.',
      "// remove sslmode from DATABASE_URL, then:\nconst pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  ssl: { ca: process.env.DB_CA_CERT },\n})",
      SOURCES.pgConnectionString);
  }

  // --- Generic Postgres checks (SOURCES.libpq) ---
  if (parsed.database === null && cls.kind !== 'api-host') {
    add('missing-database', 'info', 'No database name in the URL',
      `libpq defaults the database name to the user name${parsed.user ? ` — here "${parsed.user}"` : ''}, which is rarely what you want.${cls.provider === 'supabase' ? ' Every Supabase connection string ends in /postgres.' : ''}`,
      cls.provider === 'supabase' ? '…:5432/postgres' : '…:5432/your_database', SOURCES.libpq);
  }
  if (parsed.port === null && parsed.rawPort === null && !onPooler && cls.kind !== 'api-host') {
    add('missing-port', 'info', 'No port — the libpq default is used',
      'Without a port the client uses the default PostgreSQL was built with (5432 on standard builds). Write it out so the URL says what it does.',
      `…@${parsed.host || 'host'}:5432/…`, SOURCES.libpq);
  }
  if (cls.provider === 'local') {
    add('localhost', 'info', `${parsed.host} only works on the machine that runs the code`,
      'Fine in .env.local. In a deployed function, CI job or container, localhost is that machine itself, not your database — make sure production uses the real host.',
      '# production\nDATABASE_URL="postgresql://user:[YOUR-PASSWORD]@your-db-host:5432/dbname"', SOURCES.libpq);
  }
  if (!parsed.rawUser && cls.provider !== 'local') {
    add('missing-user', 'info', 'No user name in the URL',
      'libpq then falls back to your operating-system user name. Managed hosts such as Supabase expect an explicit user.',
      'postgresql://postgres:[YOUR-PASSWORD]@host:5432/dbname', SOURCES.libpq);
  }

  // --- Components table (password masked everywhere) ---
  const components = [
    { label: 'Scheme', value: `${parsed.scheme}://` },
    { label: 'User', value: parsed.user ?? '(none)' },
    { label: 'Password', value: parsed.hasPassword ? MASK : '(none)' },
    { label: 'Host', value: parsed.host || '(none)' },
    { label: 'Port', value: parsed.rawPort !== null ? (parsed.port !== null ? String(parsed.port) : '(invalid)') : '(default: 5432)' },
    { label: 'Database', value: parsed.database ?? '(none — defaults to the user name)' },
    ...parsed.params.slice(0, MAX_PARAM_ROWS).map((p) => ({ label: `?${p.key}`, value: /pass/i.test(p.key) ? MASK : p.value })),
    ...(parsed.params.length > MAX_PARAM_ROWS ? [{ label: '?…', value: `+${parsed.params.length - MAX_PARAM_ROWS} more parameters not shown` }] : []),
    { label: 'Endpoint', value: KIND_LABELS[cls.kind] },
  ];
  if (cls.provider === 'supabase' && cls.kind !== 'api-host') {
    components.push({ label: 'Pool mode', value: cls.transaction ? 'transaction (no prepared statements)' : cls.kind === 'shared-session' ? 'session' : 'none (direct)' });
  }

  let passwordOut = PASSWORD_PLACEHOLDER;
  if (revealPassword && parsed.hasPassword && !isPlaceholder(parsed.rawPassword)) {
    passwordOut = encodeURIComponent(decodedPassword(parsed));
  }
  const corrected = buildCorrected(parsed, cls, client, forMigrations, passwordOut);

  const order = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return { ok: true, client, forMigrations, kind: cls.kind, kindLabel: KIND_LABELS[cls.kind], components, findings, corrected };
}
