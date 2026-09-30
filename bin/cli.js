#!/usr/bin/env node
// dev-error-explainers CLI — paste (or pipe) an error, get the cause and the fix.
//
// Zero dependencies. Every diagnosis comes from the pure modules in src/; this
// file only reads input, decides which explainers apply, normalises their
// output into one shape and prints it. It never guesses: when no module
// recognises the input it says so and exits 2.
//
// Exit codes: 0 recognised · 2 nothing recognised · 64 usage error · 1 crash.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagnose as diagnoseCors, maskSecrets } from '../src/cors-error-explainer.js';
import { explain as explainEsm } from '../src/esm-cjs-explainer.js';
import { analyseEresolveLog } from '../src/npm-eresolve-explainer.js';
import { diagnose as diagnoseChunk } from '../src/chunk-cache-explainer.js';
import { diagnose as diagnoseDbUrl, CLIENTS } from '../src/database-url-doctor.js';
import { decode as decodeBuild } from '../src/build-error-decoder.js';

const EXIT = { ok: 0, crash: 1, unrecognised: 2, usage: 64 };
const SITE = 'https://www.iloveblogs.blog';

// Canonical module names, their aliases for --only, and their display label.
const MODULES = {
  'cors-error-explainer': { aliases: ['cors'], label: 'CORS' },
  'esm-cjs-explainer': { aliases: ['esm', 'cjs', 'esm-cjs'], label: 'ESM / CommonJS' },
  'npm-eresolve-explainer': { aliases: ['eresolve', 'npm', 'npm-eresolve'], label: 'npm ERESOLVE' },
  'build-error-decoder': { aliases: ['build', 'next', 'nextjs'], label: 'Next.js build output' },
  'database-url-doctor': { aliases: ['database-url', 'db', 'database', 'postgres'], label: 'DATABASE_URL' },
  'chunk-cache-explainer': { aliases: ['chunk', 'chunk-cache'], label: 'ChunkLoadError caching' },
};

function resolveModule(name) {
  const n = String(name || '').trim().toLowerCase();
  for (const [id, m] of Object.entries(MODULES)) {
    if (n === id || m.aliases.includes(n)) return id;
  }
  return null;
}

const USAGE = `dev-error-explainers — paste a developer error, get the real cause and the fix.

Usage:
  some-command 2>&1 | npx dev-error-explainers [options]
  npx dev-error-explainers [options] < error.log
  npx dev-error-explainers [options] error.log
  npx dev-error-explainers [options] --text "the error message"
  npx dev-error-explainers --html-headers page.txt --chunk-headers chunk.txt

Auto-detection runs the CORS, ESM/CommonJS, npm ERESOLVE and Next.js build
explainers on the text and keeps what they recognise. A postgres:// or
postgresql:// URL in the text is also checked by the DATABASE_URL doctor
(its password is never printed). ChunkLoadError caching needs the two
curl -sI outputs, passed with --html-headers and --chunk-headers.

Options:
  --text <string>          Explain this text instead of reading stdin or a file
  --only <module>          Run a single explainer: cors, esm, eresolve, build,
                           database-url, chunk-cache (or the full module name)
  --json                   Machine-readable output (stable shape)
  --node <version>         Node.js version for the ESM/CommonJS advice (e.g. 20.10.0)
  --client <name>          DATABASE_URL client: prisma (default), drizzle, pg, psql
  --html-headers <file>    Response headers of the HTML page (curl -sI <page>)
  --chunk-headers <file>   Response headers of a failing chunk (curl -sI <chunk>)
  -h, --help               Show this help
  -v, --version            Print the version

Exit codes: 0 recognised · 2 nothing recognised · 64 usage error
Set NO_COLOR to disable colours.`;

class UsageError extends Error {}

// ─── Arguments ──────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(['--text', '--only', '--node', '--client', '--html-headers', '--chunk-headers']);

