/**
 * database-url-doctor — every rule has a case that must fire and a case that
 * must NOT fire. Inputs are the real shapes developers paste: the Stack
 * Overflow "invalid port number" URL, the Supabase docs templates, and the
 * example strings from the host guide.
 */

import { describe, it, expect } from '@jest/globals';
import {
  diagnose,
  correctedWithPassword,
  parseConnectionString,
  findUnencodedChars,
  normaliseInput,
  RULES,
  SOURCES,
} from '../src/database-url-doctor.js';

const ids = (r) => r.findings.map((f) => f.id);

describe('parseConnectionString', () => {
  it('parses a password containing @ and # the way the author meant (SO 63684133 shape)', () => {
    const p = parseConnectionString('postgresql://postgres:p@ss#word@localhost:5432/linker');
    expect(p.ok).toBe(true);
    expect(p.user).toBe('postgres');
    expect(p.rawPassword).toBe('p@ss#word');
    expect(p.host).toBe('localhost');
    expect(p.port).toBe(5432);
    expect(p.database).toBe('linker');
  });

  it('accepts both postgres:// and postgresql://, IPv6 literals and query params', () => {
    const p = parseConnectionString('postgres://u:pw@[::1]:6543/db?sslmode=require&pgbouncer=true');
    expect(p.scheme).toBe('postgres');
    expect(p.host).toBe('[::1]');
    expect(p.hostIsIpv6).toBe(true);
    expect(p.port).toBe(6543);
    expect(p.params).toEqual([{ key: 'sslmode', value: 'require' }, { key: 'pgbouncer', value: 'true' }]);
  });

  it('accepts a URL with no credentials (valid libpq)', () => {
    const p = parseConnectionString('postgresql://localhost/mydb');
    expect(p.ok).toBe(true);
    expect(p.user).toBeNull();
    expect(p.host).toBe('localhost');
    expect(p.port).toBeNull();
  });

  it('strips export, the variable name and quotes from a pasted .env line', () => {
    expect(normaliseInput('export DATABASE_URL="postgresql://a:b@h:5432/d"')).toBe('postgresql://a:b@h:5432/d');
    expect(normaliseInput("DIRECT_URL='postgresql://a:b@h/d'  # migrations")).toBe('postgresql://a:b@h/d');
  });
});

describe('findUnencodedChars (RFC 3986 userinfo)', () => {
  it('flags gen-delims, spaces and a bare %', () => {
    expect(findUnencodedChars('p@ss#w/rd?')).toEqual(['@', '#', '/', '?']);
    expect(findUnencodedChars('100% sure')).toEqual(['%', ' ']);
  });
  it('does not flag unreserved chars, sub-delims, ":" or valid %XX escapes', () => {
    expect(findUnencodedChars('my-pass_word.~1')).toEqual([]);
    expect(findUnencodedChars("a!$&'()*+,;=b")).toEqual([]);
    expect(findUnencodedChars('p%40ss%23word')).toEqual([]);
    expect(findUnencodedChars('with:colon')).toEqual([]);
  });
});

describe('encoding rule', () => {
  it('fires on the Stack Overflow shape and links the host article + RFC source', () => {
    const r = diagnose('postgresql://postgres:p@ss#word@localhost:5432/linker');
    const f = r.findings.find((x) => x.id === 'password-needs-encoding');
    expect(f).toBeDefined();
    expect(f.severity).toBe('critical');
    expect(f.source).toBe(SOURCES.rfc3986);
    expect(f.link.href).toBe('/post/prisma-cant-connect-to-postgresql');
  });

  it('does NOT fire on unreserved characters or an already-encoded password', () => {
    expect(ids(diagnose('postgresql://user:my-pass_word.~1@db.example.com:5432/app'))).not.toContain('password-needs-encoding');
    expect(ids(diagnose('postgresql://user:p%40ss@db.example.com:5432/app'))).not.toContain('password-needs-encoding');
  });

  it('never double-encodes an already-encoded password in the copy string', () => {
    const [c] = correctedWithPassword('postgresql://user:p%40ss@db.example.com:5432/app');
    expect(c.value).toBe('postgresql://user:p%40ss@db.example.com:5432/app');
  });

  it('encodes the real password only in correctedWithPassword', () => {
    const [c] = correctedWithPassword('postgresql://postgres:p@ss#word@localhost:5432/linker');
    expect(c.value).toBe('postgresql://postgres:p%40ss%23word@localhost:5432/linker');
  });
});

