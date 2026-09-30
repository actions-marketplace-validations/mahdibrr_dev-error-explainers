#!/usr/bin/env node
// dev-error-explainers CLI — paste (or pipe) an error, get the cause and the fix.
//
// Zero dependencies. Every diagnosis comes from src/contract.js — the ONE
// normalised result shared with the GitHub Action and the MCP server; this file
// only reads input, prints that result (--json prints it as is) and picks the
// exit code. It never guesses: when nothing is recognised it says so and exits 2.
//
// `dev-error-explainers mcp` starts the MCP stdio server (bin/mcp.js) instead.
//
// Exit codes: 0 recognised · 2 nothing recognised · 64 usage error · 1 crash.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diagnose, diagnoseHeaders, FAMILIES } from '../src/contract.js';
import { CLIENTS } from '../src/database-url-doctor.js';
import { groupByModule, buildEvidenceLines } from '../src/format.js';

const EXIT = { ok: 0, crash: 1, unrecognised: 2, usage: 64 };

// Canonical module names, their contract family and their aliases for --only.
const MODULES = {
  'cors-error-explainer': { family: 'cors', aliases: ['cors'] },
  'esm-cjs-explainer': { family: 'esm-cjs', aliases: ['esm', 'cjs', 'esm-cjs'] },
  'npm-eresolve-explainer': { family: 'npm-eresolve', aliases: ['eresolve', 'npm', 'npm-eresolve'] },
  'build-error-decoder': { family: 'next-build', aliases: ['build', 'next', 'nextjs', 'next-build'] },
  'database-url-doctor': { family: 'database-url', aliases: ['database-url', 'db', 'database', 'postgres'] },
  'chunk-cache-explainer': { family: 'chunk-cache', aliases: ['chunk', 'chunk-cache'] },
  'database-connection-explainer': { family: 'database-connection', aliases: ['database-connection', 'db-connection'] },
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
  npx dev-error-explainers mcp        # start the MCP server (stdio)

Auto-detection runs the CORS, ESM/CommonJS, npm ERESOLVE, Next.js build and
database connection explainers on the text and keeps what they recognise. A
postgres:// or postgresql:// URL in the text is also checked by the
DATABASE_URL doctor (its password is never printed). ChunkLoadError caching
needs the two curl -sI outputs, passed with --html-headers and --chunk-headers.
Secrets the redactor knows (URL passwords, tokens, auth headers) are masked
before analysis; only the DATABASE_URL doctor reads the raw postgres:// line,
and it never prints the password.

Options:
  --text <string>          Explain this text instead of reading stdin or a file
  --only <module>          Run a single explainer: cors, esm, eresolve, build,
                           database-url, database-connection, chunk-cache
                           (or the full module name)
  --json                   The contract result as JSON (docs/CONTRACT.md)
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
    if (!id) throw new UsageError(`unknown module "${opts.only}" for --only (cors, esm, eresolve, build, database-url, database-connection, chunk-cache)`);
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

// ─── Diagnosis (src/contract.js) ────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const EMPTY = { version: diagnose('').version, matched: false, redactions: 0, results: [] };

/** The contract result for the text (plus the two header dumps in chunk mode). */
export function explain(text, opts) {
  const options = {};
  if (opts.node !== undefined) options.nodeVersion = opts.node;
  if (opts.client !== undefined) options.client = opts.client;
  if (opts.only) options.only = MODULES[opts.only].family;
  const result = opts.only === 'chunk-cache-explainer' ? EMPTY : diagnose(text, options);
  if (!opts.chunkMode) return result;
  const headers = diagnoseHeaders({
    htmlHeaders: opts.htmlHeaders !== undefined ? readFileArg(opts.htmlHeaders, '--html-headers') : '',
    chunkHeaders: opts.chunkHeaders !== undefined ? readFileArg(opts.chunkHeaders, '--chunk-headers') : '',
  });
  // Same order as diagnose(): severity, then family order, then the module's own order.
  const all = [...result.results, ...headers.results]
    .map((d, i) => ({ d, i }))
    .sort((x, y) => SEVERITY_ORDER[x.d.severity] - SEVERITY_ORDER[y.d.severity]
      || FAMILIES.indexOf(x.d.family) - FAMILIES.indexOf(y.d.family) || x.i - y.i)
    .map((x) => x.d);
  return { version: result.version, matched: all.length > 0, redactions: result.redactions + headers.redactions, results: all };
}

// ─── Output ─────────────────────────────────────────────────────────────────

function palette(enabled) {
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return { bold: wrap(1, 22), dim: wrap(2, 22), red: wrap(31, 39), yellow: wrap(33, 39), cyan: wrap(36, 39), green: wrap(32, 39) };
}

const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function formatHuman(result, text, c) {
  const out = [];
  const sev = (s) => (s === 'critical' ? c.red(`[${s}]`) : s === 'warning' ? c.yellow(`[${s}]`) : s ? c.dim(`[${s}]`) : '');
  const lines = buildEvidenceLines(text);
  for (const group of groupByModule(result.results)) {
    out.push(c.bold(c.cyan(`== ${group.label} (${group.module}) ==`)));
    group.diagnoses.forEach((d, i) => {
      out.push('');
      out.push(`${c.bold(`${i + 1}. ${d.title}`)} ${sev(d.severity)} ${c.dim(d.rule)}`.trimEnd());
      const ev = lines.get(d.rule);
      if (ev) out.push(indent(`${c.dim('Evidence:')} line ${ev.lineNo}: ${ev.line}`, 3));
      if (d.cause) out.push(indent(`${c.bold('Cause:')} ${d.cause}`, 3));
      if (d.why) out.push(indent(`${c.bold('Why:')} ${d.why}`, 3));
      if (d.fixes.length) {
        out.push(indent(c.bold('Fixes:'), 3));
        d.fixes.forEach((x, j) => {
          const head = [x.title, x.detail].filter(Boolean).join(' — ');
          out.push(indent(`${j + 1}) ${head || 'Fix'}`, 5));
          if (x.code) out.push(c.green(indent(x.code, 9)));
        });
      }
      const [first, ...more] = d.evidence;
      if (first) out.push(indent(`${c.dim('Source:')} ${first.url}`, 3));
      if (more.length) out.push(indent(`${c.dim('See also:')} ${more.map((e) => e.url).join(' · ')}`, 3));
    });
    out.push('');
  }
  if (result.redactions > 0) out.push(c.dim(`(${result.redactions} secret value(s) in the input were masked before analysis.)`), '');
  return out.join('\n');
}

function packageVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  return pkg.version;
}

