import {
  explain,
  postgresSignal,
  SOURCES,
  RULES,
  RULE_IDS,
} from '../src/database-connection-explainer.js';

const ids = (r) => r.findings.map((f) => f.id);
const text = (r) => JSON.stringify(r);

// ─── Error strings ──────────────────────────────────────────────────────────
// Each constant is labelled:
//   [verbatim]    copied character for character from the URL above it
//                 (fetched 2026-09-30; markdown quote markers "> " removed),
//   [placeholder] verbatim, including the <redacted> placeholders its author used,
//   [synthetic]   built for the test — never counted as a real-string test.

// [verbatim] https://github.com/brianc/node-postgres/issues/2643 (Node v17.0.1)
const NODE17_V6 = `node:internal/process/promises:246
          triggerUncaughtException(err, true /* fromPromise */);
          ^

Error: connect ECONNREFUSED ::1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1161:16) {
  errno: -4078,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '::1',
  port: 5432
}

Node.js v17.0.1`;

// [verbatim] https://github.com/openlaunch-org/Open-Launch/issues/26
const AGGREGATE_BOTH = `applying migrations...AggregateError [ECONNREFUSED]:
    at /Users/igorstojanov/code/other/Open-Launch/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async PgDialect.migrate (Open-Launch/node_modules/src/pg-core/dialect.ts:85:3)
    at async migrate (Open-Launch/node_modules/src/node-postgres/migrator.ts:10:2) {
  code: 'ECONNREFUSED',
  [errors]: [
    Error: connect ECONNREFUSED ::1:5432
        at createConnectionError (node:net:1746:14)
        at afterConnectMultiple (node:net:1776:16) {
      errno: -61,
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '::1',
      port: 5432
    },
    Error: connect ECONNREFUSED 127.0.0.1:5432
        at createConnectionError (node:net:1746:14)
        at afterConnectMultiple (node:net:1776:16) {
      errno: -61,
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: '127.0.0.1',
      port: 5432
    }
  ]
} `;

// [verbatim] https://github.com/misskey-dev/misskey/issues/11111
const V4_MISSKEY = `Error during migration run:
Error: connect ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1494:16) {
  errno: -111,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 5432
}`;

// [verbatim] https://github.com/snowkidind/txTheRipper/issues/4
const V4_TXRIPPER = `Error: connect ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1159:16)2023-08-18 06:56:15 Database Error:pauseStatus`;

// [verbatim] https://github.com/brianc/node-postgres/issues/2600 (a JSON log line; \n is literal)
const ETIMEDOUT = String.raw`{"name":"testservice.query","hostname":"testserver","pid":27329,"level":50,"tid":"1001","msg":"query exception: Error: connect ETIMEDOUT 192.168.5.90:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1144:16)\n    at TCPConnectWrap.callbackTrampoline (internal/async_hooks.js:126:14) {\n  errno: 'ETIMEDOUT',\n  code: 'ETIMEDOUT',\n  syscall: 'connect',\n  address: '192.168.5.90',\n  port: 5432\n}","time":"2021-08-23T09:11:39.798Z","v":0}`;

// [verbatim] https://github.com/bookorbit/bookorbit/issues/1361
const ENOTFOUND_BOOKORBIT = `Error: getaddrinfo ENOTFOUND postgres
    at /app/node_modules/.pnpm/pg-pool@3.14.0_pg@8.23.0/node_modules/pg-pool/index.js:45:11
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
    at async installPostgresExtensions (/app/dist/scripts/postgres-extensions.js:12:5)`;

// [verbatim] https://github.com/iam4x/bobarr/issues/278 (JSON; \n is literal)
const ENOTFOUND_BOBARR = String.raw`{"stack":["Error: getaddrinfo ENOTFOUND postgres\n    at GetAddrInfoReqWrap.onlookup [as oncomplete] (dns.js:71:26)"]}`;