describe('masking', () => {
  it('never leaks the raw or encoded password anywhere in the diagnosis', () => {
    const secrets = ['Sup3r@Secret#Pw', encodeURIComponent('Sup3r@Secret#Pw')];
    for (const client of ['prisma', 'drizzle', 'pg', 'psql']) {
      for (const forMigrations of [false, true]) {
        const r = diagnose(
          'postgresql://postgres.abcdefghijklmnopqrst:Sup3r@Secret#Pw@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require',
          { client, forMigrations },
        );
        const json = JSON.stringify(r);
        for (const s of secrets) expect(json).not.toContain(s);
      }
    }
  });

  it('masks password query parameters too', () => {
    const r = diagnose('postgresql://db.example.com:5432/app?user=me&password=hunter2');
    expect(JSON.stringify(r)).not.toContain('hunter2');
  });
});

describe('Supabase rules', () => {
  it('flags the host guide example: postgres.<ref> on the direct host (placeholders left in)', () => {
    const r = diagnose('DIRECT_URL="postgresql://postgres.[project-ref]:[password]@db.[project-ref].supabase.co:5432/postgres"');
    expect(ids(r)).toEqual(expect.arrayContaining(['placeholder-left', 'direct-username']));
    expect(ids(r)).not.toContain('password-needs-encoding');
  });

  it('flags the direct-host username with a real ref', () => {
    const r = diagnose('postgresql://postgres.abcdefghijklmnopqrst:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres');
    expect(ids(r)).toContain('direct-username');
    expect(r.corrected[0].value).toContain('postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghijklmnopqrst.supabase.co:5432/');
  });

  it('pooler with bare "postgres" user → Tenant or user not found', () => {
    const r = diagnose('postgres://postgres:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres');
    const f = r.findings.find((x) => x.id === 'pooler-username');
    expect(f.severity).toBe('critical');
    expect(f.body).toContain('Tenant or user not found');
    expect(f.source).toBe(SOURCES.supabaseTenant);
  });

  it('does NOT flag a correct pooler username (including a custom role)', () => {
    expect(ids(diagnose('postgres://postgres.abcdefghij:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres'))).not.toContain('pooler-username');
    expect(ids(diagnose('postgres://prisma.abcdefghij:pw@aws-1-us-east-2.pooler.supabase.com:5432/postgres'))).not.toContain('pooler-username');
  });

  it('never invents a pooler host: direct → IPv6 advice uses [POOLER-HOST]', () => {
    const r = diagnose('postgresql://postgres:pw@db.abcdefghij.supabase.co:5432/postgres');
    const f = r.findings.find((x) => x.id === 'direct-ipv6');
    expect(f.fix).toContain('[POOLER-HOST]');
    expect(JSON.stringify(r)).not.toMatch(/aws-0-/);
  });

  it('recognises the Supabase API URL pasted instead of a database URL', () => {
    expect(ids(diagnose('https://abcdefghij.supabase.co'))).toEqual(['supabase-api-host']);
    expect(ids(diagnose('postgresql://postgres:pw@abcdefghij.supabase.co:5432/postgres'))).toContain('supabase-api-host');
  });

  it('warns about sslmode=disable on Supabase but not on a local database', () => {
    expect(ids(diagnose('postgresql://postgres:pw@db.abcdefghij.supabase.co:5432/postgres?sslmode=disable'))).toContain('sslmode-disable-supabase');
    expect(ids(diagnose('postgresql://postgres:pw@localhost:5432/app?sslmode=disable'))).not.toContain('sslmode-disable-supabase');
  });
});

