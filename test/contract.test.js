/**
 * contract — the normalised result every interface shares.
 *
 * Shape, stable ids, confidence, "unknown = no guess", options, redaction
 * before diagnosis (and the one documented exception), and drift checks that
 * fail when a module gains a finding the catalogue does not list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, diagnoseHeaders, RULES, FAMILIES, CONTRACT_VERSION } from '../src/contract.js';
import { redact } from '../src/redact.js';
import { diagnose as diagnoseCors } from '../src/cors-error-explainer.js';
import { RULE_IDS as ESM_RULE_IDS } from '../src/esm-cjs-explainer.js';
import { RULES as CHUNK_RULES, EXAMPLE_HTML, EXAMPLE_CHUNK } from '../src/chunk-cache-explainer.js';
import { RULES as BUILD_RULES, EXAMPLES as BUILD_EXAMPLES } from '../src/build-error-decoder.js';
import { EXAMPLE_LOG } from '../src/npm-eresolve-explainer.js';
import { RULE_IDS as DB_CONNECTION_RULE_IDS } from '../src/database-connection-explainer.js';
import { MODULES } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');
const rules = (family) => RULES.filter((r) => r.family === family).map((r) => r.rule.split('.').slice(1).join('.'));

function renderRuleTable() {
  const lines = [`${RULES.length} rules. Generated from \`RULES\` in \`src/contract.js\`; \`test/contract.test.js\` fails if this table differs from it.`, ''];
  for (const f of FAMILIES) {
    const rs = RULES.filter((r) => r.family === f);
    lines.push(`### ${f} (${rs.length}, module \`${rs[0].module}\`)`, '', '| rule | title | confidence |', '|---|---|---|');
    for (const r of rs) lines.push(`| \`${r.rule}\` | ${r.title.replace(/\|/g, '\\|').replace(/</g, '&lt;')} | ${r.confidence} |`);
    lines.push('');
  }
  return lines.join('\n');
}

const CORS = "Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.";
const ESM = 'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.';
const NEXT = BUILD_EXAMPLES.find((e) => e.id === 'module-not-found').output;
// [verbatim] https://github.com/misskey-dev/misskey/issues/11111 (same string as test/database-connection-explainer.test.js)
const DB_CONN = `Error during migration run:
Error: connect ECONNREFUSED 127.0.0.1:5432
    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1494:16) {
  errno: -111,
  code: 'ECONNREFUSED',
  syscall: 'connect',
  address: '127.0.0.1',
  port: 5432
}`;

// Distinctive fake secrets, assembled at runtime.
const SECRET = ['Zq', 'Secret', 'Pw', '9931'].join('');
const GH = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');

describe('result shape', () => {
  test('top level', () => {
    const r = diagnose(CORS);
    expect(Object.keys(r)).toEqual(['version', 'matched', 'redactions', 'results']);
    expect(r.version).toBe(CONTRACT_VERSION);
    expect(r.version).toBe('0.1');
    expect(r.matched).toBe(true);
  });

  test('every Diagnosis has the documented fields and types', () => {
    const texts = [CORS, ESM, EXAMPLE_LOG, EXAMPLE_HTML, 'postgres://postgres:pw@aws-1-us-east-2.pooler.supabase.com:6543/postgres', NEXT, DB_CONN];
    for (const t of texts) {
      for (const d of diagnose(t).results) {
        expect(FAMILIES).toContain(d.family);
        expect(d.rule.startsWith(`${d.family === 'esm-cjs' ? 'esm' : d.family}.`)).toBe(true);
        expect(typeof d.title).toBe('string');
        expect(d.title.length).toBeGreaterThan(0);
        expect(['critical', 'warning', 'info']).toContain(d.severity);
        expect(['high', 'medium']).toContain(d.confidence);
        expect(typeof d.cause).toBe('string');
        if ('why' in d) expect(typeof d.why).toBe('string');
        expect(Array.isArray(d.fixes)).toBe(true);
        for (const f of d.fixes) {
          expect(typeof f.title).toBe('string');
          if ('detail' in f) expect(typeof f.detail).toBe('string');
          if ('code' in f) expect(typeof f.code).toBe('string');
        }
        expect(Array.isArray(d.evidence)).toBe(true);
        for (const e of d.evidence) {
          expect(e.url).toMatch(/^https:\/\//);
          expect(typeof e.label).toBe('string');
        }
        expect(MODULES).toContain(d.module);
        const keys = Object.keys(d).filter((k) => k !== 'why');
        expect(keys).toEqual(['rule', 'family', 'title', 'severity', 'confidence', 'cause', 'fixes', 'evidence', 'module']);
      }
    }
  });

  test('results survive a JSON round trip unchanged (no RegExp, no undefined)', () => {
    for (const t of [CORS, ESM, EXAMPLE_LOG, EXAMPLE_HTML, NEXT, DB_CONN]) {
      const r = diagnose(t);
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });

  test('confidence and family come from the catalogue', () => {
    const byRule = new Map(RULES.map((x) => [x.rule, x]));
    for (const t of [CORS, ESM, EXAMPLE_LOG, EXAMPLE_HTML, NEXT, DB_CONN]) {
      for (const d of diagnose(t).results) {
        expect(byRule.get(d.rule)).toMatchObject({ family: d.family, confidence: d.confidence, module: d.module });
      }
    }
  });
});

describe('unknown input is never guessed', () => {
  test.each([
    ['hello world'],
    ['TypeError: Cannot read properties of undefined (reading "map")'],
    ['mysql://u:p@h/db'],
    ['Segmentation fault (core dumped)'],
    ['HTTP/2 200\ncontent-type: application/json'],
    ['npm error code E404'],
  ])('%s', (text) => {
    const r = diagnose(text);
    expect(r.matched).toBe(false);
    expect(r.results).toEqual([]);
  });

  test('empty and non-string input', () => {
    for (const x of ['', '   \n', undefined, null, 42, {}]) {
      expect(diagnose(x)).toEqual({ version: '0.1', matched: false, redactions: 0, results: [] });
    }
  });
});

describe('determinism and ordering', () => {
  test('same input → identical result', () => {
    const text = `${EXAMPLE_LOG}\n${NEXT}\n${ESM}`;
    expect(diagnose(text)).toEqual(diagnose(text));
  });

  test('results are ordered by severity, then family order', () => {
    const text = `${EXAMPLE_LOG}\n${NEXT}\nError: listen EADDRINUSE: address already in use :::3000`;
    const r = diagnose(text).results;
    const order = { critical: 0, warning: 1, info: 2 };
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1];
      const b = r[i];
      expect(order[a.severity] < order[b.severity]
        || (order[a.severity] === order[b.severity] && FAMILIES.indexOf(a.family) <= FAMILIES.indexOf(b.family))).toBe(true);
    }
  });

  test('a paste can match several families', () => {
    const fams = diagnose(`${EXAMPLE_LOG}\n${NEXT}`).results.map((d) => d.family);
    expect(fams).toEqual(expect.arrayContaining(['npm-eresolve', 'next-build']));
  });

  test('one Diagnosis per ERESOLVE report (rule ids may repeat)', () => {
    const r = diagnose(`${EXAMPLE_LOG}\n\n${EXAMPLE_LOG}`, { only: 'npm-eresolve' });
    expect(r.results.map((d) => d.rule)).toEqual(['npm-eresolve.conflict', 'npm-eresolve.conflict']);
  });

  test('ERESOLVE without a parsable report → the medium-confidence "unparsed" rule', () => {
    const r = diagnose('npm error code ERESOLVE\nnpm error something odd');
    expect(r.results.map((d) => [d.rule, d.confidence])).toEqual([['npm-eresolve.unparsed', 'medium']]);
  });
});

describe('options', () => {
  test('only restricts the families (string or array)', () => {
    const text = `${EXAMPLE_LOG}\n${NEXT}`;
    expect(new Set(diagnose(text, { only: 'next-build' }).results.map((d) => d.family))).toEqual(new Set(['next-build']));
    expect(new Set(diagnose(text, { only: ['npm-eresolve'] }).results.map((d) => d.family))).toEqual(new Set(['npm-eresolve']));
    expect(diagnose(text, { only: ['cors'] }).matched).toBe(false);
  });

  test('client reaches the database-url doctor', () => {
    const url = 'postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres';
    expect(diagnose(url, { client: 'drizzle' }).results.map((d) => d.rule)).toContain('database-url.drizzle-prepare-false');
    expect(diagnose(url, { client: 'prisma' }).results.map((d) => d.rule)).toContain('database-url.prisma-pgbouncer-missing');
  });

  test('nodeVersion reaches the esm-cjs explainer', () => {
    const tla = 'ReferenceError: __dirname is not defined in ES module scope';
    const old = diagnose(tla, { nodeVersion: '18.19.0' }).results[0];
    const recent = diagnose(tla, { nodeVersion: '22.3.0' }).results[0];
    expect(old.rule).toBe('esm.cjs-global-in-esm');
    expect(JSON.stringify(old.fixes)).not.toEqual(JSON.stringify(recent.fixes));
  });

  test('a bad options value is ignored, not thrown', () => {
    expect(() => diagnose(CORS, null)).not.toThrow();
    expect(() => diagnose(CORS, { only: 'nope' })).not.toThrow();
    expect(diagnose(CORS, { only: 'nope' }).matched).toBe(false);
  });
});

describe('database-url: the corrected string rides on the first diagnosis', () => {
  test('one fix, password as [YOUR-PASSWORD], never the real one', () => {
    const r = diagnose(`postgresql://postgres:p@ss${SECRET}@localhost:5432/linker`);
    const title = 'Corrected connection string (password masked)';
    const carriers = r.results.filter((d) => d.fixes.some((f) => f.title === title));
    expect(carriers).toEqual([r.results.find((d) => d.family === 'database-url')]);
    expect(carriers[0].fixes.find((f) => f.title === title).code).toContain('[YOUR-PASSWORD]');
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });
});

describe('diagnoseHeaders — both chunk-cache dumps', () => {
  test('same envelope, chunk-cache family only, redactions summed', () => {
    const r = diagnoseHeaders({ htmlHeaders: EXAMPLE_HTML, chunkHeaders: `${EXAMPLE_CHUNK}\nauthorization: Bearer ${SECRET}` });
    expect(Object.keys(r)).toEqual(['version', 'matched', 'redactions', 'results']);
    expect(r.matched).toBe(true);
    expect(r.results.map((d) => d.rule)).toContain('chunk-cache.chunk-missing');
    for (const d of r.results) expect(d.family).toBe('chunk-cache');
    expect(r.redactions).toBe(redact(EXAMPLE_HTML).redactions + redact(EXAMPLE_CHUNK).redactions + 1);
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  test('no dumps → matched false', () => {
    expect(diagnoseHeaders({})).toEqual({ version: '0.1', matched: false, redactions: 0, results: [] });
    expect(diagnoseHeaders(null).matched).toBe(false);
  });
});

describe('redaction happens before diagnosis', () => {
  test('redactions count is the redact() count of the whole input', () => {
    const text = `${ESM}\nAuthorization: Bearer ${SECRET}\nusing ${GH}`;
    const r = diagnose(text);
    expect(r.redactions).toBe(redact(text).redactions);
    expect(r.redactions).toBe(2);
  });

  test.each([
    ['cors', `${CORS}\nAuthorization: Bearer ${SECRET}`],
    ['esm-cjs', `${ESM}\nAPI_KEY=${SECRET}`],
    ['npm-eresolve', `${EXAMPLE_LOG}\n//registry.npmjs.org/:_authToken=${SECRET}`],
    ['chunk-cache', `${EXAMPLE_HTML}\nauthorization: Bearer ${SECRET}`],
    ['database-url', `postgresql://postgres:${SECRET}@db.abcdefghij.supabase.co:6543/postgres`],
    ['database-url (unencoded @ in the password)', `postgresql://postgres:p@ss${SECRET}@db.abcdefghij.supabase.co:5432/postgres`],
    ['database-url (.env line)', `DATABASE_URL="postgres://postgres:${SECRET}@aws-1-us-east-2.pooler.supabase.com:6543/postgres"`],
    ['next-build', `${NEXT}\nSUPABASE_SERVICE_ROLE_KEY=${SECRET}\n${GH}`],
    ['database-connection', `${DB_CONN}\nDATABASE_URL=postgres://app:${SECRET}@127.0.0.1:5432/app`],
    ['database-connection (Prisma P1000 + PGPASSWORD)', `Error: P1000: Authentication failed against database server at \`localhost\`, the provided database credentials for \`postgres\` are not valid.\nPGPASSWORD=${SECRET}`],
  ])('no secret in the %s result', (_, text) => {
    const r = diagnose(text);
    expect(r.matched).toBe(true);
    const json = JSON.stringify(r);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(GH);
  });

  test('redaction does not change what a module reads: withCredentials = true survives', () => {
    const raw = `${CORS}\nxhr.withCredentials = true;`;
    const r = diagnose(raw);
    expect(r.redactions).toBe(0);
    const serverFix = r.results.flatMap((d) => d.fixes).find((f) => f.title.startsWith('Server fix'));
    expect(serverFix.code).toBe(diagnoseCors({ error: raw }).fix.code);
    expect(serverFix.code).toContain('Access-Control-Allow-Credentials');
  });

  test('the database-url doctor still sees the raw password (documented exception)', () => {
    // Redacted first, "[REDACTED]" would read as a template placeholder and the
    // unencoded "@" would be lost. The raw line gives the real diagnosis.
    const r = diagnose(`postgresql://postgres:p@ss${SECRET}@localhost:5432/linker`);
    const ids = r.results.map((d) => d.rule);
    expect(ids).toContain('database-url.password-needs-encoding');
    expect(ids).not.toContain('database-url.placeholder-left');
    expect(r.redactions).toBe(1);
  });
});

describe('catalogue drift — fails when a module gains a finding', () => {
  test('rule ids are unique and well-formed', () => {
    const ids = RULES.map((r) => r.rule);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RULES) {
      expect(r.rule).toMatch(/^[a-z-]+\.[a-z0-9-]+$/);
      expect(FAMILIES).toContain(r.family);
      expect(['high', 'medium']).toContain(r.confidence);
      expect(r.title).not.toMatch(/\$\{/);
    }
  });

  test('every family has at least one rule', () => {
    for (const f of FAMILIES) expect(rules(f).length).toBeGreaterThan(0);
  });

  test('esm-cjs: the catalogue covers RULE_IDS exactly', () => {
    expect(rules('esm-cjs').sort()).toEqual([...ESM_RULE_IDS].sort());
  });

  test('chunk-cache: the catalogue covers RULES minus the input-* and html-redirect notes', () => {
    const native = CHUNK_RULES.map((r) => r.id).filter((id) => !id.startsWith('input-') && id !== 'html-redirect');
    expect(rules('chunk-cache').sort()).toEqual(native.sort());
  });

  test('next-build: the catalogue covers RULES exactly', () => {
    expect(rules('next-build').sort()).toEqual(BUILD_RULES.map((r) => r.id).sort());
  });

  test('cors: the catalogue covers CorsFindingId from the type declarations', () => {
    const dts = read('types/cors-error-explainer.d.ts');
    const block = dts.match(/export type CorsFindingId =([\s\S]*?);/)[1];
    const native = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(rules('cors').sort()).toEqual(native.sort());
  });

  test('database-url: the catalogue covers every finding id the doctor adds', () => {
    const src = read('src/database-url-doctor.js');
    const body = src.slice(src.indexOf('function runDiagnosis'));
    const native = [...new Set([...body.matchAll(/add\('([a-z0-9-]+)'/g)].map((m) => m[1]))];
    expect(rules('database-url').sort()).toEqual(native.sort());
  });

  test('database-connection: the catalogue covers RULE_IDS exactly (minus the "db." prefix)', () => {
    expect(rules('database-connection').sort()).toEqual(DB_CONNECTION_RULE_IDS.map((id) => id.replace(/^db\./, '')).sort());
  });

  test('npm-eresolve: the three contract-level rules', () => {
    expect(rules('npm-eresolve').sort()).toEqual(['conflict', 'overriding-peer-dependency', 'unparsed']);
  });

  // The rule table in docs/CONTRACT.md is GENERATED from RULES. To regenerate
  // after changing the catalogue: UPDATE_CONTRACT_DOC=1 npm test -- contract
  test('docs/CONTRACT.md rule table is exactly the one generated from RULES', () => {
    const file = path.join(HERE, '..', 'docs', 'CONTRACT.md');
    let doc = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const block = /<!-- rule-table:start -->\n[\s\S]*?<!-- rule-table:end -->/;
    const table = `<!-- rule-table:start -->\n${renderRuleTable()}<!-- rule-table:end -->`;
    if (process.env.UPDATE_CONTRACT_DOC) {
      doc = doc.replace(block, () => table);
      fs.writeFileSync(file, doc);
    }
    expect(doc.match(block)[0]).toBe(table);
  });
});