const UNRECOGNISED = 'No known error recognised — nothing guessed.\n'
  + 'Supported: CORS console errors, ESM/CommonJS (ERR_REQUIRE_ESM, "Cannot use import statement"…), '
  + 'npm ERESOLVE logs, Next.js build/dev errors, postgres:// connection strings, '
  + 'Postgres connection errors (ECONNREFUSED on 5432, Prisma P1001, pg_hba.conf…), '
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
  if (opts.version) { stdout.write(`${packageVersion()}\n`); return EXIT.ok; }

  let input;
  let result;
  try {
    input = await readInput(opts);
    result = explain(input.text, opts);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    stderr.write(`dev-error-explainers: ${err.message}\n`);
    return EXIT.usage;
  }

  if (opts.json) {
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.matched) {
    const color = Boolean(stdout.isTTY) && !('NO_COLOR' in process.env);
    stdout.write(formatHuman(result, input.text, palette(color)));
  } else {
    stdout.write(`${UNRECOGNISED}\n`);
  }
  return result.matched ? EXIT.ok : EXIT.unrecognised;
}

const crash = (err) => {
  process.stderr.write(`dev-error-explainers: unexpected error: ${err && err.message ? err.message : err}\n`);
  process.exitCode = EXIT.crash;
};

if (process.argv[2] === 'mcp') {
  // `dev-error-explainers mcp`: the MCP stdio server lives in bin/mcp.js (also
  // installed as the dev-error-explainers-mcp binary); importing it starts it.
  import('./mcp.js').catch(crash);
} else {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, crash);
}