describe('transaction mode × client', () => {
  const tx = 'postgres://postgres.abcdefghij:pw@aws-1-eu-west-2.pooler.supabase.com:6543/postgres';
  const session = 'postgres://postgres.abcdefghij:pw@aws-1-eu-west-2.pooler.supabase.com:5432/postgres';

  it('Prisma on 6543 without pgbouncer=true → warning, and the fix adds it', () => {
    const r = diagnose(tx, { client: 'prisma' });
    expect(ids(r)).toContain('prisma-pgbouncer-missing');
    expect(r.corrected[0].value).toContain('pgbouncer=true');
  });

  it('Prisma on 6543 WITH pgbouncer=true, and Prisma on 5432 session mode → no pgbouncer warning', () => {
    expect(ids(diagnose(`${tx}?pgbouncer=true`, { client: 'prisma' }))).not.toContain('prisma-pgbouncer-missing');
    expect(ids(diagnose(session, { client: 'prisma' }))).not.toContain('prisma-pgbouncer-missing');
  });

  it('Drizzle: prepare:false on 6543 only', () => {
    expect(ids(diagnose(tx, { client: 'drizzle' }))).toContain('drizzle-prepare-false');
    expect(ids(diagnose(session, { client: 'drizzle' }))).not.toContain('drizzle-prepare-false');
  });

  it('pg on 6543: named-query advice, never "prepare: false"', () => {
    const r = diagnose(tx, { client: 'pg' });
    expect(ids(r)).toContain('pg-named-queries');
    expect(JSON.stringify(r)).not.toMatch(/prepare:\s*false/);
  });

  it('dedicated pooler (db.<ref>:6543) is transaction mode too', () => {
    const r = diagnose('postgresql://postgres:pw@db.abcdefghij.supabase.co:6543/postgres', { client: 'prisma' });
    expect(r.kind).toBe('dedicated-pooler');
    expect(ids(r)).toContain('prisma-pgbouncer-missing');
  });

  it('migrations through 6543 → critical, and Prisma gets DATABASE_URL + DIRECT_URL (session 5432)', () => {
    const r = diagnose(tx, { client: 'prisma', forMigrations: true });
    const f = r.findings.find((x) => x.id === 'migrations-through-transaction-pooler');
    expect(f.severity).toBe('critical');
    expect(f.fix).toContain('prisma.config.ts');
    expect(r.corrected.map((c) => c.name)).toEqual(['DATABASE_URL', 'DIRECT_URL']);
    expect(r.corrected[1].value).toContain('aws-1-eu-west-2.pooler.supabase.com:5432/postgres');
    expect(r.corrected[1].value).not.toContain('pgbouncer');
  });

  it('no migration finding when the box is unticked and the client is an app driver', () => {
    expect(ids(diagnose(tx, { client: 'drizzle' }))).not.toContain('migrations-through-transaction-pooler');
  });
});

describe('sslmode and node-postgres', () => {
  it('pg + sslmode=require on Supabase explains full verification and drops sslmode from the fix', () => {
    const r = diagnose('postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres?sslmode=require', { client: 'pg' });
    expect(ids(r)).toContain('pg-sslmode-verifies');
    expect(r.corrected[0].value).not.toContain('sslmode');
  });

  it('flags an invalid sslmode, but accepts no-verify for pg only', () => {
    expect(ids(diagnose('postgresql://u:p@db.example.com:5432/app?sslmode=on'))).toContain('sslmode-invalid');
    expect(ids(diagnose('postgresql://u:p@db.example.com:5432/app?sslmode=no-verify', { client: 'pg' }))).not.toContain('sslmode-invalid');
    expect(ids(diagnose('postgresql://u:p@db.example.com:5432/app?sslmode=no-verify', { client: 'prisma' }))).toContain('sslmode-invalid');
  });
});

describe('generic Postgres checks', () => {
  it('missing database name and port', () => {
    const r = diagnose('postgresql://app:pw@db.example.com');
    expect(ids(r)).toEqual(expect.arrayContaining(['missing-database', 'missing-port']));
  });

  it('a clean, fully specified non-Supabase URL produces no findings', () => {
    expect(diagnose('postgresql://app:my-pass_word.~1@db.example.com:5432/app?sslmode=verify-full').findings).toEqual([]);
  });

  it('localhost is an info, not an error', () => {
    const f = diagnose('postgresql://postgres:pw@127.0.0.1:5432/app').findings.find((x) => x.id === 'localhost');
    expect(f.severity).toBe('info');
  });

  it('"$" in the password warns about Next.js .env expansion', () => {
    expect(ids(diagnose('postgresql://u:pa$word@db.example.com:5432/app'))).toContain('dollar-in-password');
    expect(ids(diagnose('postgresql://u:password@db.example.com:5432/app'))).not.toContain('dollar-in-password');
  });

  it('non-numeric port is reported without echoing it', () => {
    const r = diagnose('postgresql://u:pw@db.example.com:54x2/app');
    expect(ids(r)).toContain('invalid-port');
  });
});

describe('pasted .env files', () => {
  it('diagnoses the DATABASE_URL line, not the Supabase API URL above it', () => {
    const env = [
      'NEXT_PUBLIC_SUPABASE_URL=https://abcdefghij.supabase.co',
      'DATABASE_URL="postgres://postgres.abcdefghij:pw@aws-1-eu-west-2.pooler.supabase.com:6543/postgres"',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiJ9.x.y',
    ].join('\n');
    const r = diagnose(env, { client: 'prisma' });
    expect(r.kind).toBe('shared-transaction');
    expect(ids(r)).not.toContain('supabase-api-host');
    expect(ids(r)).toContain('prisma-pgbouncer-missing');
  });
});