// [verbatim] https://github.com/DefiLlama/dimension-adapters/issues/9015
const EAI_AGAIN_DEFILLAMA = '{"error":{"message":"getaddrinfo EAI_AGAIN postgres","stack":null}}';
// [verbatim] https://github.com/Speqq-Demo/umami/issues/4
const EAI_AGAIN_UMAMI = 'getaddrinfo EAI_AGAIN postgres';

// [verbatim] https://github.com/vladwulf/nestjs-api-tutorial/issues/6
const P1001_VLADWULF = "Error: P1001: Can't reach database server at `localhost`:`5432`";
// [verbatim] https://github.com/acapela000/Daily-Running-Challenge/issues/2
const P1001_ACAPELA = "Error: P1001\n\nCan't reach database server at `localhost:51214`\n\nPlease make sure your database server is running at `localhost:51214`.";
// [verbatim] https://github.com/crocofied/PortNote/issues/5
const P1001_PORTNOTE = "Error: P1001: Can't reach database server at `db:5432`";
// [verbatim] https://github.com/prisma/orm/issues/14013
const P1001_PRISMA14013 = "Error: P1001: Can't reach database server at `postgres`:`5432`";
// [verbatim] https://github.com/planetscale/connection-examples/issues/16 (MySQL)
const P1001_PLANETSCALE = "Error: P1001: Can't reach database server at `aws.connect.psdb.cloud`:`3306`";
// [verbatim] https://github.com/prisma/orm/issues/25696 (CockroachDB)
const P1001_COCKROACH = "Error: P1001: Can't reach database server at `cluster-url.cloud`:`26257`";

// [verbatim] https://github.com/Eng-Elias/CrewAI-Visualizer/issues/11
const P1000_CREWAI = 'Error: P1000: Authentication failed against database server at `localhost`, the provided database credentials for `postgres` are not valid.';
// [verbatim] https://github.com/Hendrixer/fullstack-music/issues/8
const P1000_HENDRIXER = 'Error: P1000: Authentication failed against database server';
// [verbatim] https://github.com/linkwarden/linkwarden/issues/946
const P1000_LINKWARDEN = 'linkwarden-linkwarden-1  | Error: P1000: Authentication failed against database server at `postgres`, the provided database credentials for `postgres` are not valid.';
// [verbatim] https://github.com/Peppermint-Lab/peppermint/issues/455
const P1000_PEPPERMINT = 'Error: P1000: Authentication failed against database server at `peppermint_postgres`, the provided database credentials for `peppermint` are not valid.\nPlease make sure to provide valid database credentials for the database server at `peppermint_postgres`.';

// [verbatim] https://github.com/prisma/orm/issues/30021
const P1017_30021 = 'Error: P1017: Server has closed the connection.';
// [verbatim] https://github.com/prisma/orm/issues/24541
const P1017_24541 = 'Error: Error: P1017\n\nServer has closed the connection.';

// [verbatim] https://github.com/brianc/node-postgres/issues/2661
const PW_NODEPG = 'error: password authentication failed for user "someuser"';
// [verbatim] https://www.postgresql.org/docs/current/client-authentication-problems.html
const PW_DOCS = 'FATAL:  password authentication failed for user "andym"';

// [verbatim] PostgreSQL docs, Authentication Problems (no encryption suffix)
const HBA_DOCS = 'FATAL:  no pg_hba.conf entry for host "123.123.123.123", user "andym", database "testdb"';
// [placeholder] https://github.com/Rohithgilla12/data-peek/issues/252
const HBA_NO_ENC = 'no pg_hba.conf entry for host "<client-ip>", user "<user>", database "<database>", no encryption';
// [verbatim] https://github.com/sqlectron/sqlectron/issues/610 (older servers: "SSL off")
const HBA_SSL_OFF = 'no pg_hba.conf entry for host "86.168.251.42", user "fvmnrmgxxzmegd", database "d5i2rme5ks29f2", SSL off';
// [placeholder] https://github.com/microsoft/azuredatastudio-postgresql/issues/257 ("SSL on")
const HBA_SSL_ON = 'FATAL: no pg_hba.conf entry for host "XX.XXX.XXX.XX", user "TOTO", database "TOTO", SSL on ';

