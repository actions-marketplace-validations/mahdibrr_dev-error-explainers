// database-connection-explainer — pure diagnostic logic for "can't connect to
// the database" errors printed by Node.js apps talking to PostgreSQL
// (node-postgres, postgres.js, Prisma, Drizzle…).
//
// Input: the pasted error text. Output: what the error means, why, and checks /
// fixes ranked least invasive first, each with the primary source it was
// verified against (fetched 2026-09-30). No React, no DOM, no network.
//
// Scope boundary: the connection STRING itself (percent-encoding, pooler host
// and port, pgbouncer=true, sslmode semantics, Supabase specifics) belongs to
// database-url-doctor. When the input carries a postgres:// URL, a Supabase
// host or an sslmode, this module points there instead of re-diagnosing — and
// never echoes the URL back.
//
// Recognition is strict: only exact codes / messages count. Generic Node.js
// network and TLS codes (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, EAI_AGAIN,
// SELF_SIGNED_CERT_IN_CHAIN) are printed by Redis, MySQL, npm and every HTTP
// client too, so they are only diagnosed here when the text also carries a
// Postgres signal (port 5432/6543, a pg / pg-pool / postgres.js / @prisma/adapter-pg stack frame, a
// host literally named "postgres", a postgres:// URL) or the caller says so
// with { postgres: true }. Anything else is "not recognised".
// Prisma's P1000 / P1001 / P1017 are recognised by their own message, but
// Prisma also speaks MySQL, SQL Server, CockroachDB...: a P-code alone is NOT a
// Postgres signal, and PostgreSQL-specific advice (psql, postgresql:// URLs,
// PostgreSQL docs) is only added to a Prisma finding when a signal exists.
//
// Claims that were dropped because no primary source backs them are listed in
// docs/rules/database-connection.md.

import { maskSecrets } from './esm-cjs-explainer.js';

export { maskSecrets };

// ─── Sources ────────────────────────────────────────────────────────────────

export const SOURCES = {
  // errors.md "Common system errors": ECONNREFUSED "target machine actively
  // refused it"; ETIMEDOUT "did not properly respond after a period of time";
  // ENOTFOUND "DNS failure of either EAI_NODATA or EAI_NONAME".
  nodeSystemErrors: {
    url: 'https://nodejs.org/api/errors.html#common-system-errors',
    label: 'Node.js docs — Common system errors',
  },
  // dns.md: setDefaultResultOrder history "v17.0.0 Changed default value to
  // verbatim"; values ipv4first / ipv6first / verbatim; --dns-result-order.
  dnsResultOrder: {
    url: 'https://nodejs.org/api/dns.html#dnssetdefaultresultorderorder',
    label: 'Node.js docs — dns.setDefaultResultOrder() (default "verbatim" since v17.0.0)',
  },
  // dns.md dns.lookup(): err.code is ENOTFOUND "not only when the host name
  // does not exist but also when the lookup fails in other ways".
  dnsLookup: {
    url: 'https://nodejs.org/api/dns.html#dnslookuphostname-options-callback',
    label: 'Node.js docs — dns.lookup()',
  },
  // dns.md "Implementation considerations": dns.lookup() uses getaddrinfo(3)
  // and the OS resolver (nsswitch.conf / resolv.conf).
  dnsImplementation: {
    url: 'https://nodejs.org/api/dns.html#implementation-considerations',
    label: 'Node.js docs — dns.lookup() implementation considerations',
  },
  // net.md socket.connect(): autoSelectFamily default true since v20.0.0 /
  // v18.18.0; tries IPv6 and IPv4 addresses in turn; "If all connections
  // attempts fails, a single AggregateError with all failed attempts is emitted."
  netAutoSelectFamily: {
    url: 'https://nodejs.org/api/net.html#socketconnectoptions-connectlistener',
    label: 'Node.js docs — socket.connect() autoSelectFamily',
  },
  // libuv errors: "UV_EAI_AGAIN — temporary failure".
  libuvErrors: {
    url: 'https://docs.libuv.org/en/v1.x/errors.html',
    label: 'libuv docs — Error constants (UV_EAI_AGAIN: temporary failure)',
  },
  // tls.md "X509 certificate error codes": SELF_SIGNED_CERT_IN_CHAIN,
  // DEPTH_ZERO_SELF_SIGNED_CERT.
  tlsCodes: {
    url: 'https://nodejs.org/api/tls.html#x509-certificate-error-codes',
    label: 'Node.js docs — X509 certificate error codes',
  },
  // cli.md NODE_EXTRA_CA_CERTS=file: extends the well-known root CAs.
  nodeExtraCaCerts: {
    url: 'https://nodejs.org/api/cli.html#node_extra_ca_certsfile',
    label: 'Node.js docs — NODE_EXTRA_CA_CERTS',
  },
  // Compose networking: "The web service can connect to the database at
  // postgres://db:5432. From the host machine, the same database is accessible
  // at postgres://localhost:8001"; service-to-service uses the CONTAINER_PORT.
  composeNetworking: {
    url: 'https://docs.docker.com/compose/how-tos/networking/',
    label: 'Docker docs — Networking in Compose',
  },
  // Engine networking: "--dns=127.0.0.1 refers to the container's own loopback address".
  dockerNetworking: {
    url: 'https://docs.docker.com/engine/network/',
    label: 'Docker docs — Networking overview',
  },
  // Docker Desktop: host.docker.internal "Resolves to the internal IP address of your host".
  dockerDesktopHost: {
    url: 'https://docs.docker.com/desktop/features/networking/networking-how-tos/',
    label: 'Docker Desktop docs — Connect a container to a service on the host',
  },
  // Prisma ORM (v6 docs) error reference: P1000, P1001, P1017 message texts.
  prismaErrors: {
    url: 'https://www.prisma.io/docs/orm/v6/reference/error-reference',
    label: 'Prisma ORM docs — Error message reference (P1000, P1001, P1017)',
  },
  // prisma-engines user-facing-errors: the templates the engines actually print.
  prismaEngineErrors: {
    url: 'https://github.com/prisma/prisma-engines/blob/main/libs/user-facing-errors/src/common.rs',
    label: 'prisma-engines — user-facing error definitions (P1000, P1001, P1017)',
  },
  // PostgreSQL "Authentication Problems": no pg_hba.conf entry / password
  // authentication failed, and the server-log tip.
  pgAuthProblems: {
    url: 'https://www.postgresql.org/docs/current/client-authentication-problems.html',
    label: 'PostgreSQL docs — Authentication Problems',
  },
  // PostgreSQL pg_hba.conf: host / hostssl / hostnossl record types.
  pgHba: {
    url: 'https://www.postgresql.org/docs/current/auth-pg-hba-conf.html',
    label: 'PostgreSQL docs — The pg_hba.conf File',
  },
  // PostgreSQL connection settings: listen_addresses (default localhost),
  // port, max_connections, reserved_connections, superuser_reserved_connections.
  pgConnSettings: {
    url: 'https://www.postgresql.org/docs/current/runtime-config-connection.html',
    label: 'PostgreSQL docs — Connections and Authentication settings',
  },
  // pg_stat_activity: one row per server process.
  pgStatActivity: {
    url: 'https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-ACTIVITY-VIEW',
    label: 'PostgreSQL docs — pg_stat_activity',
  },
  // PostgreSQL SSL: "setting the parameter ssl to on in postgresql.conf".
  pgSsl: {
    url: 'https://www.postgresql.org/docs/current/ssl-tcp.html',
    label: 'PostgreSQL docs — Secure TCP/IP Connections with SSL',
  },
  // Server source: "sorry, too many clients already".
  pgSourceTooMany: {
    url: 'https://github.com/postgres/postgres/blob/master/src/backend/storage/lmgr/proc.c',
    label: 'PostgreSQL source — proc.c ("sorry, too many clients already")',
  },
  // Server source: "remaining connection slots are reserved for roles with the
  // SUPERUSER attribute" / "…privileges of the pg_use_reserved_connections
  // role"; REL_15_STABLE: "…for non-replication superuser connections".
  pgSourceReserved: {
    url: 'https://github.com/postgres/postgres/blob/master/src/backend/utils/init/postinit.c',
    label: 'PostgreSQL source — postinit.c ("remaining connection slots are reserved…")',
  },
  // Server source: "no pg_hba.conf entry for host …, %s" where %s is
  // "no encryption" / "SSL encryption" / "GSS encryption" (REL_13: "SSL off" / "SSL on").
  pgSourceHba: {
    url: 'https://github.com/postgres/postgres/blob/master/src/backend/libpq/auth.c',
    label: 'PostgreSQL source — auth.c ("no pg_hba.conf entry for host …")',
  },
  // node-postgres SSL: ssl object is passed to TLSSocket (ca, key, cert);
  // sslmode/sslrootcert… in the connection string REPLACE the ssl object.
  nodePgSsl: {
    url: 'https://node-postgres.com/features/ssl',
    label: 'node-postgres docs — SSL',
  },
  // node-postgres Pool: max "By default this is set to 10".
  nodePgPool: {
    url: 'https://node-postgres.com/apis/pool',
    label: 'node-postgres docs — pg.Pool',
  },
  // node-postgres pool sizing: think about max across all instances; pg-bouncer / RDS proxy.
  nodePgPoolSizing: {
    url: 'https://node-postgres.com/guides/pool-sizing',
    label: 'node-postgres docs — Pool sizing',
  },
  // node-postgres connection.js: server answers 'N' to SSLRequest →
  // new Error('The server does not support SSL connections').
  nodePgNoSsl: {
    url: 'https://github.com/brianc/node-postgres/blob/master/packages/pg/lib/connection.js',
    label: 'node-postgres source — connection.js (SSLRequest answered "N")',
  },
};

