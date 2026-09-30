#!/usr/bin/env node
// dev-error-explainers MCP server — one tool, `explain_error`, over stdio.
//
// Zero dependencies: the MCP stdio transport is implemented by hand
// (newline-delimited JSON-RPC 2.0 on stdin/stdout; logs go to stderr only).
//
// Dual-era, per the 2026-07-28 specification ("Versioning and Compatibility"):
//   - modern  (2026-07-28): stateless. Every request carries
//     `_meta["io.modelcontextprotocol/protocolVersion"]` and
//     `_meta["io.modelcontextprotocol/clientCapabilities"]`; `server/discover`
//     is implemented; results carry `resultType: "complete"`.
//   - legacy  (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05): the
//     `initialize` → `notifications/initialized` handshake, scoped to this
//     stdio process.
//
// Diagnosis: `src/contract.js` `diagnose(text, options)` — the same normalised
// result the CLI prints with --json and the GitHub Action renders. Every string
// of the result (text AND structuredContent) is passed through
// `src/redact.js` `redact()` again before it leaves the process.
//
// Also started by `dev-error-explainers mcp` (bin/cli.js imports this file).

import { readFileSync } from 'node:fs';
import { diagnose } from '../src/contract.js';
import { redact } from '../src/redact.js';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const SERVER_INFO = {
  name: 'dev-error-explainers',
  title: 'Dev error explainers',
  version: PKG.version,
};

const MODERN_VERSIONS = ['2026-07-28'];
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const ALL_VERSIONS = [...MODERN_VERSIONS, ...LEGACY_VERSIONS];
// structuredContent / outputSchema exist from 2025-06-18 onward.
const supportsStructured = (v) => v >= '2025-06-18';
const isModern = (v) => MODERN_VERSIONS.includes(v);

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER = 'io.modelcontextprotocol/serverInfo';

const ERR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  unsupportedVersion: -32022,
};

const MAX_ERROR_BYTES = 200 * 1024;
const MAX_LINE_CHARS = 8 * 1024 * 1024;
const CLIENTS = ['prisma', 'drizzle', 'pg', 'psql'];

const log = (msg) => process.stderr.write(`[dev-error-explainers-mcp] ${msg}\n`);

// ─── The tool ───────────────────────────────────────────────────────────────

const INSTRUCTIONS = 'Call explain_error with the exact error text or log excerpt a developer is stuck on '
  + '(Node.js, npm, Next.js build, browser CORS console errors, Postgres/Supabase connection strings and connection errors). '
  + 'It is offline and deterministic: it either recognises the error and returns the documented cause and fix, '
  + 'or says it recognised nothing. It never guesses.';

const TOOL_DESCRIPTION = [
  'Explain a concrete developer error message or log excerpt and return its documented cause and fix.',
  '',
  'Call it when the user pastes (or you captured from a terminal/browser console) an actual error, for example:',
  '- Node.js ESM/CommonJS errors: ERR_REQUIRE_ESM, ERR_MODULE_NOT_FOUND, "Cannot use import statement outside a module", "require is not defined in ES module scope".',
  '- npm ERESOLVE / peer-dependency conflict logs from npm install.',
  '- Next.js `next build` / `next dev` output (module not found, heap out of memory, server/client component errors, prerender failures).',
  '- Browser CORS console errors ("has been blocked by CORS policy", preflight, Access-Control-Allow-Origin).',
  '- A postgres:// or postgresql:// connection string (DATABASE_URL, Supabase pooler/direct URLs) that fails to connect.',
  '- Postgres connection errors from Node.js apps: connect ECONNREFUSED / ETIMEDOUT on 5432, getaddrinfo ENOTFOUND, Prisma P1000/P1001/P1017, "password authentication failed", "no pg_hba.conf entry", "too many clients", self-signed certificate.',
  'Pass the raw text verbatim, including the stack trace and the "Node.js vX" footer when present; do not paraphrase it.',
  '',
  'Returns a short human-readable diagnosis (cause, why, ranked fixes with code, official source links) plus the same result as structured JSON.',
  'If nothing is recognised it answers "No known error recognised — nothing guessed"; then rely on your own reasoning.',
  '',
  'Fully offline and deterministic: no network, no LLM, same input gives the same output. Secrets it can recognise (URL passwords, Bearer/Basic tokens, JWTs, token/key query parameters) are masked in the output.',
].join('\n');

