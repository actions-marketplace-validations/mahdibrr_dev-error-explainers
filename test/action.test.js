import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ACTION = fileURLToPath(new URL('../action/index.js', import.meta.url));
const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const LOGS = fileURLToPath(new URL('../action/test-logs/', import.meta.url));

let dir;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'dee-action-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

let n = 0;
/** Spawn the action exactly as the runner does: INPUT_* env vars, summary/output files. */
function runAction(inputs, { logText } = {}) {
  n += 1;
  const summary = join(dir, `summary-${n}.md`);
  const output = join(dir, `output-${n}.txt`);
  writeFileSync(summary, '');
  writeFileSync(output, '');
  // Isolate from the CI job running these tests: no inherited INPUT_* / GITHUB_*.
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith('INPUT_') && !k.startsWith('GITHUB_')) env[k] = v;
  }
  env.GITHUB_STEP_SUMMARY = summary;
  env.GITHUB_OUTPUT = output;
  env.GITHUB_WORKSPACE = ROOT;
  if (logText !== undefined) {
    const log = join(dir, `log-${n}.log`);
    writeFileSync(log, logText);
    inputs = { 'log-file': log, ...inputs };
  }
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const r = spawnSync(process.execPath, [ACTION], { cwd: ROOT, env, encoding: 'utf8' });
  return {
    code: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    summary: readFileSync(summary, 'utf8'),
    outputs: parseOutputs(readFileSync(output, 'utf8')),
    rawOutput: readFileSync(output, 'utf8'),
  };
}

function parseOutputs(text) {
  const out = {};
  const re = /^([\w-]+)<<(\S+)\n([\s\S]*?)\n\2$/gm;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[3];
  return out;
}

const annotations = (stdout) => stdout.split('\n').filter((l) => /^::(error|warning|notice)[ :]/.test(l));
const fixture = (name) => ({ 'log-file': join(LOGS, name) });

describe('action — recognised logs', () => {
  test('ERR_REQUIRE_ESM: summary section, job-level annotation, outputs', () => {
    const r = runAction({ ...fixture('esm-require.log'), 'node-version': '18.17.0' });
    expect(r.code).toBe(0);
    expect(r.summary).toContain('## Explain CI error — 1 finding');
    expect(r.summary).toContain('### 1. ERR_REQUIRE_ESM — require() of an ES module');
    expect(r.summary).toContain('**Cause:**');
    expect(r.summary).toMatch(/\*\*Fixes\*\*\n\n1\. /);
    expect(r.summary).toContain('```');
    expect(r.summary).toContain('**Source:** https://nodejs.org/');
    expect(r.summary).toContain('Run locally: `npx dev-error-explainers < esm-require.log`');
    // /app/index.js is not in the workspace: no file annotation, one job-level error.
    const a = annotations(r.stdout);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/^::error title=ERR_REQUIRE_ESM — require\(\) of an ES module::/);
    expect(a[0]).not.toContain('file=');
    expect(r.outputs.recognised).toBe('true');
    expect(r.outputs.families).toBe('esm-cjs-explainer');
    expect(r.outputs['summary-md']).toBe(r.summary.trimEnd());
  });

  test('Next.js "Module not found": file/line annotation with escaped properties', () => {
    const r = runAction(fixture('next-module-not-found.log'));
    expect(r.code).toBe(0);
    const a = annotations(r.stdout);
    expect(a).toHaveLength(1);
    // The title contains commas: escaped as %2C in a property.
    expect(a[0]).toMatch(/^::error file=src\/index\.js,line=9,col=1,title=Module not found — resolution%2C casing%2C or a missing dependency::/);
    expect(r.summary).toContain('**Where:** `src/index.js:9:1`');
    expect(r.outputs.families).toBe('build-error-decoder');
  });

  test('absolute stack-frame path inside the workspace: file annotation', () => {
    const esm = readFileSync(join(LOGS, 'esm-require.log'), 'utf8')
      .replace('(/app/index.js:1:15)', `(${join(ROOT, 'src', 'index.js')}:1:15)`);
    const r = runAction({}, { logText: esm });
    const a = annotations(r.stdout);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatch(/^::error file=src\/index\.js,line=1,col=15,title=ERR_REQUIRE_ESM/);
  });

  test('CORS console error from an e2e log: finding + server snippet, HTML-safe', () => {
    const r = runAction(fixture('cors-playwright.log'));
    expect(r.code).toBe(0);
    expect(r.outputs.families).toBe('cors-error-explainer');
    expect(r.summary).toContain('does not allow the request header "authorization"');
    expect(r.summary).toContain('**Server fix (');
    expect(r.summary).toContain('export async function OPTIONS');
    expect(r.summary).not.toContain('<route>'); // prose is HTML-escaped
    expect(r.summary).toContain('&lt;route&gt;');
    // e2e/orders.spec.ts is named in the log but does not exist here: no file annotation.
    expect(annotations(r.stdout).every((l) => !l.includes('file='))).toBe(true);
  });

  test('families match bin/cli.js --json on every fixture (drift guard)', () => {
    for (const f of ['esm-require.log', 'next-module-not-found.log', 'cors-playwright.log', 'unrecognised.log']) {
      const cli = spawnSync(process.execPath, [CLI, '--json', join(LOGS, f)], { encoding: 'utf8' });
      // One contract Diagnosis per finding: a module can repeat, families list it once.
      const modules = [...new Set(JSON.parse(cli.stdout).results.map((x) => x.module))].join(',');
      expect(runAction(fixture(f)).outputs.families).toBe(modules);
    }
  });

  test('a log over 2 MB is read from its tail', () => {
    const noise = 'compiling module 1234 ok\n'.repeat(120000); // ~3 MB
    const r = runAction({}, { logText: noise + readFileSync(join(LOGS, 'esm-require.log'), 'utf8') });
    expect(r.code).toBe(0);
    expect(r.outputs.recognised).toBe('true');
    expect(r.stdout).toContain('read the last 2 MB');
  });

  test('max-annotations caps the annotations', () => {
    const r = runAction({ ...fixture('esm-require.log'), 'max-annotations': '0' });
    expect(r.code).toBe(0);
    expect(annotations(r.stdout)).toHaveLength(0);
    expect(r.summary).toContain('ERR_REQUIRE_ESM');
  });
});