// ─── Rule catalogue (rendered by docs / UIs; kept next to the code) ──────────

export const RULES = [
  { id: 'db.econnrefused-ipv6-localhost', name: 'ECONNREFUSED ::1 — IPv6 localhost', source: SOURCES.dnsResultOrder },
  { id: 'db.econnrefused', name: 'ECONNREFUSED — nothing accepted the TCP connection', source: SOURCES.nodeSystemErrors },
  { id: 'db.etimedout', name: 'connect ETIMEDOUT — no answer from the server', source: SOURCES.nodeSystemErrors },
  { id: 'db.enotfound', name: 'getaddrinfo ENOTFOUND — host name did not resolve', source: SOURCES.nodeSystemErrors },
  { id: 'db.eai-again', name: 'getaddrinfo EAI_AGAIN — temporary name-resolution failure', source: SOURCES.libuvErrors },
  { id: 'db.prisma-p1001', name: "Prisma P1001 — Can't reach database server", source: SOURCES.prismaErrors },
  { id: 'db.prisma-p1000', name: 'Prisma P1000 — Authentication failed', source: SOURCES.prismaErrors },
  { id: 'db.prisma-p1017', name: 'Prisma P1017 — Server has closed the connection', source: SOURCES.prismaErrors },
  { id: 'db.password-auth-failed', name: 'password authentication failed for user', source: SOURCES.pgAuthProblems },
  { id: 'db.pg-hba-no-entry', name: 'no pg_hba.conf entry for host', source: SOURCES.pgAuthProblems },
  { id: 'db.too-many-connections', name: 'too many clients / remaining connection slots are reserved', source: SOURCES.pgConnSettings },
  { id: 'db.tls-self-signed', name: 'self-signed certificate (in certificate chain)', source: SOURCES.tlsCodes },
  { id: 'db.server-no-ssl', name: 'The server does not support SSL connections', source: SOURCES.nodePgNoSsl },
];

export const RULE_IDS = RULES.map((r) => r.id);

// ─── Signals ────────────────────────────────────────────────────────────────