// [verbatim] https://github.com/ghostfolio/ghostfolio/issues/3700
const TOO_MANY = 'Too many database connections opened: FATAL: sorry, too many clients already';
// [verbatim] https://github.com/neondatabase/neon/issues/1983 (PostgreSQL <= 15 wording)
const RESERVED_NEON = 'Error: FATAL: remaining connection slots are reserved for non-replication superuser connections';
// [verbatim] https://github.com/gpodder/mygpo/issues/598 (two drivers, same server message)
const RESERVED_PSYCOPG = 'psycopg2cffi._impl.exceptions.OperationalError: remaining connection slots are reserved for non-replication superuser connections';
const RESERVED_DJANGO = 'django.db.utils.OperationalError: remaining connection slots are reserved for non-replication superuser connections';
// [verbatim] https://github.com/EdwardBetts/osm-wikidata/issues/703 (current wording)
const RESERVED_OSM = '2026-08-03 21:15:52  ERROR: Connecting to database failed (context=middle.query): connection to server at "localhost" (::1), port 5432 failed: FATAL:  remaining connection slots are reserved for roles with the SUPERUSER attribute';

// [verbatim] https://github.com/brianc/node-postgres/issues/2558
const SELF_SIGNED_2558 = `failed to connect to pg client Error: self signed certificate in certificate chain
    at TLSSocket.onConnectSecure (_tls_wrap.js:1507:34)
    at TLSSocket.emit (events.js:376:20)
    at TLSSocket._finishInit (_tls_wrap.js:932:8)
    at TLSWrap.ssl.onhandshakedone (_tls_wrap.js:706:12) {
  code: 'SELF_SIGNED_CERT_IN_CHAIN'
}`;
// [verbatim] https://github.com/brianc/node-postgres/issues/3355
const SELF_SIGNED_3355 = 'Error: self-signed certificate in certificate chain';

// [verbatim] https://github.com/dbos-inc/ttdbg-extension/issues/38
const NO_SSL_TITLE = 'Error: The server does not support SSL connections';
const NO_SSL_LOG = '2024-07-02 14:39:00 [error]: Debug mode error: The server does not support SSL connections ';

// ─── Tests on verbatim / placeholder strings ────────────────────────────────

describe('ECONNREFUSED', () => {
  test('Node 17 ::1-only refusal → IPv6 localhost finding', () => {
    const r = explain(NODE17_V6);
    expect(r.recognised).toBe(true);
    expect(ids(r)).toEqual(['db.econnrefused-ipv6-localhost']);
    expect(r.findings[0].title).toContain('::1:5432');
    expect(r.findings[0].fixes[0].code).toContain('127.0.0.1');
    expect(r.findings[0].source).toBe(SOURCES.dnsResultOrder);
  });

  test('AggregateError with both loopbacks → generic refusal, never the IPv6 advice', () => {
    const r = explain(AGGREGATE_BOTH);
    expect(ids(r)).toEqual(['db.econnrefused']);
    expect(r.findings[0].cause).toMatch(/not an IPv4\/IPv6 mix-up/);
    expect(r.context.postgresSignal).toBe('stack-frame');
  });

  test('127.0.0.1:5432 (misskey) → server not running + Docker localhost fix', () => {
    const r = explain(V4_MISSKEY);
    expect(ids(r)).toEqual(['db.econnrefused']);
    const titles = r.findings[0].fixes.map((x) => x.title).join('\n');
    expect(titles).toMatch(/Is PostgreSQL running/);
    expect(titles).toMatch(/container/);
    expect(r.context.postgresSignal).toBe('port');
  });

  test('127.0.0.1:5432 inside an app log line (txTheRipper)', () => {
    expect(ids(explain(V4_TXRIPPER))).toEqual(['db.econnrefused']);
  });
});