export function parseArgs(argv) {
  const opts = { json: false, help: false, version: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    let inline = null;
    if (arg.startsWith('--') && arg.includes('=')) {
      inline = arg.slice(arg.indexOf('=') + 1);
      arg = arg.slice(0, arg.indexOf('='));
    }
    if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg === '-v' || arg === '--version') opts.version = true;
    else if (arg === '--json') opts.json = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = inline !== null ? inline : argv[++i];
      if (value === undefined) throw new UsageError(`${arg} needs a value`);
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      opts[key] = value;
    } else if (arg === '-' || !arg.startsWith('-')) opts.files.push(arg);
    else throw new UsageError(`unknown option ${arg}`);
  }
  if (opts.help || opts.version) return opts;
  if (opts.files.length > 1) throw new UsageError('pass a single file (or - for stdin)');
  if (opts.text !== undefined && opts.files.length) throw new UsageError('use either --text or a file, not both');
  if (opts.only !== undefined) {
    const id = resolveModule(opts.only);
    if (!id) throw new UsageError(`unknown module "${opts.only}" for --only (cors, esm, eresolve, build, database-url, chunk-cache)`);
    opts.only = id;
  }
  if (opts.client !== undefined && !CLIENTS[opts.client]) {
    throw new UsageError(`--client must be one of ${Object.keys(CLIENTS).join(', ')}`);
  }
  const chunkMode = opts.htmlHeaders !== undefined || opts.chunkHeaders !== undefined;
  if (opts.only === 'chunk-cache-explainer' && !chunkMode) {
    throw new UsageError('chunk-cache needs --html-headers <file> and/or --chunk-headers <file>');
  }
  if (chunkMode && opts.only && opts.only !== 'chunk-cache-explainer') {
    throw new UsageError('--html-headers / --chunk-headers only apply to the chunk-cache explainer');
  }
  opts.chunkMode = chunkMode;
  return opts;
}

// ─── Input ──────────────────────────────────────────────────────────────────

function readFileArg(file, flag) {
  try {
    return readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${flag ? `${flag} ` : ''}file "${file}" (${err.code || err.message})`);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function readInput(opts) {
  if (opts.text !== undefined) return { source: 'text', text: opts.text };
  if (opts.files.length && opts.files[0] !== '-') return { source: 'file', text: readFileArg(opts.files[0]) };
  // Chunk mode takes its input from the two header files; stdin is optional.
  if (opts.chunkMode && process.stdin.isTTY) return { source: 'none', text: '' };
  if (process.stdin.isTTY && !opts.files.length) {
    throw new UsageError('no input: pipe an error into the command, pass a file, or use --text');
  }
  return { source: 'stdin', text: await readStdin() };
}

// ─── Normalised result shape ────────────────────────────────────────────────
// result  = { module, label, findings: Finding[], snippet, corrected, verdict }
// Finding = { id, severity, title, cause, why, fixes: Fix[], source, sources, evidence }
// Fix     = { title, detail, code }

const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
const urlOf = (s) => (!s ? null : typeof s === 'string' ? s : s.url || null);
const absolute = (href) => (href && href.startsWith('/') ? `${SITE}${href}` : href || null);

function finding(f) {
  return {
    id: f.id,
    severity: f.severity || null,
    title: f.title,
    cause: str(f.cause),
    why: str(f.why),
    fixes: (f.fixes || []).filter((x) => str(x.title) || str(x.detail) || str(x.code)).map((x) => ({
      title: str(x.title),
      detail: str(x.detail),
      code: str(x.code),
    })),
    source: f.source || null,
    sources: (f.sources || []).filter(Boolean),
    evidence: str(f.evidence),
  };
}

function runCors(text) {
  const r = diagnoseCors({ error: text });
  if (!r.recognised) return null;
  return {
    findings: r.findings.map((f) => finding({
      id: f.id,
      severity: f.severity,
      title: f.title,
      cause: f.explanation,
      why: f.kind === 'not-cors' ? 'This is not a CORS header problem: the CORS message is a symptom.' : null,
      fixes: f.steps.map((s) => ({ title: s })),
      source: urlOf(f.source),
      sources: [...new Set((f.sources || []).map(urlOf))],
      evidence: f.evidence,
    })),
    snippet: r.fix ? {
      title: `Server fix for ${r.stack}${r.stackGuessed ? ' (guessed from the URL)' : ' (default stack)'}`,
      filename: r.fix.filename,
      code: r.fix.code,
      notes: r.fix.notes || [],
      source: urlOf(r.fix.source),
    } : null,
    extra: { isCorsProblem: r.isCorsProblem, context: r.context },
  };
}

function runEsm(text, opts) {
  const r = explainEsm({ error: text, nodeVersion: opts.node });
  if (!r.findings.length) return null;
  return {
    findings: r.findings.map((f) => finding({
      id: f.id,
      title: f.title,
      cause: f.cause,
      why: f.why,
      fixes: f.fixes,
      source: urlOf(f.source),
      sources: [urlOf(f.source), urlOf(f.extraSource)].filter(Boolean),
    })),
    notes: r.notes,
    extra: { context: r.context },
  };
}

function runEresolve(text) {
  const r = analyseEresolveLog(text);
  if (!r.conflicts.length) return null;
  return {
    findings: r.conflicts.map((c, i) => {
      const [head, ...rest] = c.findings;
      return finding({
        id: `${c.kind === 'error' ? 'eresolve-conflict' : 'eresolve-warning'}-${i + 1}`,
        severity: head.severity,
        title: head.title,
        cause: head.body,
        why: rest.map((x) => `${x.title}: ${x.body}`).join('\n'),
        fixes: c.fixes.map((x) => ({
          title: `[${x.rank}] ${x.title}`,
          detail: [x.body, x.tradeoff ? `Trade-off: ${x.tradeoff}` : null].filter(Boolean).join(' '),
          code: [...(x.commands || []), x.snippet].filter(Boolean).join('\n'),
        })),
        source: head.source,
        sources: [...new Set([...c.findings.map((x) => x.source), ...c.fixes.map((x) => x.source)])],
      });
    }),
    extra: { code: r.code },
  };
}

function runBuild(text) {
  const hits = decodeBuild(text);
  if (!hits.length) return null;
  return {
    findings: hits.map((h) => finding({
      id: h.id,
      severity: h.severity,
      title: h.title,
      cause: h.body,
      fixes: [{ title: h.link ? h.link.label : null, code: h.fix }],
      source: absolute(h.link && h.link.href),
      // The decoder echoes a raw line of the paste: mask it with the CORS
      // module's secret masker so a URL with credentials never reaches stdout.
      evidence: h.evidence ? `line ${h.evidence.lineNo}: ${maskSecrets(h.evidence.line)}` : null,
    })),
  };
}

// First postgres:// or postgresql:// URL in the text, without surrounding quotes.
const PG_URL_RE = /postgres(?:ql)?:\/\/[^\s'"`<>]+/i;

function runDbUrl(text, opts, explicit) {
  const m = text.match(PG_URL_RE);
  if (!m && !explicit) return null;
  const input = m ? m[0].replace(/[),.;]+$/, '') : text;
  const r = diagnoseDbUrl(input, { client: opts.client });
  if (!r.findings.length) return null;
  return {
    findings: r.findings.map((f) => finding({
      id: f.id,
      severity: f.severity,
      title: f.title,
      cause: f.body,
      fixes: [{ code: f.fix }],
      source: f.source,
      sources: [f.source, absolute(f.link && f.link.href)].filter(Boolean),
    })),
    // Masked by the module itself: the password is •••• / [YOUR-PASSWORD].
    corrected: r.corrected,
    extra: { client: r.client, kind: r.kind, kindLabel: r.kindLabel, components: r.components },
  };
}