const INPUT_SCHEMA = {
  type: 'object',
  properties: {
    error: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_ERROR_BYTES,
      description: 'The raw error message or log excerpt, verbatim (max ~200 KB). Include the lines around the error: stack trace, npm log block, "Node.js vX" footer, or the full connection string.',
    },
    node_version: {
      type: 'string',
      maxLength: 32,
      description: 'Optional Node.js version in use (e.g. "20.10.0"), used to tailor ESM/CommonJS advice. Usually detected from the error text itself.',
    },
    client: {
      type: 'string',
      enum: CLIENTS,
      description: 'Optional database client for connection-string advice (default prisma).',
    },
  },
  required: ['error'],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    tool: { type: 'string', description: 'Always "dev-error-explainers".' },
    version: { type: 'string', description: 'Package version that produced the result.' },
    engine: { type: 'string', enum: ['contract'], description: 'The code path that produced the diagnosis (src/contract.js).' },
    matched: { type: 'boolean', description: 'True when at least one explainer recognised the input.' },
    redactions: { type: 'integer', minimum: 0, description: 'Number of values masked in the output.' },
    results: {
      type: 'array',
      description: 'One Diagnosis per finding, most severe first (docs/CONTRACT.md); empty when matched is false.',
      items: { type: 'object' },
    },
  },
  required: ['tool', 'version', 'engine', 'matched', 'redactions', 'results'],
};