describe('ETIMEDOUT / ENOTFOUND / EAI_AGAIN', () => {
  test('connect ETIMEDOUT inside a JSON log line', () => {
    const r = explain(ETIMEDOUT);
    expect(ids(r)).toEqual(['db.etimedout']);
    expect(r.findings[0].title).toContain('192.168.5.90:5432');
    expect(r.findings[0].why).toMatch(/ECONNREFUSED/);
  });

  test('ENOTFOUND postgres with a pnpm pg-pool frame → Compose service-name advice', () => {
    const r = explain(ENOTFOUND_BOOKORBIT);
    expect(ids(r)).toEqual(['db.enotfound']);
    expect(r.findings[0].fixes.map((x) => x.title).join()).toMatch(/Compose service name/);
    expect(r.context.postgresSignal).toBe('stack-frame');
  });

  test('ENOTFOUND postgres in a JSON stack (host name is the only signal)', () => {
    const r = explain(ENOTFOUND_BOBARR);
    expect(ids(r)).toEqual(['db.enotfound']);
    expect(r.findings[0].title).toContain('ENOTFOUND postgres');
    expect(r.context.postgresSignal).toBe('host-name');
  });

  test('EAI_AGAIN postgres (JSON API error)', () => {
    const r = explain(EAI_AGAIN_DEFILLAMA);
    expect(ids(r)).toEqual(['db.eai-again']);
    expect(r.findings[0].source).toBe(SOURCES.libuvErrors);
  });

  test('EAI_AGAIN postgres (bare line)', () => {
    expect(ids(explain(EAI_AGAIN_UMAMI))).toEqual(['db.eai-again']);
  });
});

describe('Prisma', () => {
  test('P1001 `host`:`port` on localhost → container advice with the Postgres port', () => {
    const r = explain(P1001_VLADWULF);
    expect(ids(r)).toEqual(['db.prisma-p1001']);
    expect(r.findings[0].title).toContain('localhost:5432');
    expect(r.context.postgresSignal).toBe('port');
    expect(r.findings[0].fixes.map((x) => x.code).join()).toContain('postgresql://user:');
  });

  test('P1001 on its own line, `host:port` form, unknown database → neutral advice', () => {
    const r = explain(P1001_ACAPELA);
    expect(ids(r)).toEqual(['db.prisma-p1001']);
    expect(r.findings[0].title).toContain('localhost:51214');
    expect(text(r)).not.toMatch(/postgresql:\/\/|psql|PostgreSQL/);
  });

  test('P1001 on a Compose service name `db:5432`', () => {
    const r = explain(P1001_PORTNOTE);
    expect(r.findings[0].fixes.map((x) => x.title).join()).toMatch(/Compose service name/);
  });

  test('P1001 on `postgres`:`5432`', () => {
    const r = explain(P1001_PRISMA14013);
    expect(ids(r)).toEqual(['db.prisma-p1001']);
    expect(r.findings[0].fixes.map((x) => x.title).join()).toMatch(/Compose service name/);
  });

  test('P1001 from MySQL (PlanetScale, 3306) → no PostgreSQL advice at all', () => {
    const r = explain(P1001_PLANETSCALE);
    expect(ids(r)).toEqual(['db.prisma-p1001']);
    expect(r.context.postgresSignal).toBeNull();
    expect(text(r)).not.toMatch(/postgresql:\/\/|psql|PostgreSQL|listen_addresses/);
  });

  test('P1001 from CockroachDB (26257) → no PostgreSQL advice', () => {
    const r = explain(P1001_COCKROACH);
    expect(ids(r)).toEqual(['db.prisma-p1001']);
    expect(text(r)).not.toMatch(/postgresql:\/\/|psql|PostgreSQL/);
  });

  test('P1000 full message', () => {
    const r = explain(P1000_CREWAI);
    expect(ids(r)).toEqual(['db.prisma-p1000']);
    expect(r.findings[0].title).toContain('"postgres"');
  });

  test('P1000 first line only', () => {
    expect(ids(explain(P1000_HENDRIXER))).toEqual(['db.prisma-p1000']);
  });

  test('P1000 in a docker compose log (linkwarden)', () => {
    expect(ids(explain(P1000_LINKWARDEN))).toEqual(['db.prisma-p1000']);
  });

  test('P1000 two-line message (peppermint) — no Postgres signal → no psql', () => {
    const r = explain(P1000_PEPPERMINT);
    expect(r.findings[0].title).toContain('"peppermint"');
    expect(text(r)).not.toMatch(/psql/);
  });

  test('P1017 one-line form', () => {
    const r = explain(P1017_30021);
    expect(ids(r)).toEqual(['db.prisma-p1017']);
    expect(r.findings[0].why).toMatch(/does not say why/);
  });

  test('P1017 split over three lines (prisma migrate dev)', () => {
    expect(ids(explain(P1017_24541))).toEqual(['db.prisma-p1017']);
  });
});

