// dev-error-explainers — GitHub Action entry point.
//
// Reads a log the user teed from a failing CI step, runs the explainers of this
// SAME repository on it (relative import of ../src, never npm — the action and
// the library are always the same version), and reports:
//   - a Markdown section per finding in the job summary ($GITHUB_STEP_SUMMARY);
//   - annotations: file/line ones only when the log names a file that exists in
//     the workspace near the error, otherwise one job-level annotation per finding;
//   - outputs: recognised, families, summary-md.
//
// The diagnosis is src/contract.js `diagnose()` — the same normalised result the
// CLI prints with --json and the MCP server returns. Display helpers shared with
// the CLI live in src/format.js.
//
// Zero dependencies (no @actions/core). No network. Every string written to the
// summary, the annotations or the outputs goes through mask() (src/redact.js) first.
//
// Exit codes: 0 done (recognised or not) · 1 bad input, crash, or nothing
// recognised with fail-on-unrecognised: true.

import { randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from '../src/contract.js';
import { redact } from '../src/redact.js';
import { groupByModule, buildEvidenceLines } from '../src/format.js';

const MAX_READ_BYTES = 2 * 1024 * 1024; // read at most the last 2 MB of the log
const ENGINE_WINDOW = 50000; // the explainers' own input cap; the error is at the end
const MAX_OUTPUT_CHARS = 60000; // keep summary-md well under the 1 MiB summary limit

// ─── Secret masking ─────────────────────────────────────────────────────────

/** Every string written anywhere goes through here (the library's redact()). */
export function mask(input) {
  if (input === null || input === undefined) return '';
  return redact(String(input)).text;
}

// ─── Inputs / outputs / workflow commands ───────────────────────────────────

class InputError extends Error {}

function getInput(name) {
  const v = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`];
  return typeof v === 'string' ? v.trim() : '';
}

function getBoolean(name, fallback) {
  const v = getInput(name);
  if (!v) return fallback;
  if (['true', 'True', 'TRUE'].includes(v)) return true;
  if (['false', 'False', 'FALSE'].includes(v)) return false;
  throw new InputError(`input "${name}" must be true or false (got "${v}")`);
}

function getInt(name, fallback) {
  const v = getInput(name);
  if (!v) return fallback;
  if (!/^\d+$/.test(v)) throw new InputError(`input "${name}" must be a non-negative integer (got "${v}")`);
  return Number(v);
}

// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
export const escapeData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function command(level, props, message) {
  const p = Object.entries(props)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${escapeProperty(v)}`)
    .join(',');
  return `::${level}${p ? ` ${p}` : ''}::${escapeData(message)}`;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const v = String(value);
  let delim;
  do { delim = `ghadelimiter_${randomBytes(12).toString('hex')}`; } while (v.includes(delim));
  appendFileSync(file, `${name}<<${delim}\n${v}\n${delim}\n`, 'utf8');
}

function appendSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${md}\n`, 'utf8');
}

// ─── Reading the log ────────────────────────────────────────────────────────

function readTail(file) {
  const size = statSync(file).size;
  const length = Math.min(size, MAX_READ_BYTES);
  const buf = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, length, size - length); } finally { closeSync(fd); }
  let text = buf.toString('utf8');
  if (size > length) text = text.slice(text.indexOf('\n') + 1); // drop the cut first line
  return { text, truncated: size > length, size };
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g;

function engineWindow(raw) {
  const clean = raw.replace(ANSI_RE, '').replace(/\r\n/g, '\n');
  if (clean.length <= ENGINE_WINDOW) return clean;
  const tail = clean.slice(-ENGINE_WINDOW);
  return tail.slice(tail.indexOf('\n') + 1);
}

// ─── Running the explainers (src/contract.js) ──────────────────────────────

/**
 * The contract result for the log window, grouped by module for display. Each
 * Diagnosis gets two display-only fields the contract shape does not carry:
 * `logLine` / `anchorLine`, the log line a next-build rule matched (used to
 * print the evidence and to anchor a file/line annotation).
 */
export function explainLog(text, { nodeVersion } = {}) {
  if (!text.trim()) return { redactions: 0, groups: [] };
  const options = nodeVersion ? { nodeVersion } : {};
  const result = diagnose(text, options);
  const lines = buildEvidenceLines(text);
  const results = result.results.map((d) => {
    const ev = lines.get(d.rule);
    return ev ? { ...d, logLine: ev.line, anchorLine: ev.lineNo - 1 } : { ...d };
  });
  return { redactions: result.redactions, groups: groupByModule(results) };
}

// ─── File/line locations ────────────────────────────────────────────────────

// tsc: path(line,col)          node / webpack / eslint: path:line[:col]
const TS_LOC_RE = /((?:[A-Za-z]:)?[^\s()'"`<>:|]*[^\s()'"`<>:|/\\]\.[A-Za-z0-9]{1,6})\((\d+),(\d+)\)/g;
const COLON_LOC_RE = /((?:file:\/\/)?(?:[A-Za-z]:)?[^\s()'"`<>:|,]*[^\s()'"`<>:|,/\\]\.[A-Za-z0-9]{1,6}):(\d+)(?::(\d+))?/g;

function toWorkspacePath(rawPath, workspace) {
  let p = rawPath.replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1); // file:///C:/…
  if (/(^|[\\/])node_modules[\\/]/.test(p) || p.startsWith('node:') || p.startsWith('internal/')) return null;
  const abs = isAbsolute(p) ? resolve(p) : resolve(workspace, p);
  const rel = relative(workspace, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null; // outside the checkout
  if (!existsSync(abs)) return null; // only files that are really there
  try { if (!statSync(abs).isFile()) return null; } catch { return null; }
  return rel.split(sep).join('/');
}

export function locationsInLine(line, workspace) {
  const found = [];
  for (const re of [TS_LOC_RE, COLON_LOC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const file = toWorkspacePath(m[1], workspace);
      const ln = Number(m[2]);
      if (file && ln > 0) found.push({ file, line: ln, col: m[3] ? Number(m[3]) : null });
    }
  }
  return found;
}

const CODE_RE = /\b(ERR_[A-Z0-9_]+|E[A-Z]{4,}|TS\d{4})\b/;

function anchorOf(f, lines) {
  if (Number.isInteger(f.anchorLine) && f.anchorLine >= 0 && f.anchorLine < lines.length) return f.anchorLine;
  const code = (`${f.title} ${f.rule}`.match(CODE_RE) || [])[1];
  if (!code) return null;
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].includes(code)) return i;
  return null;
}

/** Nearest file:line within a small window around the line the finding comes from. */
export function locate(f, lines, workspace) {
  const a = anchorOf(f, lines);
  if (a === null) return null;
  let best = null;
  for (let i = Math.max(0, a - 3); i <= Math.min(lines.length - 1, a + 8); i++) {
    const locs = locationsInLine(lines[i], workspace);
    if (!locs.length) continue;
    const dist = Math.abs(i - a) + (i < a ? 0 : 0.5); // tie → the line printed before the error
    if (!best || dist < best.dist) best = { ...locs[0], dist };
  }
  return best ? { file: best.file, line: best.line, col: best.col } : null;
}

// ─── Markdown ───────────────────────────────────────────────────────────────

function fence(code, lang = '') {
  const runs = String(code).match(/`{3,}/g) || [];
  const n = Math.max(3, ...runs.map((r) => r.length + 1));
  const f = '`'.repeat(n);
  return `${f}${lang}\n${code}\n${f}`;
}

function inlineCode(s) {
  const t = String(s).replace(/\s+/g, ' ').trim().slice(0, 300);
  const runs = t.match(/`+/g) || [];
  const n = Math.max(1, ...runs.map((r) => r.length + 1));
  const f = '`'.repeat(n);
  return `${f} ${t} ${f}`;
}

// Prose from the explainers can name tags (`<Suspense>`, `app/api/<route>/…`):
// escaped so GitHub shows them instead of treating them as HTML.
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n');

function findingMarkdown(group, d, n, loc) {
  const out = [];
  out.push(`### ${n}. ${escapeHtml(d.title)}`);
  out.push(`_${group.label} · \`${d.rule}\` · ${d.severity}_`);
  out.push('');
  if (loc) out.push(`**Where:** \`${loc.file}:${loc.line}${loc.col ? `:${loc.col}` : ''}\``, '');
  if (d.logLine) out.push(`**Evidence:** ${inlineCode(d.logLine)}`, '');
  if (d.cause) out.push(`**Cause:** ${escapeHtml(d.cause)}`, '');
  if (d.why) out.push(`**Why:** ${escapeHtml(d.why)}`, '');
  if (d.fixes.length) {
    out.push('**Fixes**', '');
    d.fixes.forEach((x, i) => {
      const head = [x.title && `**${escapeHtml(x.title)}**`, x.detail && escapeHtml(x.detail)].filter(Boolean).join(' — ') || 'Fix';
      out.push(`${i + 1}. ${head}`);
      if (x.code) out.push('', indent(fence(x.code), 3), '');
    });
    out.push('');
  }
  const [first, ...more] = d.evidence;
  if (first) out.push(`**Source:** ${first.url}`, '');
  if (more.length) out.push(`**See also:** ${more.map((e) => e.url).join(' · ')}`, '');
  return out.join('\n');
}

export function buildSummary(groups, logName) {
  const total = groups.reduce((a, g) => a + g.diagnoses.length, 0);
  const out = [];
  if (!total) {
    out.push('## Explain CI error', '', '> No known error recognised — nothing guessed.', '');
    out.push('Supported: CORS console errors, ESM/CommonJS (`ERR_REQUIRE_ESM`, "Cannot use import statement"…), '
      + 'npm `ERESOLVE` logs, Next.js build errors, `postgres://` connection strings, '
      + 'Postgres connection errors (`ECONNREFUSED` on 5432, Prisma `P1001`, `pg_hba.conf`…).', '');
  } else {
    out.push(`## Explain CI error — ${total} finding${total > 1 ? 's' : ''}`, '');
    let n = 0;
    for (const g of groups) {
      for (const d of g.diagnoses) {
        n += 1;
        out.push(findingMarkdown(g, d, n, d.loc));
      }
    }
  }
  out.push('---', `Run locally: \`npx dev-error-explainers < ${logName}\``);
  let md = mask(out.join('\n'));
  if (md.length > MAX_OUTPUT_CHARS) md = `${md.slice(0, MAX_OUTPUT_CHARS)}\n\n…(truncated)`;
  return md;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const LEVEL = { critical: 'error', warning: 'warning', info: 'notice' };
const firstSentence = (s) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.{20,300}?[.!?](?=\s|$)/);
  return m ? m[0] : t.slice(0, 300);
};

/** Mask every string of a value (the contract already redacted its input; this also covers echoed log lines). */
function maskDeep(v) {
  if (typeof v === 'string') return mask(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = maskDeep(x);
    return o;
  }
  return v;
}

export async function main({ stdout = process.stdout } = {}) {
  const write = (line) => stdout.write(`${line}\n`);
  let opts;
  try {
    const logFile = getInput('log-file');
    if (!logFile) throw new InputError('input "log-file" is required (the log you teed from the failing step)');
    opts = {
      logFile,
      nodeVersion: getInput('node-version') || undefined,
      failOnUnrecognised: getBoolean('fail-on-unrecognised', false),
      maxAnnotations: getInt('max-annotations', 10),
    };
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    write(command('error', { title: 'dev-error-explainers' }, mask(err.message)));
    return 1;
  }

  const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const logPath = resolve(workspace, opts.logFile);
  let read;
  try {
    read = readTail(logPath);
  } catch (err) {
    write(command('error', { title: 'dev-error-explainers' },
      mask(`cannot read log-file "${opts.logFile}" (${err.code || err.message}) — tee the failing step into it first`)));
    return 1;
  }

  const text = engineWindow(read.text);
  const lines = text.split('\n');
  const { groups: raw } = explainLog(text, { nodeVersion: opts.nodeVersion });
  for (const g of raw) for (const d of g.diagnoses) d.loc = locate(d, lines, workspace);
  const groups = maskDeep(raw); // nothing unmasked past this line
  const all = groups.flatMap((g) => g.diagnoses);

  const md = buildSummary(groups, basename(opts.logFile));
  appendSummary(md);

  let budget = opts.maxAnnotations;
  if (!all.length) {
    if (budget > 0) {
      write(command(opts.failOnUnrecognised ? 'error' : 'notice', { title: 'dev-error-explainers' },
        'No known error recognised — nothing guessed'));
    }
  } else {
    for (const d of all) {
      if (budget <= 0) break;
      budget -= 1;
      const loc = d.loc;
      const level = LEVEL[d.severity] || 'error';
      const message = mask(`${firstSentence(d.cause || d.title)} See the job summary for the fix.`);
      const props = loc
        ? { file: loc.file, line: loc.line, col: loc.col, title: mask(d.title) }
        : { title: mask(d.title) };
      write(command(level, props, message));
    }
  }

  const families = groups.map((g) => g.module);
  setOutput('recognised', all.length ? 'true' : 'false');
  setOutput('families', families.join(','));
  setOutput('summary-md', md);
  write(`dev-error-explainers: ${all.length} finding(s)${families.length ? ` from ${families.join(', ')}` : ''}`
    + `${read.truncated ? ' (log larger than 2 MB: read the last 2 MB)' : ''}. Details in the job summary.`);

  return !all.length && opts.failOnUnrecognised ? 1 : 0;
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().then(
    (code) => { process.exitCode = code; },
    (err) => {
      process.stdout.write(`${command('error', { title: 'dev-error-explainers crashed' }, mask(err && err.message ? err.message : String(err)))}\n`);
      process.exitCode = 1;
    },
  );
}