describe('each remaining rule fires on its trigger', () => {
  const POOL = 'aws-1-eu-west-2.pooler.supabase.com';
  it.each([
    [`postgres://postgres.abcdefghij:pw@${POOL}:5432/postgres?pgbouncer=true`, { client: 'prisma' }, 'prisma-pgbouncer-unneeded'],
    [`postgres://postgres.abcdefghij:pw@${POOL}:6543/postgres?pgbouncer=true`, { client: 'drizzle' }, 'pgbouncer-param-wrong-client'],
    ['postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres?sslmode=require', { client: 'prisma', forMigrations: true }, 'prisma-migrations-url'],
    [`postgres://postgres.abcdefghij:pw@${POOL}/postgres`, { client: 'prisma' }, 'pooler-port'],
    [`postgres://postgres.abcdefghij:pw@${POOL}:6000/postgres`, { client: 'prisma' }, 'pooler-port'],
    ['postgresql://db.example.com:5432/app', {}, 'missing-user'],
    ['postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres', { client: 'prisma' }, 'sslmode-missing-supabase'],
    ['postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres', { client: 'pg' }, 'sslmode-missing-supabase'],
  ])('%s %p → %s', (input, options, expected) => {
    expect(ids(diagnose(input, options))).toContain(expected);
  });

  it('psql through 6543 without the migrations box is a warning, not critical', () => {
    const r = diagnose(`postgres://postgres.abcdefghij:pw@${POOL}:6543/postgres`, { client: 'psql' });
    expect(r.findings.find((f) => f.id === 'migrations-through-transaction-pooler').severity).toBe('warning');
    expect(r.corrected[0].value).toContain(':5432/postgres');
  });

  it('a pooler URL on 5432 does not raise pooler-port', () => {
    expect(ids(diagnose(`postgres://postgres.abcdefghij:pw@${POOL}:5432/postgres`))).not.toContain('pooler-port');
  });
});

describe('garbage input', () => {
  it.each([[''], ['   '], ['hello'], ['mysql://root:pw@localhost:3306/db'], [null], [undefined], [42], ['postgresql://'], ['postgres://@:/?&=']])(
    'does not throw on %p',
    (input) => {
      const r = diagnose(input);
      expect(Array.isArray(r.findings)).toBe(true);
      expect(Array.isArray(r.corrected)).toBe(true);
    },
  );

  it('explains the wrong scheme', () => {
    expect(ids(diagnose('mysql://root:pw@localhost:3306/db'))).toEqual(['wrong-scheme']);
  });
});