describe('PostgreSQL server messages', () => {
  test('password authentication failed (node-postgres)', () => {
    const r = explain(PW_NODEPG);
    expect(ids(r)).toEqual(['db.password-auth-failed']);
    expect(r.findings[0].title).toContain('someuser');
    expect(r.findings[0].source).toBe(SOURCES.pgAuthProblems);
  });

  test('password authentication failed (docs example)', () => {
    expect(ids(explain(PW_DOCS))).toEqual(['db.password-auth-failed']);
  });

  test('pg_hba docs example → hostssl line with its caveat', () => {
    const r = explain(HBA_DOCS);
    expect(ids(r)).toEqual(['db.pg-hba-no-entry']);
    const fix = r.findings[0].fixes.find((x) => /pg_hba\.conf line/.test(x.title));
    expect(fix.code).toMatch(/^hostssl +testdb +andym +123\.123\.123\.123\/32 /m);
    expect(fix.detail).toMatch(/only matches connections made with SSL/);
  });

  test('pg_hba "no encryption" → enable SSL first, then a hostssl line (never host)', () => {
    const r = explain(HBA_NO_ENC);
    expect(r.findings[0].fixes[0].title).toMatch(/enable SSL/);
    expect(r.findings[0].fixes[1].code).toMatch(/^hostssl /m);
    expect(r.findings[0].fixes[1].code).not.toMatch(/^host /m);
  });

  test('pg_hba "SSL off" (older servers) → enable SSL first', () => {
    const r = explain(HBA_SSL_OFF);
    expect(r.findings[0].fixes[0].title).toMatch(/enable SSL/);
    expect(r.findings[0].fixes[1].code).toContain('86.168.251.42/32');
  });

  test('pg_hba "SSL on" → server-side line only, never "enable SSL"', () => {
    const r = explain(HBA_SSL_ON);
    const titles = r.findings[0].fixes.map((x) => x.title).join();
    expect(titles).not.toMatch(/enable SSL/);
    expect(r.findings[0].fixes[0].detail).toMatch(/SSL is already in use/);
    expect(r.findings[0].fixes[0].code).toContain('<client-address>/32');
  });

  test('sorry, too many clients already', () => {
    const r = explain(TOO_MANY);
    expect(ids(r)).toEqual(['db.too-many-connections']);
    expect(r.findings[0].extraSources).toContain(SOURCES.pgSourceTooMany);
  });

  test('remaining connection slots — PostgreSQL <= 15 wording (Neon)', () => {
    const r = explain(RESERVED_NEON);
    expect(ids(r)).toEqual(['db.too-many-connections']);
    expect(r.findings[0].extraSources).toContain(SOURCES.pgSourceReserved);
  });

  test('remaining connection slots — psycopg2 and Django wrappers', () => {
    expect(ids(explain(RESERVED_PSYCOPG))).toEqual(['db.too-many-connections']);
    expect(ids(explain(RESERVED_DJANGO))).toEqual(['db.too-many-connections']);
  });

  test('remaining connection slots — current SUPERUSER-attribute wording', () => {
    expect(ids(explain(RESERVED_OSM))).toEqual(['db.too-many-connections']);
  });
});

