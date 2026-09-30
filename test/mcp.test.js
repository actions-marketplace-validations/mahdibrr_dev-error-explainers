import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EXAMPLES as CORS_EXAMPLES } from '../src/cors-error-explainer.js';

const SERVER = fileURLToPath(new URL('../bin/mcp.js', import.meta.url));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Real Node.js 18 output (same fixture as test/cli.test.js).
const REQUIRE_ESM = `/app/index.js:1
const fetch = require('node-fetch');
              ^

Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.
Instead change the require of /app/node_modules/node-fetch/src/index.js in /app/index.js to a dynamic import() which is available in all CommonJS modules.
    at Object.<anonymous> (/app/index.js:1:15) {
  code: 'ERR_REQUIRE_ESM'
}

Node.js v18.17.0`;
const CORS = CORS_EXAMPLES.find((e) => e.id === 'chrome-preflight-auth').error;
const UNRECOGNISED = 'The quick brown fox jumps over the lazy dog. Everything is fine here.';

// The server always uses src/contract.js.
const EXPECTED_ENGINE = 'contract';
// Contract results carry `family`.
const familiesOf = (sc) => sc.results.map((x) => x.family);

const MODERN_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'jest', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

/** Spawn the server and talk newline-delimited JSON-RPC to it. */
function startServer() {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [];
  const waiters = new Map();
  let buf = '';
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lines.push(line);
      const msg = JSON.parse(line); // every stdout line MUST be a JSON-RPC message
      const w = waiters.get(msg.id);
      if (w) { waiters.delete(msg.id); w({ msg, raw: line }); }
    }
  });
  const exited = new Promise((resolve) => child.on('close', (code) => resolve(code)));
  let nextId = 1;
  const write = (obj) => child.stdin.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n`);
  const request = (method, params, id = nextId++) => {
    const p = new Promise((resolve) => waiters.set(id, resolve));
    write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    return p;
  };
  const waitFor = (id) => new Promise((resolve) => waiters.set(id, resolve));
  const close = async () => { child.stdin.end(); return exited; };
  return { request, write, waitFor, close, lines, get stderr() { return stderr; } };
}

async function legacySession(version = '2025-11-25') {
  const s = startServer();
  const init = await s.request('initialize', {
    protocolVersion: version,
    capabilities: {},
    clientInfo: { name: 'jest', version: '1.0.0' },
  });
  s.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { s, init };
}

const call = (s, args, extra = {}) => s.request('tools/call', { name: 'explain_error', arguments: args, ...extra });

describe('mcp — legacy handshake (2025-11-25)', () => {
  let s;
  let init;
  beforeAll(async () => { ({ s, init } = await legacySession()); });
  afterAll(async () => {
    expect(await s.close()).toBe(0);
    for (const line of s.lines) expect(() => JSON.parse(line)).not.toThrow();
    expect(s.stderr).toContain('ready on stdio');
  });

  test('initialize returns the negotiated version, tools capability and serverInfo', () => {
    expect(init.msg.result.protocolVersion).toBe('2025-11-25');
    expect(init.msg.result.capabilities).toEqual({ tools: {} });
    expect(init.msg.result.serverInfo).toMatchObject({ name: 'dev-error-explainers', version: PKG.version });
  });

  test('notifications/initialized gets no response; ping answers {}', async () => {
    const { msg } = await s.request('ping');
    expect(msg.result).toEqual({});
    expect(s.lines.some((l) => JSON.parse(l).method)).toBe(false);
  });

  test('tools/list exposes exactly explain_error with input and output schemas', async () => {
    const { msg } = await s.request('tools/list', {});
    expect(msg.result.tools).toHaveLength(1);
    const [tool] = msg.result.tools;
    expect(tool.name).toBe('explain_error');
    expect(tool.inputSchema.required).toEqual(['error']);
    expect(tool.inputSchema.properties.client.enum).toEqual(['prisma', 'drizzle', 'pg', 'psql']);
    expect(tool.outputSchema.required).toEqual(expect.arrayContaining(['matched', 'results']));
    expect(tool.description).toMatch(/offline/i);
    expect(tool.annotations.readOnlyHint).toBe(true);
  });

  test('tools/call explains a real ERR_REQUIRE_ESM', async () => {
    const { msg } = await call(s, { error: REQUIRE_ESM });
    const r = msg.result;
    expect(r.isError).toBe(false);
    expect(r.content[0].type).toBe('text');
    expect(r.content[0].text).toContain('ERR_REQUIRE_ESM — require() of an ES module');
    expect(r.content[0].text).toContain('you are on 18.17.0');
    expect(r.content[0].text).toContain('https://nodejs.org/api/modules.html');
    expect(r.structuredContent.matched).toBe(true);
    expect(r.structuredContent.version).toBe(PKG.version);
    expect(familiesOf(r.structuredContent).some((x) => /^esm-cjs/.test(x))).toBe(true);
    expect(r.structuredContent.engine).toBe(EXPECTED_ENGINE);
  });

  test('node_version is honoured', async () => {
    const { msg } = await call(s, { error: REQUIRE_ESM.replace('Node.js v18.17.0', ''), node_version: '16.20.0' });
    expect(msg.result.content[0].text).toContain('you are on 16.20.0');
  });

  test('tools/call explains a Chrome CORS error with a server fix', async () => {
    const { msg } = await call(s, { error: CORS });
    const r = msg.result;
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('The preflight response does not allow the request header "authorization"');
    expect(r.content[0].text).toContain('export async function OPTIONS');
    expect(familiesOf(r.structuredContent)[0]).toMatch(/^cors/);
  });

  test('unrecognised input: says so, guesses nothing, isError false', async () => {
    const { msg } = await call(s, { error: UNRECOGNISED });
    const r = msg.result;
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toMatch(/^No known error recognised — nothing guessed/);
    expect(r.structuredContent).toMatchObject({ matched: false, results: [] });
  });

  test('unknown method → -32601', async () => {
    const { msg } = await s.request('resources/list', {});
    expect(msg.error.code).toBe(-32601);
    expect(msg.result).toBeUndefined();
  });

  test('unknown tool and malformed arguments → -32602', async () => {
    expect((await s.request('tools/call', { name: 'rm_rf', arguments: {} })).msg.error.code).toBe(-32602);
    expect((await s.request('tools/call', { name: 'explain_error', arguments: 'x' })).msg.error.code).toBe(-32602);
    expect((await s.request('tools/call', { arguments: {} })).msg.error.code).toBe(-32602);
  });

  test('invalid argument values are tool execution errors (isError true)', async () => {
    expect((await call(s, {})).msg.result.isError).toBe(true);
    expect((await call(s, { error: 'x', client: 'mysql' })).msg.result.isError).toBe(true);
    expect((await call(s, { error: 'x'.repeat(200 * 1024 + 1) })).msg.result.isError).toBe(true);
  });

  test('secrets are masked everywhere in the response, structuredContent included', async () => {
    // Assembled at runtime so no token-shaped literal lives in the source.
    const password = ['Pw', 'Zq', '9x'].join('') + String(7 * 11 * 13);
    const token = ['tk', 'Q'.repeat(18), '42'].join('');
    const bearer = ['bx', 'R'.repeat(22), '7'].join('');
    const ghToken = ['gh', 'p_', 'a1B2'.repeat(10)].join('');
    const text = [
      `Error: request failed, GITHUB_TOKEN=${ghToken}`,
      `Access to fetch at 'https://api.example.com/v1/items?token=${token}' from origin 'http://localhost:3000' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.`,
      `Authorization: Bearer ${bearer}`,
      `DATABASE_URL=postgresql://postgres:${password}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres`,
    ].join('\n');
    const { msg, raw } = await call(s, { error: text });
    expect(msg.result.isError).toBe(false);
    expect(msg.result.structuredContent.matched).toBe(true);
    for (const secret of [password, token, bearer, ghToken]) expect(raw).not.toContain(secret);
  });

  test('masking keeps documentation placeholders intact (no double masking)', async () => {
    const password = ['Sx', 'Pw', '4q'].join('') + String(3 * 37);
    const url = `postgresql://postgres.abcdefghijklmnopqrst:${password}@aws-1-eu-west-2.pooler.supabase.com:6543/postgres`;
    const { msg, raw } = await call(s, { error: url });
    expect(raw).not.toContain(password);
    // The output pass must not alter what the contract already masked
    // (e.g. rewriting a `[YOUR-PASSWORD]` template) nor count it twice.
    if (EXPECTED_ENGINE === 'contract') {
      const { diagnose } = await import('../src/contract.js');
      const expected = diagnose(url);
      expect(msg.result.structuredContent.results).toEqual(expected.results);
      expect(msg.result.structuredContent.redactions).toBe(expected.redactions);
    }
  });

  test('parse error → -32700 with id null', async () => {
    s.write('{not json');
    const { msg } = await s.waitFor(null);
    expect(msg.error.code).toBe(-32700);
  });
});