describe('action — secret masking', () => {
  // Built at runtime so no token-shaped literal is ever committed.
  const pw = ['hunter', '2', 'Pw', 'x9'].join('');
  const bearer = ['ghp', '_', 'A1b2C3d4', 'E5f6G7h8', 'I9j0'].join('');
  const npmToken = ['npm', '_', 'Zz9Yy8Xx', '7Ww6Vv5U'].join('');
  const secrets = [pw, bearer, npmToken];

  test('secrets on an echoed evidence line never reach summary, annotations or outputs', () => {
    const line = `Module not found: Can't resolve 'left-pad' (registry https://ci:${pw}@npm.example.com `
      + `NPM_TOKEN=${npmToken} Authorization: Bearer ${bearer})`;
    const r = runAction({}, { logText: `Failed to compile.\n\n./src/index.js:9:1\n${line}\n` });
    expect(r.code).toBe(0);
    expect(r.outputs.recognised).toBe('true');
    expect(r.summary).toContain('**Evidence:**'); // the line IS echoed…
    for (const s of secrets) {
      expect(r.summary).not.toContain(s); // …but masked
      expect(r.stdout).not.toContain(s);
      expect(r.rawOutput).not.toContain(s);
    }
    expect(r.summary).toMatch(/NPM_TOKEN=(\[REDACTED\]|\*\*\*)/);
    expect(r.summary).toMatch(/https:\/\/ci:(\[REDACTED\]|\*\*\*)@npm\.example\.com/);
  });

  test('mask() is the library redact(): the three classes masked, prose and placeholders kept', async () => {
    const { mask } = await import('../action/index.js');
    const out = mask(`https://ci:${pw}@npm.example.com
Authorization: Bearer ${bearer}
NPM_TOKEN=${npmToken}
DB_PASSWORD="${pw}"`);
    for (const s of secrets) expect(out).not.toContain(s);
    expect(mask('Unexpected token: }')).toBe('Unexpected token: }');
    expect(mask('API_KEY=${API_KEY}')).toBe('API_KEY=${API_KEY}');
  });

  test('a postgres URL password is masked', () => {
    const r = runAction({}, { logText: `Error: P1001 connecting to postgresql://postgres:${pw}@db.example.com:5432/postgres\n` });
    expect(r.summary + r.stdout + r.rawOutput).not.toContain(pw);
  });
});

describe('action — unrecognised and bad input', () => {
  test('unrecognised: notice, "nothing guessed", exit 0', () => {
    const r = runAction(fixture('unrecognised.log'));
    expect(r.code).toBe(0);
    expect(annotations(r.stdout)).toEqual(['::notice title=dev-error-explainers::No known error recognised — nothing guessed']);
    expect(r.summary).toContain('No known error recognised — nothing guessed');
    expect(r.outputs.recognised).toBe('false');
    expect(r.outputs.families).toBe('');
  });

  test('unrecognised with fail-on-unrecognised: error, exit 1', () => {
    const r = runAction({ ...fixture('unrecognised.log'), 'fail-on-unrecognised': 'true' });
    expect(r.code).toBe(1);
    expect(annotations(r.stdout)[0]).toMatch(/^::error title=dev-error-explainers::/);
  });

  test('a workflow command inside the log is never echoed to stdout', () => {
    const r = runAction({}, { logText: '::error::injected\n::add-mask::x\nsome unrelated failure\n' });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('injected');
    expect(r.stdout).not.toContain('::add-mask::');
  });

  test('missing log-file input: error annotation, exit 1', () => {
    const r = runAction({});
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(/^::error title=dev-error-explainers::input "log-file" is required/m);
  });

  test('unreadable log file: error annotation, exit 1', () => {
    const r = runAction({ 'log-file': join(dir, 'does-not-exist.log') });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('cannot read log-file');
  });

  test('invalid boolean input is rejected', () => {
    const r = runAction({ ...fixture('unrecognised.log'), 'fail-on-unrecognised': 'yes' });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('must be true or false');
  });
});

describe('action — workflow-command escaping', () => {
  test('escapeData / escapeProperty follow the GitHub rules', async () => {
    const { escapeData, escapeProperty, command } = await import('../action/index.js');
    expect(escapeData('50% a\r\nb')).toBe('50%25 a%0D%0Ab');
    expect(escapeProperty('a:b,c%\n')).toBe('a%3Ab%2Cc%25%0A');
    expect(command('error', { file: 'a,b.js', line: 3, title: 'x: y' }, 'm\nn'))
      .toBe('::error file=a%2Cb.js,line=3,title=x%3A y::m%0An');
  });
});