const PG_PORTS = new Set([5432, 6543]);
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Every "connect <CODE> <address>:<port>" in the text (single errors and AggregateError members). */
function connectErrors(text, code) {
  const out = [];
  const re = new RegExp(`connect ${code} ((?:\\d{1,3}\\.){3}\\d{1,3}|[0-9a-fA-F:]*:[0-9a-fA-F:.]*):(\\d{1,5})\\b`, 'g');
  for (const m of text.matchAll(re)) out.push({ address: m[1], port: Number(m[2]) });
  return out;
}

function hasCode(text, code) {
  return new RegExp(`\\bconnect ${code}\\b|\\[${code}\\]|code: '${code}'`).test(text);
}

/** What in the text says "this is a PostgreSQL connection"? `null` when nothing does. */
export function postgresSignal(text, { postgres = false } = {}) {
  if (postgres) return 'caller';
  if (/\bpostgres(?:ql)?:\/\//i.test(text)) return 'connection-string';
  // Postgres-only drivers. Not @prisma/*: Prisma also drives MySQL, SQL Server, CockroachDB…
  if (/node_modules[\\/](?:pg|pg-pool|pg-protocol|postgres|@prisma[\\/]adapter-pg|@neondatabase[\\/][\w-]+)[\\/]/.test(text)) return 'stack-frame';
  // "connect ECONNREFUSED 127.0.0.1:5432", "port: 5432", Prisma's "`host`:`5432`" / "`host:5432`".
  const ports = [...text.matchAll(/(?:connect E[A-Z]+ [0-9a-fA-F:.]+:|\bport:\s*|`[^`\s]+`:`|`[^`\s]+:)(\d{1,5})\b/g)].map((m) => Number(m[1]));
  if (ports.some((p) => PG_PORTS.has(p))) return 'port';
  if (/getaddrinfo (?:ENOTFOUND|EAI_AGAIN) postgres(?:ql)?\b/.test(text)) return 'host-name';
  return null;
}