function toolDefinition(version) {
  const tool = {
    name: 'explain_error',
    title: 'Explain a developer error',
    description: TOOL_DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    annotations: {
      title: 'Explain a developer error',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
  if (supportsStructured(version)) tool.outputSchema = OUTPUT_SCHEMA;
  return tool;
}

// ─── Engine ─────────────────────────────────────────────────────────────────

function runContract(text, { nodeVersion, client }) {
  const options = {};
  if (nodeVersion) options.nodeVersion = nodeVersion;
  if (client) options.client = client;
  return diagnose(text, options);
}

/**
 * Mask every string of a JSON value; returns [masked, count]. redact() is
 * placeholder-aware and idempotent, so `[YOUR-PASSWORD]` templates and values
 * the contract already masked are left alone.
 */
function maskDeep(value) {
  let changed = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      const r = redact(v);
      changed += r.redactions;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return [walk(value), changed];
}

// ─── Human-readable text ────────────────────────────────────────────────────

const s = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function formatFinding(d, i, out) {
  out.push(`${i + 1}. ${d.title} [${d.severity}] (${d.rule})`);
  if (s(d.cause)) out.push(`   Cause: ${d.cause}`);
  if (s(d.why)) out.push(`   Why: ${d.why}`);
  if (d.fixes.length) {
    out.push('   Fixes:');
    d.fixes.forEach((x, j) => {
      const head = [s(x.title), s(x.detail)].filter(Boolean).join(' — ');
      out.push(`   ${j + 1}) ${head || 'Fix'}`);
      if (s(x.code)) out.push('```', x.code.trimEnd(), '```');
    });
  }
  const sources = d.evidence.map((e) => e.url).slice(0, 3);
  if (sources.length) out.push(`   Source${sources.length > 1 ? 's' : ''}: ${sources.join(' · ')}`);
}

function formatText(result) {
  if (!result.matched) {
    return 'No known error recognised — nothing guessed.\n'
      + 'Supported: Node.js ESM/CommonJS errors (ERR_REQUIRE_ESM…), npm ERESOLVE logs, Next.js build/dev errors, '
      + 'browser CORS console errors, postgres:// / postgresql:// connection strings, and Postgres connection errors '
      + '(ECONNREFUSED on 5432, Prisma P1001, pg_hba.conf…). '
      + 'Paste the verbatim error text including the surrounding lines.';
  }
  const out = [`${result.results.length} diagnosis${result.results.length > 1 ? 'es' : ''} (most severe first):`];
  result.results.forEach((d, i) => { formatFinding(d, i, out); out.push(''); });
  if (result.redactions > 0) out.push(`(${result.redactions} secret value(s) masked in this output.)`);
  return out.join('\n').trim();
}

// ─── tools/call ─────────────────────────────────────────────────────────────

function toolError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

async function callExplainError(args, version) {
  const a = args || {};
  if (typeof a.error !== 'string' || !a.error.trim()) {
    return toolError('Invalid arguments: "error" must be a non-empty string containing the raw error message or log excerpt.');
  }
  if (Buffer.byteLength(a.error, 'utf8') > MAX_ERROR_BYTES) {
    return toolError(`Invalid arguments: "error" is larger than ${MAX_ERROR_BYTES / 1024} KB. Pass only the relevant excerpt (the error line, its stack trace and a few lines around it).`);
  }
  if (a.node_version !== undefined && (typeof a.node_version !== 'string' || a.node_version.length > 32)) {
    return toolError('Invalid arguments: "node_version" must be a short version string such as "20.10.0".');
  }
  if (a.client !== undefined && !CLIENTS.includes(a.client)) {
    return toolError(`Invalid arguments: "client" must be one of ${CLIENTS.join(', ')}.`);
  }
  const unknown = Object.keys(a).filter((k) => !['error', 'node_version', 'client'].includes(k));
  if (unknown.length) return toolError(`Invalid arguments: unknown field(s) ${unknown.join(', ')}.`);

  const raw = runContract(a.error, { nodeVersion: s(a.node_version), client: a.client });
  const [results, changed] = maskDeep(raw.results);
  const structured = {
    tool: 'dev-error-explainers',
    version: PKG.version,
    engine: 'contract',
    matched: Boolean(raw.matched) && results.length > 0,
    redactions: (raw.redactions || 0) + changed,
    results,
  };
  const result = { content: [{ type: 'text', text: maskDeep(formatText(structured))[0] }], isError: false };
  if (supportsStructured(version)) result.structuredContent = structured;
  return result;
}

// ─── JSON-RPC dispatch ──────────────────────────────────────────────────────

class RpcError extends Error {
  constructor(code, message, data) { super(message); this.code = code; this.data = data; }
}

let legacyVersion = null; // set by `initialize`, scoped to this process

function negotiateLegacy(requested) {
  return LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
}

/** Protocol version for a request: per-request _meta (modern) or the handshake (legacy). */
function requestVersion(params) {
  const meta = params && typeof params === 'object' ? params._meta : undefined;
  if (meta && typeof meta === 'object' && META_VERSION in meta) {
    const v = meta[META_VERSION];
    if (typeof v !== 'string') throw new RpcError(ERR.invalidParams, `_meta["${META_VERSION}"] must be a string`);
    if (!ALL_VERSIONS.includes(v)) {
      throw new RpcError(ERR.unsupportedVersion, 'Unsupported protocol version', { supported: ALL_VERSIONS, requested: v });
    }
    if (isModern(v) && !(META_CAPS in meta && meta[META_CAPS] && typeof meta[META_CAPS] === 'object')) {
      throw new RpcError(ERR.invalidParams, `Missing required _meta["${META_CAPS}"]`);
    }
    return v;
  }
  if (legacyVersion) return legacyVersion;
  throw new RpcError(ERR.invalidParams,
    `Missing required _meta["${META_VERSION}"]; send it on every request (protocol ${MODERN_VERSIONS[0]}) `
    + `or open a legacy session with "initialize" (supported: ${LEGACY_VERSIONS.join(', ')}).`,
    { supported: ALL_VERSIONS });
}

function finish(result, version) {
  if (!isModern(version)) return result;
  return { resultType: 'complete', ...result, _meta: { ...(result._meta || {}), [META_SERVER]: SERVER_INFO } };
}

async function handleRequest(method, params) {
  if (params !== undefined && (params === null || typeof params !== 'object' || Array.isArray(params))) {
    throw new RpcError(ERR.invalidParams, 'params must be an object');
  }
  switch (method) {
    case 'initialize': {
      if (!params || typeof params.protocolVersion !== 'string') {
        throw new RpcError(ERR.invalidParams, 'initialize requires params.protocolVersion (string)');
      }
      legacyVersion = negotiateLegacy(params.protocolVersion);
      const who = params.clientInfo && params.clientInfo.name ? ` from ${params.clientInfo.name}` : '';
      log(`initialize${who}: requested ${params.protocolVersion}, using ${legacyVersion}`);
      return {
        protocolVersion: legacyVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case 'ping': {
      let v = null;
      try { v = requestVersion(params); } catch { /* ping is valid before the handshake */ }
      return v ? finish({}, v) : {};
    }
    case 'server/discover': {
      const v = requestVersion(params);
      return finish({ supportedVersions: MODERN_VERSIONS, capabilities: { tools: {} }, instructions: INSTRUCTIONS }, v);
    }
    case 'tools/list': {
      const v = requestVersion(params);
      return finish({ tools: [toolDefinition(v)] }, v);
    }
    case 'tools/call': {
      const v = requestVersion(params);
      if (!params || typeof params.name !== 'string') throw new RpcError(ERR.invalidParams, 'tools/call requires params.name (string)');
      if (params.name !== 'explain_error') throw new RpcError(ERR.invalidParams, `Unknown tool: ${params.name}`);
      if (params.arguments !== undefined && (params.arguments === null || typeof params.arguments !== 'object' || Array.isArray(params.arguments))) {
        throw new RpcError(ERR.invalidParams, 'tools/call params.arguments must be an object');
      }
      return finish(await callExplainError(params.arguments, v), v);
    }
    default:
      throw new RpcError(ERR.methodNotFound, `Method not found: ${method}`);
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id: id === undefined ? null : id, error });
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    sendError(null, ERR.invalidRequest, 'Invalid Request: expected a single JSON-RPC object (batches are not supported)');
    return;
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  const validId = hasId && (typeof msg.id === 'string' || (typeof msg.id === 'number' && Number.isInteger(msg.id)));
  if (msg.jsonrpc !== '2.0' || (hasId && !validId)) {
    sendError(validId ? msg.id : null, ERR.invalidRequest, 'Invalid Request: jsonrpc must be "2.0" and id a string or integer');
    return;
  }
  if (typeof msg.method !== 'string') {
    if (!hasId) sendError(null, ERR.invalidRequest, 'Invalid Request: missing method');
    else if (!('result' in msg) && !('error' in msg)) sendError(msg.id, ERR.invalidRequest, 'Invalid Request: missing method');
    return; // responses from the client are ignored: this server never sends requests
  }
  if (!hasId) {
    // Notifications (notifications/initialized, notifications/cancelled, …): never answered.
    if (msg.method === 'notifications/initialized') log('client initialized');
    return;
  }
  try {
    const result = await handleRequest(msg.method, msg.params);
    send({ jsonrpc: '2.0', id: msg.id, result });
  } catch (err) {
    if (err instanceof RpcError) sendError(msg.id, err.code, err.message, err.data);
    else {
      log(`internal error on ${msg.method}: ${err && err.stack ? err.stack : err}`);
      sendError(msg.id, ERR.internal, 'Internal error');
    }
  }
}

// ─── stdio transport ────────────────────────────────────────────────────────

const inFlight = new Set();

function onLine(line) {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    sendError(null, ERR.parse, 'Parse error');
    return;
  }
  const p = handleMessage(msg).catch((err) => log(`unhandled: ${err && err.stack ? err.stack : err}`));
  inFlight.add(p);
  p.finally(() => inFlight.delete(p));
}

let buffer = '';
let discarding = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).replace(/\r$/, '');
    buffer = buffer.slice(nl + 1);
    if (discarding) { discarding = false; continue; }
    onLine(line);
  }
  if (buffer.length > MAX_LINE_CHARS) {
    buffer = '';
    discarding = true;
    sendError(null, ERR.invalidRequest, `Invalid Request: message larger than ${MAX_LINE_CHARS} characters`);
  }
});
process.stdin.on('end', async () => {
  if (buffer.trim() && !discarding) onLine(buffer.replace(/\r$/, ''));
  buffer = '';
  // Finish in-flight calls before the process exits.
  while (inFlight.size) await Promise.allSettled([...inFlight]);
});

log(`v${PKG.version} ready on stdio (protocols: ${ALL_VERSIONS.join(', ')})`);