describe('every finding carries a primary source', () => {
  it('source is an https URL on every finding and every RULES entry', () => {
    const inputs = [
      'postgresql://postgres:p@ss#word@localhost:5432/linker',
      'postgres://postgres:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres?sslmode=bogus&pgbouncer=true',
      'postgresql://postgres:pa$s@db.abcdefghij.supabase.co:5432?sslmode=disable',
    ];
    for (const client of ['prisma', 'drizzle', 'pg', 'psql']) {
      for (const input of inputs) {
        for (const f of diagnose(input, { client, forMigrations: true }).findings) {
          expect(f.source).toMatch(/^https:\/\//);
        }
      }
    }
    for (const rule of RULES) expect(rule.source).toMatch(/^https:\/\//);
  });
});

describe('review regressions (2026-09-25)', () => {
  const leaks = (out, secret) => {
    const json = JSON.stringify(out);
    return json.includes(secret) || json.toLowerCase().includes(secret.toLowerCase());
  };

  it.each([
    ['DATABASE_URL=postgresql://postgres:S3cretPw@localhost:5432 # dev db', 'S3cretPw'],
    ['postgresql://postgres:S3cretPw@db.abcdefghijklmnopqrst.supabase.co:5432#', 'S3cretPw'],
    ['postgresql://postgres:S3cretPw@db host.example.com:5432/app', 'S3cretPw'],
    ['postgresql://app:S3cretPw@db.example.com:5432/app?application_name=me@work', 'S3cretPw'],
  ])('never echoes the password, any case: %s', (input, secret) => {
    for (const client of ['prisma', 'drizzle', 'pg', 'psql']) {
      for (const forMigrations of [false, true]) {
        expect(leaks(diagnose(input, { client, forMigrations }), secret)).toBe(false);
      }
    }
  });

  it('strips an unquoted inline .env comment and parses the URL normally', () => {
    expect(normaliseInput('DATABASE_URL=postgresql://postgres:pw@localhost:5432 # dev db')).toBe('postgresql://postgres:pw@localhost:5432');
    const r = diagnose('DATABASE_URL=postgresql://postgres:pw@localhost:5432 # dev db', { client: 'prisma' });
    const host = r.components.find((c) => c.label === 'Host').value;
    expect(host).toBe('localhost');
    expect(ids(r)).not.toContain('invalid-port');
    expect(ids(r)).not.toContain('missing-user');
  });

  it('a "#" fragment right after the port ends the authority (RFC 3986 §3.2)', () => {
    const p = parseConnectionString('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432#');
    expect(p.host).toBe('db.abcdefghijklmnopqrst.supabase.co');
    expect(p.port).toBe(5432);
    expect(p.user).toBe('postgres');
  });

  it('whitespace inside the host is reported, with the split still made at the "@"', () => {
    const r = diagnose('postgresql://postgres:pw@db host.example.com:5432/app', { client: 'pg' });
    expect(ids(r)).toContain('host-invalid');
    expect(r.components.find((c) => c.label === 'User').value).toBe('postgres');
  });

  it('an "@" in a query value does not hijack the host split', () => {
    for (const input of [
      'postgresql://app:pw@db.example.com:5432/app?application_name=me@work',
      'postgresql://u:pw@host.example.com:5432/db?application_name=a@b.example.com',
    ]) {
      const r = diagnose(input, { client: 'pg' });
      const p = parseConnectionString(input);
      expect(p.host).toMatch(/example\.com$/);
      expect(p.host).not.toMatch(/^b\./);
      expect(p.port).toBe(5432);
      expect(p.database).toMatch(/^(app|db)$/);
      expect(ids(r)).not.toContain('password-needs-encoding');
      expect(ids(r)).not.toContain('missing-database');
    }
  });

  it('still picks the last "@" for unencoded "@" / "?" / "/" in the password', () => {
    expect(parseConnectionString('postgresql://u:p@ss?x@host.example.com:5432/db').host).toBe('host.example.com');
    expect(parseConnectionString('postgresql://u:p@ss/x@db.example.com:5432/db').rawPassword).toBe('p@ss/x');
  });

  it('warns about IPv6 on the dedicated pooler (db.<ref>:6543), pointing at the shared pooler on 6543', () => {
    for (const client of ['prisma', 'drizzle']) {
      const r = diagnose('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:6543/postgres', { client });
      const f = r.findings.find((x) => x.id === 'direct-ipv6');
      expect(f).toBeDefined();
      expect(f.severity).toBe('warning');
      expect(f.fix).toContain(':6543/postgres');
      expect(f.fix).toContain('[POOLER-HOST]');
    }
    expect(ids(diagnose('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres'))).not.toContain('direct-ipv6');
  });

  it('pg + sslmode=no-verify: warns that verification is OFF, never claims full verification', () => {
    const r = diagnose('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=no-verify', { client: 'pg' });
    expect(ids(r)).toContain('pg-sslmode-no-verify');
    expect(ids(r)).not.toContain('pg-sslmode-verifies');
    expect(r.findings.find((f) => f.id === 'pg-sslmode-no-verify').severity).toBe('warning');
  });

  it('Prisma on Supabase: never injects sslmode=require, and explains the Prisma 7 adapter-pg mapping', () => {
    const r = diagnose('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres', { client: 'prisma' });
    expect(r.corrected[0].value).not.toContain('sslmode');
    expect(r.corrected[0].value).toContain('pgbouncer=true');
    const f = r.findings.find((x) => x.id === 'sslmode-missing-supabase');
    expect(f.fix).toContain('PrismaPg');
    expect(f.source).toBe(SOURCES.prisma7);
    const withRequire = diagnose('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true', { client: 'prisma' });
    expect(ids(withRequire)).toContain('prisma7-sslmode');
    // Other clients keep the require recommendation.
    expect(diagnose('postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres', { client: 'drizzle' }).corrected[0].value).toContain('sslmode=require');
  });

  it('caps parameter rows in the components table', () => {
    const q = Array.from({ length: 120 }, (_, i) => `options=o${i}`).join('&');
    const r = diagnose(`postgresql://u:pw@db.example.com:5432/app?${q}`, { client: 'pg' });
    const paramRows = r.components.filter((c) => c.label.startsWith('?'));
    expect(paramRows.length).toBe(51);
    expect(paramRows[paramRows.length - 1].value).toContain('+70 more');
  });
});