/** Pointers to database-url-doctor (never with the URL itself). */
function relatedModules(text) {
  const reasons = [];
  if (/\bpostgres(?:ql)?:\/\//i.test(text)) reasons.push('The text contains a postgres:// connection string. Paste it into database-url-doctor to check its encoding, host, port and parameters — it is not echoed here.');
  if (/\b[\w-]+\.(?:supabase\.co|pooler\.supabase\.com)\b/i.test(text)) reasons.push('The host is a Supabase host: database-url-doctor knows its direct / pooler / IPv6 rules.');
  if (/\bsslmode=/i.test(text)) reasons.push('The text sets sslmode: database-url-doctor explains how each driver reads it.');
  return reasons.length ? [{ module: 'database-url-doctor', reasons }] : [];
}

// ─── Fix snippets reused across findings ────────────────────────────────────

const DOCKER_LOCALHOST_FIX = (scheme = 'postgres', port = 5432) => ({
  title: 'Running the app in a container? localhost is the container itself',
  detail: 'Inside a container, 127.0.0.1 is the container\'s own loopback address, not your machine\'s. With Docker Compose, reach the database by its service name and the CONTAINER port (postgres://db:5432 in Docker\'s example); the host port (localhost:8001 in that example) is only for connections from the host. To reach a database running on the host from Docker Desktop, use host.docker.internal.',
  code: `# compose.yaml service "db", app in another service (container port):\nDATABASE_URL=${scheme}://user:[YOUR-PASSWORD]@db:${port}/app\n# database on the host, app in a container (Docker Desktop):\nDATABASE_URL=${scheme}://user:[YOUR-PASSWORD]@host.docker.internal:${port}/app`,
});

const TCP_CHECK = (host, port) => ({
  title: 'Test the TCP connection from the machine that runs the code',
  detail: 'Same machine, same container, same network as the failing process — a check from your laptop proves nothing about a CI runner or a container.',
  code: `node -e "require('net').connect(${port || 5432}, '${host || 'your-db-host'}').on('connect', () => { console.log('reachable'); process.exit(0) }).on('error', (e) => { console.log(e.code); process.exit(1) })"`,
});

const DNS_CHECK = (host) => ({
  title: 'Resolve the name the way Node.js does, where the code runs',
  detail: 'Node.js resolves host names with dns.lookup(), which uses the operating system resolver (getaddrinfo), so run the check inside the same container / runner.',
  code: `node -e "require('dns').lookup('${host || 'your-db-host'}', { all: true }, (e, a) => console.log(e ? e.code : a))"`,
});

// ─── Rules ──────────────────────────────────────────────────────────────────
// Each rule: { id, severity, test(ctx) → match|null, build(ctx, match) → finding }.

const RULE_IMPL = [
  // ECONNREFUSED on ::1 only. dns.md: dns.lookup() order defaults to verbatim
  // since v17.0.0, so "localhost" can resolve to ::1 first. net.md: with
  // autoSelectFamily (default since v20.0.0 / v18.18.0) Node.js tries every
  // address and reports an AggregateError when all fail — so a ::1-ONLY error
  // means the IPv4 loopback was never tried.
  {
    id: 'db.econnrefused-ipv6-localhost',
    severity: 'critical',
    test: (c) => {
      if (!c.signal) return null;
      const all = connectErrors(c.text, 'ECONNREFUSED');
      const v6 = all.filter((e) => e.address === '::1');
      if (!v6.length || all.some((e) => e.address !== '::1')) return null;
      return v6[0];
    },
    build: (c, m) => ({
      title: `ECONNREFUSED ::1:${m.port} — the client tried the IPv6 loopback`,
      cause: `Your client connected to ::1 (IPv6 localhost) on port ${m.port}, and nothing accepted the connection there. The error lists no IPv4 attempt: if your config says "localhost", Node.js resolved it to ::1 and did not try 127.0.0.1.`,
      why: 'Since Node.js 17.0.0, dns.lookup() returns addresses in the order the resolver gives them ("verbatim") instead of putting IPv4 first, so "localhost" can come back as ::1. PostgreSQL only accepts TCP connections on the addresses in listen_addresses; a server reachable on 127.0.0.1 but not on ::1 refuses this attempt. (When Node.js tries several addresses — autoSelectFamily, on by default since 20.0.0 / 18.18.0 — and all fail, it reports one AggregateError listing each of them.)',
      fixes: [
        { title: 'Use 127.0.0.1 instead of localhost', detail: 'An IPv4 literal never goes through name resolution, so the result no longer depends on the Node.js version or the resolver order.', code: `# in your config / .env\nhost: 127.0.0.1   # was: localhost\nport: ${m.port}` },
        { title: 'Or ask Node.js to prefer IPv4 when resolving', detail: 'Process-wide: --dns-result-order=ipv4first on the command line, or dns.setDefaultResultOrder() at startup (it has priority over the flag).', code: "node --dns-result-order=ipv4first server.js\n// or, first thing in your entry file:\nimport dns from 'node:dns';\ndns.setDefaultResultOrder('ipv4first');" },
        { title: 'Or make PostgreSQL listen on ::1 too (if you run the server)', detail: 'listen_addresses lists the interfaces the server accepts TCP connections on; it can only be changed at server start.', code: "# postgresql.conf, then restart PostgreSQL\nlisten_addresses = '127.0.0.1,::1'" },
      ],
      source: SOURCES.dnsResultOrder,
      extraSources: [SOURCES.nodeSystemErrors, SOURCES.pgConnSettings, SOURCES.netAutoSelectFamily],
    }),
  },

  // Every other ECONNREFUSED. errors.md: "No connection could be made because
  // the target machine actively refused it … a service that is inactive on the
  // foreign host." runtime-config-connection: listen_addresses default
  // localhost; port 5432 by default.
  {
    id: 'db.econnrefused',
    severity: 'critical',
    test: (c) => {
      if (!c.signal || !hasCode(c.text, 'ECONNREFUSED')) return null;
      const all = connectErrors(c.text, 'ECONNREFUSED');
      if (all.length && all.every((e) => e.address === '::1')) return null; // handled above
      return { all };
    },
    build: (c, m) => {
      const first = m.all[0] || null;
      const port = first ? first.port : null;
      const addrs = [...new Set(m.all.map((e) => e.address))];
      const loopback = addrs.length > 0 && addrs.every((a) => a === '::1' || LOOPBACK_V4.test(a));
      const bothFamilies = addrs.includes('::1') && addrs.some((a) => LOOPBACK_V4.test(a));
      const where = addrs.length ? `${addrs.map(maskSecrets).join(' and ')}${port ? ` on port ${port}` : ''}` : 'the database address';
      const fixes = [];
      let cause = `Nothing accepted the TCP connection at ${where}: the operating system refused it.`;
      if (bothFamilies) cause += ' Node.js tried both the IPv6 and the IPv4 loopback and both were refused, so this is not an IPv4/IPv6 mix-up: no server is listening on that port on this machine.';
      if (loopback) {
        fixes.push(
          { title: 'Is PostgreSQL running, on that port?', detail: `The server listens on port 5432 unless configured otherwise${port && port !== 5432 ? ` — you connect to ${port}` : ''}. Start it, or point the app at the port it really uses.`, code: 'pg_isready -h 127.0.0.1 -p ' + (port || 5432) + '\n# Docker: is the container up, and is the port published?\ndocker ps --format "{{.Names}}  {{.Ports}}"' },
          DOCKER_LOCALHOST_FIX('postgres', port || 5432),
        );
      } else {
        fixes.push(
          TCP_CHECK(addrs[0], port),
          { title: 'If you run that server: does it listen on this interface?', detail: 'PostgreSQL only accepts TCP connections on the addresses in listen_addresses, whose default "localhost" allows loopback connections only — remote clients are then refused. Changing it requires a restart, and pg_hba.conf must also allow the client.', code: "# postgresql.conf\nlisten_addresses = '*'   # or a specific interface address" },
          { title: 'Check host and port against where the database really is', detail: 'A refused connection means something answered at that address, but nothing listens on that port.', code: '' },
        );
      }
      const label = addrs.length === 1 ? ` ${maskSecrets(addrs[0])}${port ? `:${port}` : ''}` : addrs.length > 1 ? ' on every address tried' : '';
      return {
        title: `ECONNREFUSED${label} — connection refused`,
        cause,
        why: 'ECONNREFUSED means the target machine actively refused the connection, which usually results from trying to connect to a service that is not running there. It happens before any PostgreSQL authentication — the password is not the problem yet.',
        fixes,
        source: SOURCES.nodeSystemErrors,
        extraSources: loopback ? [SOURCES.composeNetworking, SOURCES.dockerNetworking, SOURCES.dockerDesktopHost, SOURCES.netAutoSelectFamily] : [SOURCES.pgConnSettings],
      };
    },
  },

  // connect ETIMEDOUT. errors.md: "the connected party did not properly
  // respond after a period of time". Only "connect ETIMEDOUT" — a "read
  // ETIMEDOUT" happens after the connection was established.
  {
    id: 'db.etimedout',
    severity: 'critical',
    test: (c) => (c.signal && /\bconnect ETIMEDOUT\b/.test(c.text) ? connectErrors(c.text, 'ETIMEDOUT')[0] || {} : null),
    build: (c, m) => ({
      title: `connect ETIMEDOUT${m.address ? ` ${maskSecrets(m.address)}:${m.port}` : ''} — the server never answered`,
      cause: `The TCP connection attempt${m.address ? ` to ${maskSecrets(m.address)} on port ${m.port}` : ''} got no answer at all before the timeout.`,
      why: 'ETIMEDOUT means the other side did not respond within the time allowed. That is different from ECONNREFUSED, where a machine answered and refused: here nothing answered, so the packets did not reach a listening server or its reply did not come back. PostgreSQL authentication has not started yet.',
      fixes: [
        TCP_CHECK(m.address, m.port),
        { title: 'Check that host and port are the ones you intend', detail: 'Compare them with where the database really is, as seen from the network the failing process runs in.', code: '' },
      ],
      source: SOURCES.nodeSystemErrors,
      extraSources: [SOURCES.netAutoSelectFamily],
    }),
  },

  // getaddrinfo ENOTFOUND. errors.md: DNS failure (EAI_NODATA / EAI_NONAME);
  // dns.md: also set when the lookup fails in other ways. Compose: service
  // names resolve for containers on the Compose network.
  {
    id: 'db.enotfound',
    severity: 'critical',
    test: (c) => {
      const m = c.text.match(/getaddrinfo ENOTFOUND (\S+)/);
      return c.signal && m ? { host: m[1].replace(/['"`,]+$/, '') } : null;
    },
    build: (c, m) => {
      const host = maskSecrets(m.host);
      const bare = !host.includes('.') && !host.includes(':') && host !== 'localhost';
      const fixes = [DNS_CHECK(host)];
      if (bare) {
        fixes.push({ title: `"${host}" looks like a Docker Compose service name`, detail: 'Service names resolve only for containers attached to the Compose network. From the host machine, use localhost and the PUBLISHED host port; from another container, use the service name and the container port.', code: `# app inside Compose (same network)\npostgres://user:[YOUR-PASSWORD]@${host}:5432/app\n# app on the host, "ports: - '5432:5432'" in compose.yaml\npostgres://user:[YOUR-PASSWORD]@localhost:5432/app` });
      } else {
        fixes.push({ title: 'Check the spelling of the host', detail: 'Copy it again from the provider\'s dashboard; a single wrong character gives exactly this error.', code: '' });
      }
      return {
        title: `getaddrinfo ENOTFOUND ${host} — the host name did not resolve`,
        cause: `Node.js could not turn "${host}" into an IP address, so no connection was attempted.`,
        why: 'ENOTFOUND is a DNS failure (EAI_NODATA or EAI_NONAME). Node.js also reports ENOTFOUND when the lookup fails in other ways, so check the name from the environment that runs the code.',
        fixes,
        source: SOURCES.nodeSystemErrors,
        extraSources: bare ? [SOURCES.dnsLookup, SOURCES.composeNetworking] : [SOURCES.dnsLookup],
      };
    },
  },

  // getaddrinfo EAI_AGAIN. libuv: "temporary failure"; dns.md: lookup goes
  // through getaddrinfo(3) and the OS resolver configuration.
  {
    id: 'db.eai-again',
    severity: 'critical',
    test: (c) => {
      const m = c.text.match(/getaddrinfo EAI_AGAIN (\S+)/);
      return c.signal && m ? { host: m[1].replace(/['"`,]+$/, '') } : null;
    },
    build: (c, m) => {
      const host = maskSecrets(m.host);
      const bare = !host.includes('.') && !host.includes(':');
      return {
        title: `getaddrinfo EAI_AGAIN ${host} — name resolution failed temporarily`,
        cause: `Resolving "${host}" failed with a temporary error: the resolver did not give a definitive answer.`,
        why: 'EAI_AGAIN is getaddrinfo\'s "temporary failure". Node.js resolves host names through getaddrinfo(3), which uses the operating system\'s resolver configuration — so the failure is in the name service reachable from where the code runs, not in PostgreSQL.',
        fixes: [
          DNS_CHECK(host),
          ...(bare ? [{ title: `"${host}" looks like a Docker Compose service name`, detail: 'It only resolves for containers attached to the same Compose network — check the failing container is on it, and that the database service is part of the same project.', code: 'docker network inspect <project>_default' }] : []),
          { title: 'Retry once the name service is reachable', detail: 'The code says the failure is temporary: if the check above succeeds a moment later, the problem was the resolver, not your configuration.', code: '' },
        ],
        source: SOURCES.libuvErrors,
        extraSources: bare ? [SOURCES.dnsImplementation, SOURCES.composeNetworking] : [SOURCES.dnsImplementation],
      };
    },
  },

  // Prisma P1001. Reference: "Can't reach database server at {database_host}:
  // {database_port} Please make sure your database server is running at …".
  {
    id: 'db.prisma-p1001',
    severity: 'critical',
    test: (c) => {
      const m = c.text.match(/Can't reach database server at `([^`]+)`(?::`(\d{1,5})`)?/);
      if (!m) return null;
      let host = m[1];
      let port = m[2] ? Number(m[2]) : null;
      const hp = !m[2] && host.match(/^(.*):(\d{1,5})$/);
      if (hp) { host = hp[1]; port = Number(hp[2]); }
      return { host, port };
    },
    build: (c, m) => {
      const host = maskSecrets(m.host);
      const local = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/.test(host);
      const bare = !host.includes('.') && !host.includes(':') && host !== 'localhost';
      const scheme = c.signal ? 'postgresql' : '<provider>';
      const port = m.port || (c.signal ? 5432 : '<port>');
      const fixes = [
        { title: `Is the database server running at ${host}${m.port ? `:${m.port}` : ''}?`, detail: 'The message itself asks you to make sure the database server is running at that address. Check it from the machine that runs Prisma.', code: m.port ? TCP_CHECK(host, m.port).code : '' },
      ];
      if (local) fixes.push(DOCKER_LOCALHOST_FIX(scheme, port));
      if (bare) fixes.push({ title: `"${host}" looks like a Docker Compose service name`, detail: 'It resolves only inside the Compose network. Running prisma migrate / db push from your host? Use localhost and the published host port there.', code: `# from the host (published host port)\nDATABASE_URL=${scheme}://user:[YOUR-PASSWORD]@localhost:<host-port>/app` });
      return {
        title: `Prisma P1001 — can't reach database server at ${host}${m.port ? `:${m.port}` : ''}`,
        cause: `Prisma could not open a connection to ${host}${m.port ? ` on port ${m.port}` : ''}.`,
        why: 'P1001 is Prisma\'s "Can\'t reach database server" error: the connection did not succeed, so credentials were never checked. Any underlying network code in the same log (ECONNREFUSED, ETIMEDOUT, ENOTFOUND) narrows down why.',
        fixes,
        source: SOURCES.prismaErrors,
        extraSources: local ? [SOURCES.prismaEngineErrors, SOURCES.composeNetworking, SOURCES.dockerNetworking] : bare ? [SOURCES.prismaEngineErrors, SOURCES.composeNetworking] : [SOURCES.prismaEngineErrors],
      };
    },
  },

  // Prisma P1000. Reference: "Authentication failed against database server at
  // {database_host}, the provided database credentials for {database_user} are not valid."
  {
    id: 'db.prisma-p1000',
    severity: 'critical',
    test: (c) => {
      if (!/Authentication failed against (?:the )?database server/.test(c.text)) return null;
      const u = c.text.match(/credentials for `([^`]*)` are not valid/);
      const h = c.text.match(/Authentication failed against (?:the )?database server at `([^`]+)`/);
      return { user: u ? u[1] : null, host: h ? h[1] : null };
    },
    build: (c, m) => ({
      title: `Prisma P1000 — authentication failed${m.user ? ` for "${maskSecrets(m.user)}"` : ''}`,
      cause: `The server was reached, but it rejected the credentials${m.user ? ` for user "${maskSecrets(m.user)}"` : ''}${m.host ? ` at ${maskSecrets(m.host)}` : ''}.`,
      why: 'P1000 means the database credentials Prisma sent are not valid for that server. Reaching this step proves the network path works — the user name, the password or the way the password is written into DATABASE_URL is wrong.',
      fixes: [
        { title: 'Check the password that actually reaches Prisma', detail: `Special characters in a URL password must be percent-encoded.${c.signal ? ' database-url-doctor checks a pasted PostgreSQL DATABASE_URL for that.' : ''}`, code: '' },
        c.signal
          ? { title: 'Try the same credentials with psql', detail: 'If psql with the same user and password also fails, the credentials are wrong on the server side; if psql works, the difference is in how the URL is written.', code: 'psql -h <host> -p 5432 -U <user> -d <database>' }
          : { title: "Try the same credentials with the database's own client", detail: 'If it also fails, the credentials are wrong on the server side; if it works, the difference is in how the URL is written.', code: '' },
        ...(c.signal ? [{ title: 'Read the server log', detail: 'The PostgreSQL docs note that the server log can contain more information about an authentication failure than is reported to the client.', code: '' }] : []),
      ],
      source: SOURCES.prismaErrors,
      extraSources: c.signal ? [SOURCES.prismaEngineErrors, SOURCES.pgAuthProblems] : [SOURCES.prismaEngineErrors],
    }),
  },

  // Prisma P1017. Reference: "Server has closed the connection." — nothing more
  // is documented, so the fixes are checks, not asserted causes.
  {
    id: 'db.prisma-p1017',
    severity: 'critical',
    test: (c) => (/\bP1017\b/.test(c.text) && /Server has closed the connection/.test(c.text) ? {} : null),
    build: (c) => ({
      title: 'Prisma P1017 — server has closed the connection',
      cause: 'The connection Prisma was using was closed from the server side.',
      why: 'Prisma\'s reference documents P1017 only as "Server has closed the connection." — it does not say why. The reason is on the other side of the connection: the database server, or whatever sits in front of it.',
      fixes: [
        { title: "Read the database server's log at the time of the error", detail: 'The client only sees that the connection was closed; the other side may say why.', code: '' },
        { title: 'Connect with the same URL using another client', detail: 'If another client can connect and query with the same DATABASE_URL while Prisma cannot, note the Prisma version and command and compare with open Prisma issues.', code: c.signal ? 'psql "$DATABASE_URL" -c "select 1"' : '' },
      ],
      source: SOURCES.prismaErrors,
      extraSources: [SOURCES.prismaEngineErrors],
    }),
  },

  // "password authentication failed for user". PostgreSQL Authentication
  // Problems: "you contacted the server, and it is willing to talk to you, but
  // not until you pass the authorization method specified in pg_hba.conf".
  {
    id: 'db.password-auth-failed',
    severity: 'critical',
    test: (c) => {
      const m = c.text.match(/password authentication failed for user "([^"]*)"/);
      return m ? { user: m[1] } : null;
    },
    build: (c, m) => {
      const user = maskSecrets(m.user);
      return {
        title: `password authentication failed for user "${user}"`,
        cause: `The PostgreSQL server was reached and asked for a password for "${user}", and the password sent did not match.`,
        why: 'This message means you contacted the server and it is willing to talk to you, but not until you pass the authentication method pg_hba.conf specifies for this connection — here, a password. The network and the pg_hba.conf entry are fine; the password (or the user it belongs to) is not.',
        fixes: [
          { title: 'Check the password that actually reaches the driver', detail: 'Log whether the variable is set (never its value), and check its encoding: special characters in a URL password must be percent-encoded. database-url-doctor checks a pasted DATABASE_URL for that.', code: "console.log('DATABASE_URL set:', Boolean(process.env.DATABASE_URL))" },
          { title: 'Check the user name', detail: `The server checked the password of "${user}" — make sure that is the role you meant to log in as.`, code: '' },
          { title: 'Read the server log if the password is definitely right', detail: 'The PostgreSQL docs note the server log can hold more detail about an authentication failure than the client sees.', code: '' },
        ],
        source: SOURCES.pgAuthProblems,
      };
    },
  },

  // "no pg_hba.conf entry for host". Authentication Problems + pg_hba.conf
  // (hostssl matches only SSL connections; hostnossl only non-SSL) + auth.c
  // suffixes: "no encryption" / "SSL encryption" / "GSS encryption" (REL_13:
  // "SSL off" / "SSL on").
  {
    id: 'db.pg-hba-no-entry',
    severity: 'critical',
    test: (c) => {
      const m = c.text.match(/no pg_hba\.conf entry for (?:replication connection from )?host "([^"]*)", user "([^"]*)"(?:, database "([^"]*)")?(?:, (no encryption|SSL off|SSL encryption|SSL on|GSS encryption))?/);
      return m ? { host: m[1], user: m[2], database: m[3] || null, encryption: m[4] || null } : null;
    },
    build: (c, m) => {
      const plain = m.encryption === 'no encryption' || m.encryption === 'SSL off';
      const encrypted = m.encryption === 'SSL encryption' || m.encryption === 'SSL on' || m.encryption === 'GSS encryption';
      const fixes = [];
      if (plain) {
        fixes.push({ title: 'The connection was not encrypted — enable SSL on the client', detail: `The server reports the attempt as "${m.encryption}". A hostssl line in pg_hba.conf only matches connections made with SSL, so if the entry meant for you is a hostssl line, no line matches this attempt. With node-postgres, SSL is enabled through the ssl option (use the server's CA certificate).`, code: "const pool = new Pool({\n  connectionString: process.env.DATABASE_URL,\n  ssl: { ca: fs.readFileSync('/path/to/server-ca.crt').toString() },\n})" });
      }
      const sslNote = encrypted
        ? ' SSL is already in use, so the missing piece is on the server.'
        : ' The example uses hostssl, which only matches connections made with SSL — the client must connect with SSL. A host line would also accept unencrypted connections.';
      fixes.push({ title: 'If you run the server: add a pg_hba.conf line for this client', detail: `No line matched host ${maskSecrets(m.host)}, user "${maskSecrets(m.user)}"${m.database ? `, database "${maskSecrets(m.database)}"` : ''}. Add a line for that client address and user, then make the server re-read the file (pg_reload_conf()).${sslNote}`, code: `# pg_hba.conf  (TYPE  DATABASE  USER  ADDRESS  METHOD)\nhostssl  ${m.database ? maskSecrets(m.database) : 'all'}  ${maskSecrets(m.user)}  ${/^[\d.]+$/.test(m.host) ? `${m.host}/32` : '<client-address>/32'}  scram-sha-256\n# then: SELECT pg_reload_conf();` });
      return {
        title: `no pg_hba.conf entry for host "${maskSecrets(m.host)}"${m.encryption ? `, ${m.encryption}` : ''}`,
        cause: `The server was reached, but no line of its pg_hba.conf matches this connection (client ${maskSecrets(m.host)}, user "${maskSecrets(m.user)}"${m.database ? `, database "${maskSecrets(m.database)}"` : ''}${m.encryption ? `, ${m.encryption}` : ''}).`,
        why: 'This is what you get when you succeed in contacting the server but it does not want to talk to you: it found no matching entry in pg_hba.conf. Each line matches on connection type (host, hostssl, hostnossl), database, user and client address — the last part of the message tells you whether the attempt used encryption.',
        fixes,
        source: SOURCES.pgAuthProblems,
        extraSources: [SOURCES.pgHba, SOURCES.pgSourceHba, ...(plain ? [SOURCES.nodePgSsl] : [])],
      };
    },
  },

  // "sorry, too many clients already" (proc.c) / "remaining connection slots
  // are reserved for …" (postinit.c, all wordings). runtime-config-connection:
  // max_connections, superuser_reserved_connections, reserved_connections.
  {
    id: 'db.too-many-connections',
    severity: 'critical',
    test: (c) => {
      if (/sorry, too many clients already/.test(c.text)) return { kind: 'full' };
      if (/remaining connection slots are reserved for/.test(c.text)) return { kind: 'reserved' };
      return null;
    },
    build: (c, m) => ({
      title: m.kind === 'full' ? '"sorry, too many clients already" — max_connections reached' : '"remaining connection slots are reserved" — only reserved slots are left',
      cause: m.kind === 'full'
        ? 'Every connection slot of the PostgreSQL server (max_connections) is in use, so the server refused a new one.'
        : 'The server is so close to max_connections that the only free slots are the ones reserved for superusers (superuser_reserved_connections) or for roles granted pg_use_reserved_connections (reserved_connections) — and your role is neither.',
      why: 'max_connections caps the number of concurrent connections to the server (typically 100 by default) and can only be changed at server start. Each client of a pool holds one of those connections: the sum of every pool\'s maximum, across every instance of every service, must fit under the cap.',
      fixes: [
        { title: 'See who holds the connections', detail: 'pg_stat_activity has one row per server process: group it to find the application or client address holding most of them.', code: 'SELECT usename, application_name, client_addr, state, count(*)\nFROM pg_stat_activity\nGROUP BY 1, 2, 3, 4\nORDER BY 5 DESC;' },
        { title: 'Create one pool per process and reuse it', detail: 'A pool created per request opens new connections each time. node-postgres\' Pool keeps up to max clients — 10 by default.', code: "// db.js — imported everywhere, created once\nimport pg from 'pg';\nexport const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });" },
        { title: 'Size pools across all instances', detail: 'node-postgres\' pool-sizing guide: add up max over all instances of all services, keep headroom for admin tools, and put a pooler (PgBouncer, RDS Proxy…) in front when instances scale automatically.', code: '' },
        { title: 'Raise max_connections only knowingly', detail: 'PostgreSQL sizes resources such as shared memory from max_connections, and the change needs a restart.', code: '' },
      ],
      source: SOURCES.pgConnSettings,
      extraSources: [m.kind === 'full' ? SOURCES.pgSourceTooMany : SOURCES.pgSourceReserved, SOURCES.pgStatActivity, SOURCES.nodePgPool, SOURCES.nodePgPoolSizing],
    }),
  },

  // SELF_SIGNED_CERT_IN_CHAIN / DEPTH_ZERO_SELF_SIGNED_CERT (tls.md). Fixes:
  // node-postgres ssl.ca (features/ssl), NODE_EXTRA_CA_CERTS (cli.md).
  {
    id: 'db.tls-self-signed',
    severity: 'critical',
    test: (c) => {
      if (!c.signal) return null;
      if (/SELF_SIGNED_CERT_IN_CHAIN|self[- ]signed certificate in certificate chain/i.test(c.text)) return { code: 'SELF_SIGNED_CERT_IN_CHAIN' };
      if (/DEPTH_ZERO_SELF_SIGNED_CERT|\bself[- ]signed certificate\b/i.test(c.text)) return { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
      return null;
    },
    build: (c, m) => ({
      title: m.code === 'SELF_SIGNED_CERT_IN_CHAIN' ? 'self-signed certificate in certificate chain (TLS to the database)' : 'self-signed certificate (TLS to the database)',
      cause: m.code === 'SELF_SIGNED_CERT_IN_CHAIN'
        ? 'The database\'s TLS certificate chains up to a self-signed root that Node.js does not trust, so the TLS handshake was rejected.'
        : 'The database presented a self-signed certificate that Node.js does not trust, so the TLS handshake was rejected.',
      why: `Node.js verifies the server certificate against its list of trusted CAs unless rejectUnauthorized is false; the failure is reported with the OpenSSL code ${m.code}. The connection is fine — the client does not have the CA that signed the server's certificate.`,
      fixes: [
        { title: 'Give the client the server\'s CA certificate', detail: 'node-postgres passes its ssl object to the TLS socket: add ca. Download the CA from your provider, or use the root.crt of your own server. Keep sslmode / sslrootcert out of the connection string when you do this — node-postgres documents that they replace the ssl object.', code: "const pool = new Pool({\n  connectionString: process.env.DATABASE_URL, // no sslmode here\n  ssl: { ca: fs.readFileSync('/path/to/server-ca.crt').toString() },\n})" },
        { title: 'Or add the CA process-wide', detail: 'NODE_EXTRA_CA_CERTS extends Node.js\'s trusted root CAs with the certificates in a PEM file. It is only read when the process starts, and it is not used when a ca option is set explicitly.', code: 'NODE_EXTRA_CA_CERTS=/path/to/server-ca.crt node server.js' },
        { title: 'Not a fix: rejectUnauthorized: false', detail: 'It keeps the connection encrypted but accepts any certificate, so a man-in-the-middle can impersonate the database. Use the CA instead.', code: '' },
      ],
      source: SOURCES.tlsCodes,
      extraSources: [SOURCES.nodePgSsl, SOURCES.nodeExtraCaCerts],
    }),
  },

  // node-postgres: SSLRequest answered 'N' → "The server does not support SSL
  // connections" (connection.js). PostgreSQL: SSL is enabled with ssl = on.
  {
    id: 'db.server-no-ssl',
    severity: 'critical',
    test: (c) => (/The server does not support SSL connections/.test(c.text) ? {} : null),
    build: () => ({
      title: 'The server does not support SSL connections',
      cause: 'The client asked for SSL and the PostgreSQL server answered that it does not accept SSL connections.',
      why: 'node-postgres starts an SSL connection by sending an SSLRequest; this exact error is thrown when the server answers "N" (no SSL). A PostgreSQL server accepts SSL only when it was built with SSL support and started with ssl = on and a certificate.',
      fixes: [
        { title: 'Local / Docker database without SSL: do not request SSL', detail: 'Remove the ssl option (and any sslmode in the connection string — database-url-doctor explains how sslmode is read) for this server only. Keep SSL for anything reached over a network you do not control.', code: "const pool = new Pool({ connectionString: process.env.DATABASE_URL }) // no ssl for the local dev server" },
        { title: 'Or enable SSL on the server (if you run it)', detail: 'Set ssl = on in postgresql.conf with server.crt / server.key in the data directory.', code: '# postgresql.conf\nssl = on\n# server.crt and server.key in the data directory' },
      ],
      source: SOURCES.nodePgNoSsl,
      extraSources: [SOURCES.pgSsl],
    }),
  },
];

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * Explain a "can't connect to the database" error from a Node.js app.
 * @param {string | { error?: string, postgres?: boolean }} input
 *   the pasted error text, or an object; `postgres: true` asserts the error
 *   comes from a PostgreSQL connection (enables the generic network / TLS codes
 *   when the text itself carries no Postgres signal).
 */
export function explain(input = {}) {
  const opts = typeof input === 'string' ? { error: input } : (input || {});
  const text = typeof opts.error === 'string' ? opts.error.slice(0, 50000) : '';
  if (!text.trim()) {
    return { recognised: false, findings: [], related: [], context: { postgresSignal: null }, notes: ['Paste the error text (the whole stack trace is fine).'] };
  }
  const signal = postgresSignal(text, { postgres: opts.postgres === true });
  const ctx = { text, signal };
  const findings = [];
  for (const rule of RULE_IMPL) {
    const match = rule.test(ctx);
    if (!match) continue;
    const f = rule.build(ctx, match);
    findings.push({
      id: rule.id,
      severity: rule.severity,
      title: f.title,
      cause: f.cause,
      why: f.why,
      fixes: f.fixes.map((x) => ({ title: x.title, detail: x.detail, code: maskSecrets(x.code) })),
      source: f.source,
      ...(f.extraSources ? { extraSources: f.extraSources } : {}),
    });
  }
  const notes = [];
  if (!findings.length) {
    const generic = /\bconnect (?:ECONNREFUSED|ETIMEDOUT)\b|getaddrinfo (?:ENOTFOUND|EAI_AGAIN)\b|SELF_SIGNED_CERT_IN_CHAIN|self[- ]signed certificate/i.test(text);
    notes.push(generic && !signal
      ? 'Not recognised as a PostgreSQL connection error: this network / TLS code is printed by every Node.js client (HTTP, Redis, MySQL, npm…) and nothing in the text ties it to PostgreSQL. If it is, call explain({ error, postgres: true }).'
      : 'Not recognised: no PostgreSQL / Prisma connection error this module knows was found in the text.');
  }
  return {
    recognised: findings.length > 0,
    findings,
    related: relatedModules(text),
    context: { postgresSignal: signal },
    notes,
  };
}
