import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES as CORS_EXAMPLES } from '../src/cors-error-explainer.js';
import { EXAMPLE_LOG as ERESOLVE_LOG } from '../src/npm-eresolve-explainer.js';
import { EXAMPLE_HTML, EXAMPLE_CHUNK } from '../src/chunk-cache-explainer.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Fixtures reused verbatim from the module test files (real Node.js / Next.js output).
const REQUIRE_ESM = `/app/index.js:1
const fetch = require('node-fetch');
              ^

Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.
Instead change the require of /app/node_modules/node-fetch/src/index.js in /app/index.js to a dynamic import() which is available in all CommonJS modules.
    at Object.<anonymous> (/app/index.js:1:15) {
  code: 'ERR_REQUIRE_ESM'
}

Node.js v18.17.0`;
const HEAP_OOM = 'info  - Linting and checking validity of types\n'
  + 'Creating an optimized production build ...\r\n'
  + 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';
const SECRET = 'Sup3r@Secret#Pw';
const DB_URL = `postgresql://postgres.abcdefghijklmnopqrst:${SECRET}@aws-1-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=require`;

function run(args = [], input) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: input ?? '',
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const modulesOf = (json) => json.results.map((r) => r.module);

describe('cli — input sources', () => {
  test('stdin: ERR_REQUIRE_ESM is explained, exit 0', () => {
    const { code, out } = run([], REQUIRE_ESM);
    expect(code).toBe(0);
    expect(out).toContain('ERR_REQUIRE_ESM — require() of an ES module');
    expect(out).toContain('Cause:');
    expect(out).toContain('Why:');
    expect(out).toMatch(/1\) Upgrade Node\.js \(you are on 18\.17\.0\)/);
    expect(out).toContain("await import('node-fetch')");
    expect(out).toContain('Source: https://nodejs.org/api/modules.html');
  });

  test('--text: a Chrome CORS error gets the finding and a server fix snippet', () => {
    const ex = CORS_EXAMPLES.find((e) => e.id === 'chrome-preflight-auth');
    const { code, out } = run(['--text', ex.error]);
    expect(code).toBe(0);
    expect(out).toContain('The preflight response does not allow the request header "authorization"');
    expect(out).toContain('app/api/<route>/route.js');
    expect(out).toContain('export async function OPTIONS');
  });

  test('file argument: an npm ERESOLVE log', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dee-cli-'));
    try {
      const file = join(dir, 'npm.log');
      writeFileSync(file, ERESOLVE_LOG);
      const { code, out } = run([file]);
      expect(code).toBe(0);
      expect(out).toContain('npm ERESOLVE');
      expect(out).toContain('@testing-library/react@13.4.0 wants react@"^18.0.0"');
      expect(out).toContain('npm install --legacy-peer-deps');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('chunk headers are only read with the explicit flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dee-cli-'));
    try {
      writeFileSync(join(dir, 'html.txt'), EXAMPLE_HTML);
      writeFileSync(join(dir, 'chunk.txt'), EXAMPLE_CHUNK);
      const { code, out } = run(['--json', '--html-headers', join(dir, 'html.txt'), '--chunk-headers', join(dir, 'chunk.txt')]);
      expect(code).toBe(0);
      const json = JSON.parse(out);
      expect(modulesOf(json)).toEqual(['chunk-cache-explainer']);
      expect(json.results[0].verdict).toBe('cause-found');
      expect(json.results[0].findings.map((f) => f.id)).toContain('chunk-missing');
      // The session cookie in the example headers is never echoed.
      expect(out).not.toContain('abc123secret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('cli — --json', () => {
  test('stable top-level and finding shape', () => {
    const { code, out } = run(['--json'], REQUIRE_ESM);
    expect(code).toBe(0);
    const json = JSON.parse(out);
    expect(Object.keys(json)).toEqual(['tool', 'version', 'input', 'recognised', 'results']);
    expect(json).toMatchObject({ tool: 'dev-error-explainers', version: PKG.version, recognised: true, input: { source: 'stdin' } });
    expect(modulesOf(json)).toEqual(['esm-cjs-explainer']);
    const [result] = json.results;
    expect(Object.keys(result)).toEqual(['module', 'label', 'verdict', 'notes', 'findings', 'snippet', 'corrected', 'extra']);
    const [f] = result.findings;
    expect(Object.keys(f)).toEqual(['id', 'severity', 'title', 'cause', 'why', 'fixes', 'source', 'sources', 'evidence']);
    expect(f.id).toBe('require-esm');
    expect(f.source).toMatch(/^https:\/\//);
    for (const fix of f.fixes) expect(Object.keys(fix)).toEqual(['title', 'detail', 'code']);
  });

  test('unrecognised input in JSON: recognised false, no results, exit 2', () => {
    const { code, out } = run(['--json', '--text', 'everything is fine, build succeeded']);
    expect(code).toBe(2);
    expect(JSON.parse(out)).toMatchObject({ recognised: false, results: [] });
  });

  test('--node is passed to the ESM explainer', () => {
    const { out } = run(['--json', '--node', '22.12.0', '--text', 'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/x/index.js not supported.']);
    const [f] = JSON.parse(out).results[0].findings;
    expect(f.cause).toContain('You report Node.js 22.12.0');
  });
});

describe('cli — --only and detection', () => {
  const MIXED = `${REQUIRE_ESM}\n${HEAP_OOM}`;

  test('auto-detection keeps every explainer that recognises something', () => {
    const json = JSON.parse(run(['--json'], MIXED).out);
    expect(modulesOf(json)).toEqual(['esm-cjs-explainer', 'build-error-decoder']);
  });

  test('--only restricts to one module (alias or full name)', () => {
    const a = JSON.parse(run(['--json', '--only', 'build'], MIXED).out);
    expect(modulesOf(a)).toEqual(['build-error-decoder']);
    expect(a.results[0].findings[0]).toMatchObject({ id: 'heap-oom', evidence: 'line 14: FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory' });
    const b = JSON.parse(run(['--json', '--only=esm-cjs-explainer'], MIXED).out);
    expect(modulesOf(b)).toEqual(['esm-cjs-explainer']);
  });

  test('--only a module that does not match the input → exit 2', () => {
    const { code, out } = run(['--only', 'cors'], REQUIRE_ESM);
    expect(code).toBe(2);
    expect(out).toContain('No known error recognised — nothing guessed');
  });

  test('unrecognised text → honest message, exit 2', () => {
    const { code, out } = run([], '✓ Compiled successfully\n');
    expect(code).toBe(2);
    expect(out).toContain('No known error recognised — nothing guessed');
  });

  test('empty stdin → exit 2', () => {
    expect(run([], '').code).toBe(2);
  });
});

describe('cli — secrets', () => {
  const variants = [SECRET, encodeURIComponent(SECRET)];

  test('a DATABASE_URL with a password: diagnosed, password never printed (human and JSON)', () => {
    const log = `Error: P1001: Can't reach database server\nDATABASE_URL="${DB_URL}"\n`;
    for (const args of [[], ['--json'], ['--client', 'drizzle'], ['--only', 'db', '--json']]) {
      const { code, out, err } = run(args, log);
      expect(code).toBe(0);
      expect(out).toMatch(/database-url-doctor/);
      for (const s of variants) {
        expect(out).not.toContain(s);
        expect(err).not.toContain(s);
      }
    }
    const json = JSON.parse(run(['--json'], log).out);
    const db = json.results.find((r) => r.module === 'database-url-doctor');
    expect(db.findings.map((f) => f.id)).toContain('password-needs-encoding');
    expect(db.corrected[0].value).toContain('[YOUR-PASSWORD]');
  });

  test('a credentialed URL echoed as build evidence is masked', () => {
    const { code, out } = run([], `Missing environment variable DIRECT_URL, got postgresql://app:hunter2hunter2@db.example.com:5432/app\n`);
    expect(code).toBe(0);
    expect(out).toContain('Environment variable undefined at runtime');
    expect(out).not.toContain('hunter2hunter2');
  });
});

describe('cli — usage', () => {
  test('--help exits 0', () => {
    const { code, out } = run(['--help']);
    expect(code).toBe(0);
    expect(out).toContain('Usage:');
  });

  test('--version prints the package.json version', () => {
    const { code, out } = run(['--version']);
    expect(code).toBe(0);
    expect(out.trim()).toBe(PKG.version);
  });

  test.each([
    [['--bogus']],
    [['--only', 'nope']],
    [['--client', 'mysql', '--text', 'x']],
    [['--text']],
    [['--only', 'chunk-cache', '--text', 'x']],
    [['/definitely/not/a/file.log']],
    [['--html-headers', '/definitely/not/a/file.txt']],
  ])('usage error %j → exit 64', (args) => {
    const { code, err } = run(args, 'Error [ERR_REQUIRE_ESM]');
    expect(code).toBe(64);
    expect(err).toContain('dev-error-explainers:');
  });
});
