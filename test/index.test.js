import * as pkg from '../src/index.js';
import { detect, MODULES } from '../src/index.js';
import { diagnose as cors, EXAMPLES as CORS_EXAMPLES } from '../src/cors-error-explainer.js';
import { explain } from '../src/esm-cjs-explainer.js';
import { analyseEresolveLog, EXAMPLE_LOG } from '../src/npm-eresolve-explainer.js';
import { diagnose as chunk, EXAMPLE_HTML, EXAMPLE_CHUNK } from '../src/chunk-cache-explainer.js';
import { diagnose as dbUrl } from '../src/database-url-doctor.js';
import { decode, EXAMPLES as BUILD_EXAMPLES } from '../src/build-error-decoder.js';

describe('re-exports', () => {
  test('each main function is re-exported under a distinct name, unchanged', () => {
    expect(pkg.diagnoseCors).toBe(cors);
    expect(pkg.explainEsmCjs).toBe(explain);
    expect(pkg.analyseEresolveLog).toBe(analyseEresolveLog);
    expect(pkg.diagnoseChunkCache).toBe(chunk);
    expect(pkg.diagnoseDatabaseUrl).toBe(dbUrl);
    expect(pkg.decodeBuildError).toBe(decode);
  });

  test('MODULES lists the six modules', () => {
    expect(MODULES).toHaveLength(6);
    expect(new Set(MODULES).size).toBe(6);
  });
});

describe('detect', () => {
  test('CORS console error', () => {
    expect(detect("Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource."))
      .toEqual(['cors-error-explainer']);
  });

  test('every CORS example with error text is recognised by the CORS explainer', () => {
    for (const ex of CORS_EXAMPLES.filter((e) => e.error)) {
      expect(detect(ex.error)).toContain('cors-error-explainer');
    }
  });

  test('ERR_REQUIRE_ESM', () => {
    expect(detect('Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.'))
      .toEqual(['esm-cjs-explainer']);
  });

  test('npm ERESOLVE log', () => {
    expect(detect(EXAMPLE_LOG)).toEqual(['npm-eresolve-explainer']);
  });

  test('curl -I response headers', () => {
    expect(detect(EXAMPLE_HTML)).toEqual(['chunk-cache-explainer']);
    expect(detect(EXAMPLE_CHUNK)).toEqual(['chunk-cache-explainer']);
  });

  test('Postgres connection string, bare or as a DATABASE_URL line', () => {
    expect(detect('postgresql://postgres:pa@ss@db.abcd.supabase.co:5432/postgres')).toEqual(['database-url-doctor']);
    expect(detect('DATABASE_URL="postgres://u:p@localhost:5432/app"')).toEqual(['database-url-doctor']);
  });

  test('every build-error-decoder sample is recognised by the decoder', () => {
    for (const ex of BUILD_EXAMPLES) {
      expect(detect(ex.output)).toContain('build-error-decoder');
    }
  });

  test('unrecognised text gives an empty list, never a guess', () => {
    expect(detect('hello world')).toEqual([]);
    expect(detect('TypeError: Cannot read properties of undefined (reading "map")')).toEqual([]);
    expect(detect('mysql://u:p@h/db')).toEqual([]);
  });

  test('empty and non-string input', () => {
    expect(detect('')).toEqual([]);
    expect(detect('   \n')).toEqual([]);
    expect(detect(undefined)).toEqual([]);
    expect(detect(null)).toEqual([]);
    expect(detect(42)).toEqual([]);
  });

  test('deterministic and in MODULES order', () => {
    const text = `${EXAMPLE_LOG}\n${BUILD_EXAMPLES[0].output}`;
    const a = detect(text);
    expect(detect(text)).toEqual(a);
    expect(a).toEqual(expect.arrayContaining(['npm-eresolve-explainer', 'build-error-decoder']));
    expect([...a].sort((x, y) => MODULES.indexOf(x) - MODULES.indexOf(y))).toEqual(a);
  });

  test('never echoes the input', () => {
    const out = detect('postgresql://postgres:SuperSecret123@db.abcd.supabase.co:5432/postgres');
    expect(JSON.stringify(out)).not.toContain('SuperSecret123');
  });
});