describe('TLS', () => {
  test('self signed certificate in certificate chain — gated: no Postgres signal in the snippet', () => {
    expect(explain(SELF_SIGNED_2558).recognised).toBe(false);
    const r = explain({ error: SELF_SIGNED_2558, postgres: true });
    expect(ids(r)).toEqual(['db.tls-self-signed']);
    expect(r.findings[0].fixes[0].code).toContain('ca:');
  });

  test('self-signed certificate in certificate chain (hyphenated), caller asserts Postgres', () => {
    const r = explain({ error: SELF_SIGNED_3355, postgres: true });
    expect(ids(r)).toEqual(['db.tls-self-signed']);
    expect(r.findings[0].fixes.map((x) => x.title).join()).toMatch(/Not a fix: rejectUnauthorized/);
    expect(r.findings[0].fixes[1].detail).toMatch(/not used when a ca option/);
  });

  test('The server does not support SSL connections (title and log line)', () => {
    const r = explain(NO_SSL_TITLE);
    expect(ids(r)).toEqual(['db.server-no-ssl']);
    expect(r.findings[0].extraSources).toContain(SOURCES.pgSsl);
    expect(ids(explain(NO_SSL_LOG))).toEqual(['db.server-no-ssl']);
  });
});

describe('contract', () => {
  test('every rule is exercised by a verbatim string; each finding has id, severity, source, fixes', () => {
    const all = [NODE17_V6, AGGREGATE_BOTH, ETIMEDOUT, ENOTFOUND_BOOKORBIT, EAI_AGAIN_UMAMI, P1001_VLADWULF, P1000_CREWAI, P1017_30021, PW_NODEPG, HBA_NO_ENC, TOO_MANY, NO_SSL_TITLE]
      .map((t) => explain(t))
      .concat(explain({ error: SELF_SIGNED_3355, postgres: true }))
      .flatMap((r) => r.findings);
    expect(new Set(all.map((f) => f.id)).size).toBe(RULE_IDS.length);
    for (const f of all) {
      expect(RULE_IDS).toContain(f.id);
      expect(['critical', 'warning', 'info']).toContain(f.severity);
      expect(f.source.url).toMatch(/^https:\/\//);
      expect(f.fixes.length).toBeGreaterThan(0);
    }
  });

  test('RULES catalogue lists every id once, each with a source', () => {
    expect(new Set(RULE_IDS).size).toBe(RULES.length);
    for (const r of RULES) expect(r.source.url).toMatch(/^https:\/\//);
  });
});

// ─── Synthetic tests (boundary, masking, caller flag) ───────────────────────

describe('boundary with database-url-doctor and masking [synthetic]', () => {
  test('a postgres URL in the input → related pointer, URL and password never echoed', () => {
    // Fake credential assembled at runtime; contains "@" on purpose.
    const secret = ['hunter', '2', '@', 'x', 'y', 'z'].join('');
    const url = 'postgresql://app:' + secret + '@db.example.com:5432/prod';
    const r = explain(`DATABASE_URL=${url}\n${V4_MISSKEY}`);
    expect(r.related).toEqual([expect.objectContaining({ module: 'database-url-doctor' })]);
    const out = text(r);
    expect(out).not.toContain('hunter');
    expect(out).not.toContain('xyz@');
    expect(out).not.toContain('postgresql://app');
  });

  test('a Supabase host points to database-url-doctor', () => {
    const r = explain('Error: getaddrinfo ENOTFOUND db.abcdefghijklmnop.supabase.co\n    at /app/node_modules/pg/lib/client.js:1:1');
    expect(ids(r)).toEqual(['db.enotfound']);
    expect(r.related[0].reasons[0]).toMatch(/Supabase/);
  });

  test('remote address → listen_addresses advice, no Docker advice', () => {
    const r = explain('Error: connect ECONNREFUSED 10.0.0.12:5432');
    const titles = r.findings[0].fixes.map((x) => x.title).join('\n');
    expect(titles).toMatch(/listen on this interface/);
    expect(titles).not.toMatch(/container/);
  });

  test('the caller can assert a Postgres context for a non-standard port', () => {
    const r = explain({ error: 'Error: connect ECONNREFUSED 127.0.0.1:15432', postgres: true });
    expect(ids(r)).toEqual(['db.econnrefused']);
    expect(r.context.postgresSignal).toBe('caller');
  });

  test('a MySQL Prisma P1001 next to a MySQL ECONNREFUSED never yields Postgres network advice', () => {
    const r = explain(`${P1001_PLANETSCALE}\nError: connect ECONNREFUSED 127.0.0.1:3306`);
    expect(ids(r)).toEqual(['db.prisma-p1001']);
    expect(text(r)).not.toMatch(/listen_addresses|PostgreSQL/);
  });
});

// ─── Near misses: must NOT be recognised ────────────────────────────────────

describe('not recognised', () => {
  const nearMisses = {
    // [verbatim] https://github.com/redis/ioredis/issues/1036 — Redis, same Node.js code.
    redis: 'Error: connect ECONNREFUSED 127.0.0.1:6379\n    at TCPConnectWrap.afterConnect [as oncomplete] (net.js:1129:14)',
    // [verbatim] https://github.com/sidorares/node-mysql2/issues/1245 — MySQL port.
    mysql: 'Error: connect ECONNREFUSED 127.0.0.1:3306',
    // [verbatim] https://github.com/Snipa22/nodejs-pool/issues/124 — MySQL server message.
    mysqlTooMany: ' ER_CON_COUNT_ERROR: Too many connections',
    // [verbatim] https://github.com/npm/cli/issues/2974 — npm behind a TLS-intercepting proxy.
    npmSelfSigned: 'npm ERR! code SELF_SIGNED_CERT_IN_CHAIN\nnpm ERR! errno SELF_SIGNED_CERT_IN_CHAIN\nnpm ERR! request to https://registry.npmjs.org/ansi-regex/-/ansi-regex-5.0.0.tgz failed, reason: self signed certificate in certificate chain',
    // [verbatim] https://github.com/maildev/maildev/issues/422 — read timeout on an established socket.
    readTimeout: "Error: read ETIMEDOUT\n    at TCP.onStreamRead (node:internal/stream_base_commons:217:20) {\n  errno: -110,\n  code: 'ETIMEDOUT',\n  syscall: 'read',\n  remote: '183.136.225.XXX'\n}",
    // [verbatim] https://github.com/node-fetch/node-fetch/issues/1540 — DNS failure of an HTTP API.
    httpEnotfound: 'FetchError: request to https://apilist.tronscan.org/api/token_trc20?contract=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t failed, reason: getaddrinfo ENOTFOUND apilist.tronscan.org',
    // [verbatim] PostgreSQL docs, Authentication Problems — out of this module's scope.
    dbMissing: 'FATAL:  database "testdb" does not exist',
    // [synthetic] the code mentioned in prose, without Prisma's message.
    prose: 'Why does Prisma sometimes throw P1001 on cold starts?',
    // [synthetic] another Prisma error code.
    prismaP2002: 'PrismaClientKnownRequestError: Unique constraint failed on the fields: (`email`) code: P2002',
    // [synthetic] unrelated text.
    unrelated: 'TypeError: Cannot read properties of undefined (reading "map")',
  };

  test.each(Object.entries(nearMisses))('%s', (_name, t) => {
    const r = explain(t);
    expect(r.recognised).toBe(false);
    expect(r.findings).toEqual([]);
    expect(r.notes[0]).toMatch(/^Not recognised/);
  });

  test('a generic network code says why it was not recognised', () => {
    expect(explain(nearMisses.redis).notes[0]).toMatch(/postgres: true/);
  });

  test('empty and non-string input', () => {
    for (const x of ['', '   ', undefined, null, { error: 42 }]) {
      const r = explain(x);
      expect(r.recognised).toBe(false);
      expect(r.findings).toEqual([]);
    }
  });

  test('postgresSignal is null for non-Postgres text', () => {
    expect(postgresSignal(nearMisses.redis)).toBeNull();
    expect(postgresSignal(nearMisses.npmSelfSigned)).toBeNull();
    expect(postgresSignal(P1001_PLANETSCALE)).toBeNull();
  });
});