function runChunk(opts) {
  const r = diagnoseChunk({
    htmlHeaders: opts.htmlHeaders !== undefined ? readFileArg(opts.htmlHeaders, '--html-headers') : '',
    chunkHeaders: opts.chunkHeaders !== undefined ? readFileArg(opts.chunkHeaders, '--chunk-headers') : '',
  });
  if (r.verdict !== 'cause-found' && r.verdict !== 'suspects') {
    return { unrecognised: true, verdict: r.verdict, findings: r.findings };
  }
  return {
    findings: r.findings.map((f) => finding({
      id: f.ruleId,
      severity: f.severity,
      title: f.title,
      cause: f.why,
      fixes: [{ detail: f.fix, code: f.code }],
      source: f.source,
    })),
    verdict: r.verdict,
    extra: { host: r.host, detectedHosts: r.detectedHosts, passes: r.passes },
  };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

const TEXT_RUNNERS = [
  ['cors-error-explainer', (t) => runCors(t)],
  ['esm-cjs-explainer', (t, o) => runEsm(t, o)],
  ['npm-eresolve-explainer', (t) => runEresolve(t)],
  ['build-error-decoder', (t) => runBuild(t)],
  ['database-url-doctor', (t, o) => runDbUrl(t, o, o.only === 'database-url-doctor')],
];

export function explainText(text, opts) {
  const results = [];
  if (!text.trim()) return results;
  for (const [id, run] of TEXT_RUNNERS) {
    if (opts.only && opts.only !== id) continue;
    const r = run(text, opts);
    if (r) results.push({ module: id, label: MODULES[id].label, ...r });
  }
  return results;
}

// ─── Output ─────────────────────────────────────────────────────────────────

function palette(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), cyan: wrap(36, 39), green: wrap(32, 39) };
}