describe('mcp — version negotiation', () => {
  test('unknown requested version → the latest legacy version', async () => {
    const { s, init } = await legacySession('2099-01-01');
    expect(init.msg.result.protocolVersion).toBe('2025-11-25');
    await s.close();
  });

  test('2025-03-26: no outputSchema and no structuredContent', async () => {
    const { s, init } = await legacySession('2025-03-26');
    expect(init.msg.result.protocolVersion).toBe('2025-03-26');
    const list = await s.request('tools/list', {});
    expect(list.msg.result.tools[0].outputSchema).toBeUndefined();
    const r = (await call(s, { error: REQUIRE_ESM })).msg.result;
    expect(r.structuredContent).toBeUndefined();
    expect(r.content[0].text).toContain('ERR_REQUIRE_ESM');
    await s.close();
  });
});

describe('mcp — modern per-request _meta (2026-07-28)', () => {
  let s;
  beforeAll(() => { s = startServer(); });
  afterAll(async () => { expect(await s.close()).toBe(0); });

  test('server/discover lists versions, capabilities and serverInfo', async () => {
    const { msg } = await s.request('server/discover', { _meta: MODERN_META });
    expect(msg.result).toMatchObject({
      resultType: 'complete',
      supportedVersions: ['2026-07-28'],
      capabilities: { tools: {} },
    });
    expect(msg.result._meta['io.modelcontextprotocol/serverInfo'].version).toBe(PKG.version);
  });

  test('tools/call works without a handshake and carries resultType', async () => {
    const { msg } = await call(s, { error: CORS }, { _meta: MODERN_META });
    expect(msg.result.resultType).toBe('complete');
    expect(msg.result.structuredContent.matched).toBe(true);
  });

  test('unsupported version → -32022 with the supported list', async () => {
    const meta = { ...MODERN_META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' };
    const { msg } = await s.request('tools/list', { _meta: meta });
    expect(msg.error.code).toBe(-32022);
    expect(msg.error.data).toMatchObject({ requested: '1900-01-01' });
    expect(msg.error.data.supported).toContain('2026-07-28');
  });

  test('missing required _meta → -32602', async () => {
    const { 'io.modelcontextprotocol/clientCapabilities': _drop, ...noCaps } = MODERN_META;
    expect((await s.request('tools/list', { _meta: noCaps })).msg.error.code).toBe(-32602);
    expect((await s.request('tools/list', {})).msg.error.code).toBe(-32602);
  });
});