const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function formatHuman(results, c) {
  const out = [];
  const sev = (s) => (s === 'critical' ? c.red(`[${s}]`) : s === 'warning' ? c.yellow(`[${s}]`) : s ? c.dim(`[${s}]`) : '');
  for (const r of results) {
    out.push(c.bold(c.cyan(`== ${r.label} (${r.module}) ==`)));
    if (r.verdict) out.push(`Verdict: ${r.verdict}`);
    for (const note of r.notes || []) out.push(c.dim(`Note: ${note}`));
    r.findings.forEach((f, i) => {
      out.push('');
      out.push(`${c.bold(`${i + 1}. ${f.title}`)} ${sev(f.severity)}`.trimEnd());
      if (f.evidence) out.push(indent(`${c.dim('Evidence:')} ${f.evidence}`, 3));
      if (f.cause) out.push(indent(`${c.bold('Cause:')} ${f.cause}`, 3));
      if (f.why) out.push(indent(`${c.bold('Why:')} ${f.why}`, 3));
      if (f.fixes.length) {
        out.push(indent(c.bold('Fixes:'), 3));
        f.fixes.forEach((x, j) => {
          const head = [x.title, x.detail].filter(Boolean).join(' — ');
          out.push(indent(`${j + 1}) ${head || 'Fix'}`, 5));
          if (x.code) out.push(c.green(indent(x.code, 9)));
        });
      }
      if (f.source) out.push(indent(`${c.dim('Source:')} ${f.source}`, 3));
    });
    if (r.snippet) {
      out.push('');
      out.push(c.bold(`${r.snippet.title} — ${r.snippet.filename}`));
      out.push(c.green(indent(r.snippet.code, 3)));
      for (const n of r.snippet.notes) out.push(indent(`- ${n}`, 3));
      if (r.snippet.source) out.push(indent(`${c.dim('Source:')} ${r.snippet.source}`, 3));
    }
    if (r.corrected && r.corrected.length) {
      out.push('');
      out.push(c.bold('Corrected connection string (password masked):'));
      for (const x of r.corrected) {
        out.push(indent(`${x.name}="${x.value}"`, 3));
        if (x.note) out.push(indent(c.dim(x.note), 5));
      }
    }
    out.push('');
  }
  return out.join('\n');
}

function jsonReport(version, input, results) {
  return {
    tool: 'dev-error-explainers',
    version,
    input: { source: input.source, bytes: Buffer.byteLength(input.text, 'utf8') },
    recognised: results.length > 0,
    results: results.map((r) => ({
      module: r.module,
      label: r.label,
      verdict: r.verdict || null,
      notes: r.notes || [],
      findings: r.findings,
      snippet: r.snippet || null,
      corrected: r.corrected || null,
      extra: r.extra || {},
    })),
  };
}

function packageVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

const UNRECOGNISED = 'No known error recognised — nothing guessed.\n'
  + 'Supported: CORS console errors, ESM/CommonJS (ERR_REQUIRE_ESM, "Cannot use import statement"…), '
  + 'npm ERESOLVE logs, Next.js build/dev errors, postgres:// connection strings, '
  + 'ChunkLoadError caching (--html-headers / --chunk-headers). Run with --help for usage.';

export async function main(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr.write(`dev-error-explainers: ${err.message}\n\n${USAGE}\n`);
    return EXIT.usage;
  }
  if (opts.help) { stdout.write(`${USAGE}\n`); return EXIT.ok; }
  const version = packageVersion();
  if (opts.version) { stdout.write(`${version}\n`); return EXIT.ok; }

  let input;
  let results;
  try {
    input = await readInput(opts);
    results = explainText(input.text, opts);
    if (opts.chunkMode) {
      const r = runChunk(opts);
      if (!r.unrecognised) results.push({ module: 'chunk-cache-explainer', label: MODULES['chunk-cache-explainer'].label, ...r });
    }
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr.write(`dev-error-explainers: ${err.message}\n`);
    return EXIT.usage;
  }

  if (opts.json) {
    stdout.write(`${JSON.stringify(jsonReport(version, input, results), null, 2)}\n`);
  } else if (results.length) {
    const color = Boolean(stdout.isTTY) && !('NO_COLOR' in process.env);
    stdout.write(formatHuman(results, palette(color)));
  } else {
    stdout.write(`${UNRECOGNISED}\n`);
  }
  return results.length ? EXIT.ok : EXIT.unrecognised;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`dev-error-explainers: unexpected error: ${err && err.message ? err.message : err}\n`);
    process.exitCode = EXIT.crash;
  },
);
