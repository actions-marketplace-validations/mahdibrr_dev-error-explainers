import {
  explain,
  parseVersion,
  compareVersions,
  hasFeature,
  parsePackageJson,
  maskSecrets,
  extractFromError,
  normaliseExtension,
  RULE_IDS,
} from '../src/esm-cjs-explainer.js';

const ids = (r) => r.findings.map((f) => f.id);

// Real-world error shapes (Node.js output as reported on Stack Overflow / GitHub).
const REQUIRE_ESM = `/app/index.js:1
const fetch = require('node-fetch');
              ^

Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.
Instead change the require of /app/node_modules/node-fetch/src/index.js in /app/index.js to a dynamic import() which is available in all CommonJS modules.
    at Object.<anonymous> (/app/index.js:1:15) {
  code: 'ERR_REQUIRE_ESM'
}

Node.js v18.17.0`;

const IMPORT_OUTSIDE = `(node:12345) Warning: To load an ES module, set "type": "module" in the package.json or use the .mjs extension.
/home/me/project/server.js:1
import express from 'express';
^^^^^^

SyntaxError: Cannot use import statement outside a module
    at internalCompileFunction (node:internal/vm:76:18)`;

const EXPORTS_UNDEFINED = `file:///home/me/project/webpack.config.js:3
module.exports = {
^

ReferenceError: module is not defined in ES module scope
This file is being treated as an ES module because it has a '.js' file extension and '/home/me/project/package.json' contains "type": "module". To treat it as a CommonJS script, rename it to use the '.cjs' file extension.`;

const UNKNOWN_TS = `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts" for /app/src/index.ts
    at Object.getFileProtocolModuleFormat [as file:] (node:internal/modules/esm/get_format:160:9)
    at defaultGetFormat (node:internal/modules/esm/get_format:203:36) {
  code: 'ERR_UNKNOWN_FILE_EXTENSION'
}`;

const NOT_FOUND_EXT = `node:internal/modules/esm/resolve:265
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/utils' imported from /app/src/index.js
Did you mean to import "./utils.js"?
    at finalizeResolution (node:internal/modules/esm/resolve:265:11) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///app/src/utils'
}`;

const ASSERT_ERR = `file:///app/src/load.js:1
import config from './config.json' assert { type: 'json' };
                                   ^^^^^^

SyntaxError: Unexpected identifier 'assert'
    at compileSourceTextModule (node:internal/modules/esm/utils:340:16)

Node.js v22.11.0`;

const NOT_EXPORTED = `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/utils' is not defined by "exports" in /app/node_modules/some-lib/package.json
    at exportsNotFound (node:internal/modules/esm/resolve:314:10)`;

const NO_MAIN = `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: No "exports" main defined in /app/node_modules/uuid/package.json
    at new NodeError (node:internal/errors:405:5)`;

describe('semver helpers', () => {
  test('parseVersion accepts v-prefix, partial and pre-release forms', () => {
    expect(parseVersion('v22.12.0').raw).toBe('22.12.0');
    expect(parseVersion('20').raw).toBe('20.0.0');
    expect(parseVersion('23.6').raw).toBe('23.6.0');
    expect(parseVersion('24.0.0-rc.1').raw).toBe('24.0.0');
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  test('compareVersions orders numerically, not lexically', () => {
    expect(compareVersions('22.12.0', '22.9.0')).toBeGreaterThan(0);
    expect(compareVersions('20.19.0', '20.19.0')).toBe(0);
    expect(compareVersions('9.0.0', '10.0.0')).toBeLessThan(0);
    expect(Number.isNaN(compareVersions('x', '1.0.0'))).toBe(true);
  });

  test('hasFeature honours per-line backports and gaps (21.x never got require(esm) by default)', () => {
    expect(hasFeature('22.12.0', 'requireEsmDefault')).toBe(true);
    expect(hasFeature('22.11.0', 'requireEsmDefault')).toBe(false);
    expect(hasFeature('20.19.0', 'requireEsmDefault')).toBe(true);
    expect(hasFeature('20.18.3', 'requireEsmDefault')).toBe(false);
    expect(hasFeature('21.7.3', 'requireEsmDefault')).toBe(false);
    expect(hasFeature('23.0.0', 'requireEsmDefault')).toBe(true);
    expect(hasFeature('22.18.0', 'stripTypesDefault')).toBe(true);
    expect(hasFeature('22.17.1', 'stripTypesDefault')).toBe(false);
    expect(hasFeature('23.5.0', 'stripTypesDefault')).toBe(false);
    expect(hasFeature('23.6.0', 'stripTypesDefault')).toBe(true);
    expect(hasFeature('22.6.0', 'stripTypesFlag')).toBe(true);
    expect(hasFeature('22.5.1', 'stripTypesFlag')).toBe(false);
    expect(hasFeature('26.0.0', 'transformTypesFlag')).toBe(false);
    expect(hasFeature('24.1.0', 'transformTypesFlag')).toBe(true);
    expect(hasFeature(null, 'requireEsmDefault')).toBeNull();
  });
});

describe('ERR_REQUIRE_ESM', () => {
  test('old Node (18.17.0 from the log) → import() and upgrade advice, version read from the error', () => {
    const r = explain({ error: REQUIRE_ESM, nodeVersion: '' });
    expect(ids(r)).toEqual(['require-esm']);
    expect(r.context.nodeVersion).toBe('18.17.0');
    expect(r.context.versionSource).toBe('error');
    const f = r.findings[0];
    expect(f.fixes[0].title).toMatch(/Upgrade Node\.js/);
    expect(f.fixes.some((x) => /await import\('node-fetch'\)/.test(x.code))).toBe(true);
    // 18.x never had the flag → no flag suggestion.
    expect(f.fixes.some((x) => /--experimental-require-module/.test(x.code))).toBe(false);
    expect(f.source.url).toMatch(/^https:\/\/nodejs\.org\//);
  });

  test('20.17.0 → flag suggestion is offered (flag added in 22.0.0 / 20.17.0)', () => {
    const err = REQUIRE_ESM.replace('Node.js v18.17.0', '');
    const r = explain({ error: err, nodeVersion: '20.17.0' });
    expect(r.findings[0].fixes.some((x) => /--experimental-require-module/.test(x.code))).toBe(true);
  });

  test('22.12.0 → says Node itself should not throw this; look for another binary or a flag', () => {
    const err = REQUIRE_ESM.replace('Node.js v18.17.0', '');
    const r = explain({ error: err, nodeVersion: 'v22.12.0' });
    const f = r.findings[0];
    expect(f.cause).toMatch(/22\.12\.0/);
    expect(f.fixes[0].title).toMatch(/Check which Node\.js actually ran/);
    expect(f.source.url).toBe('https://nodejs.org/en/blog/release/v22.12.0');
  });

  test('typed version disagreeing with the logged one produces a note and uses the logged one', () => {
    const r = explain({ error: REQUIRE_ESM, nodeVersion: '22.12.0' });
    expect(r.context.nodeVersion).toBe('18.17.0');
    expect(r.notes.join(' ')).toMatch(/actually ran/);
  });

  test('ERR_REQUIRE_ASYNC_MODULE supersedes ERR_REQUIRE_ESM', () => {
    const err = `Error [ERR_REQUIRE_ASYNC_MODULE]: require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla.`;
    const r = explain({ error: err, nodeVersion: '22.12.0' });
    expect(ids(r)).toEqual(['require-async-module']);
  });
});

describe('Cannot use import statement outside a module', () => {
  test('no "type" + Node 20.11.0 (before syntax detection) → rename to .mjs first, upgrade offered', () => {
    const r = explain({ error: IMPORT_OUTSIDE, packageJson: '{"name":"app","main":"server.js"}', nodeVersion: '20.11.0' });
    expect(ids(r)).toEqual(['import-outside-module']);
    const f = r.findings[0];
    expect(f.fixes[0].title).toMatch(/\.mjs/);
    expect(f.fixes.some((x) => /upgrade/i.test(x.title))).toBe(true);
    expect(f.why).toMatch(/22\.7\.0, 20\.19\.0/);
  });

  test('no "type" + Node 22.12.0 (syntax detection on) → points at a tool loading as CJS', () => {
    const r = explain({ error: IMPORT_OUTSIDE, packageJson: '"main": "server.js"', nodeVersion: '22.12.0' });
    expect(r.findings[0].cause).toMatch(/syntax detection/);
    expect(r.findings[0].source.url).toMatch(/syntax-detection/);
  });

  test('"type": "commonjs" → rename this one file, not the whole package', () => {
    const r = explain({ error: IMPORT_OUTSIDE, packageJson: '{"type":"commonjs"}', nodeVersion: '22.12.0' });
    expect(r.findings[0].cause).toMatch(/"type": "commonjs"/);
    expect(r.findings[0].fixes[0].code).toMatch(/\.mjs/);
  });

  test('.cjs file → explicit marker explained', () => {
    const r = explain({ error: IMPORT_OUTSIDE, fileExt: 'cjs' });
    expect(r.findings[0].cause).toMatch(/\.cjs/);
  });
});

describe('X is not defined in ES module scope', () => {
  test('module.exports under "type": "module" → rename to .cjs first (type read from the error text)', () => {
    const r = explain({ error: EXPORTS_UNDEFINED });
    expect(ids(r)).toEqual(['cjs-global-in-esm']);
    expect(r.context.type).toBe('module');
    expect(r.findings[0].fixes[0].code).toMatch(/\.cjs/);
    expect(r.findings[0].cause).toMatch(/"type": "module"/);
  });

  test('__dirname on Node 18 → fileURLToPath fallback, not import.meta.dirname', () => {
    const r = explain({ error: 'ReferenceError: __dirname is not defined in ES module scope', nodeVersion: '18.19.0' });
    const f = r.findings[0];
    expect(f.fixes[1].code).toMatch(/fileURLToPath/);
    expect(f.source.url).toMatch(/no-__filename-or-__dirname/);
  });

  test('__dirname on Node 22 → import.meta.dirname', () => {
    const r = explain({ error: 'ReferenceError: __dirname is not defined in ES module scope', nodeVersion: '22.3.0' });
    expect(r.findings[0].fixes[1].code).toMatch(/import\.meta\.dirname/);
  });

  test('require is not defined → createRequire offered', () => {
    const r = explain({ error: 'ReferenceError: require is not defined in ES module scope, you can use import instead' });
    expect(r.findings[0].fixes.some((x) => /createRequire/.test(x.code))).toBe(true);
  });
});

describe('ERR_UNKNOWN_FILE_EXTENSION ".ts"', () => {
  test('Node 20.10.0 + ts-node script → upgrade, tsx, ts-node/esm loader', () => {
    const r = explain({ error: UNKNOWN_TS, packageJson: '{"type":"module","scripts":{"dev":"ts-node src/index.ts"}}', nodeVersion: '20.10.0' });
    const f = r.findings[0];
    expect(f.id).toBe('unknown-file-extension');
    expect(f.fixes[0].title).toMatch(/Upgrade/);
    expect(f.fixes.some((x) => /--loader ts-node\/esm/.test(x.code))).toBe(true);
    expect(f.fixes.some((x) => /npx tsx/.test(x.code))).toBe(true);
    expect(f.cause).toMatch(/ts-node/);
  });

  test('Node 22.6.0 → --experimental-strip-types (flag, not default yet)', () => {
    const r = explain({ error: UNKNOWN_TS, nodeVersion: '22.6.0' });
    expect(r.findings[0].fixes[0].code).toMatch(/--experimental-strip-types/);
  });

  test('Node 22.18.0 → type stripping is default: run node directly', () => {
    const r = explain({ error: UNKNOWN_TS, nodeVersion: '22.18.0' });
    const f = r.findings[0];
    expect(f.fixes[0].code).toBe('node src/index.ts');
    expect(f.why).toMatch(/strips types by default/);
    expect(f.fixes.some((x) => /--loader ts-node/.test(x.code))).toBe(false);
  });

  test('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX on 26.x does not offer the removed transform flag', () => {
    const err = 'SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode';
    expect(explain({ error: err, nodeVersion: '26.1.0' }).findings[0].fixes.some((x) => /transform-types/.test(x.code))).toBe(false);
    expect(explain({ error: err, nodeVersion: '24.4.0' }).findings[0].fixes.some((x) => /transform-types/.test(x.code))).toBe(true);
  });

  test('TypeScript under node_modules → dedicated finding', () => {
    const r = explain({ error: 'Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for files under node_modules, for "file:///app/node_modules/lib/src/index.ts"' });
    expect(ids(r)).toContain('ts-in-node-modules');
  });
});

describe('ERR_MODULE_NOT_FOUND', () => {
  test('relative import without extension → add .js, using Node\'s own hint', () => {
    const r = explain({ error: NOT_FOUND_EXT });
    expect(ids(r)).toEqual(['module-not-found-extension']);
    expect(r.findings[0].fixes[0].title).toMatch(/\.\/utils\.js/);
    expect(r.findings[0].source.url).toMatch(/mandatory-file-extensions/);
  });

  test('TypeScript importer → both .js (tsc nodenext) and .ts (type stripping) variants', () => {
    const err = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/db' imported from /app/src/index.ts";
    const codes = explain({ error: err }).findings[0].fixes.map((x) => x.code).join('\n');
    expect(codes).toMatch(/'\.\/db\.js'/);
    expect(codes).toMatch(/'\.\/db\.ts'/);
  });

  test('NEGATIVE: CommonJS MODULE_NOT_FOUND (require resolves extensions) does not trigger the ESM rule', () => {
    const err = `Error: Cannot find module './utils'
Require stack:
- /app/index.js
    at Module._resolveFilename (node:internal/modules/cjs/loader:1140:15) {
  code: 'MODULE_NOT_FOUND'
}`;
    expect(ids(explain({ error: err }))).toEqual([]);
  });

  test('NEGATIVE: missing file WITH an extension is not an extension problem', () => {
    const err = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/utils.js' imported from /app/src/index.js";
    expect(ids(explain({ error: err }))).not.toContain('module-not-found-extension');
  });

  test('bare package not installed → package-not-found', () => {
    const err = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from /app/server.js";
    const r = explain({ error: err });
    expect(ids(r)).toEqual(['package-not-found']);
    expect(r.findings[0].fixes[0].code).toMatch(/npm ls express/);
    expect(r.findings[0].fixes.at(-1).code).toBe('npm install express');
  });

  test('directory import → ERR_UNSUPPORTED_DIR_IMPORT', () => {
    const err = "Error [ERR_UNSUPPORTED_DIR_IMPORT]: Directory import '/app/src/utils' is not supported resolving ES modules imported from /app/src/index.js";
    expect(ids(explain({ error: err }))).toEqual(['dir-import']);
  });
});

describe("Unexpected identifier 'assert'", () => {
  test('Node 22.11.0 (from the log) → assert removed in 22.0.0, use with', () => {
    const r = explain({ error: ASSERT_ERR });
    const f = r.findings[0];
    expect(f.id).toBe('import-assert');
    expect(f.cause).toMatch(/22\.0\.0/);
    expect(f.fixes[0].code).toMatch(/with \{ type: 'json' \}/);
    expect(f.extraSource.url).toBe('https://github.com/nodejs/node/pull/52104');
  });

  test('NEGATIVE: Unexpected identifier for another word does not trigger', () => {
    expect(ids(explain({ error: "SyntaxError: Unexpected identifier 'foo'" }))).toEqual([]);
  });

  test('JSON import without attribute → ERR_IMPORT_ATTRIBUTE_MISSING', () => {
    const err = 'TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module "file:///app/data.json" needs an import attribute of "type: json"';
    expect(ids(explain({ error: err }))).toEqual(['import-attribute-missing']);
  });
});

describe('ERR_PACKAGE_PATH_NOT_EXPORTED', () => {
  test('deep import into a dependency → import the documented entry', () => {
    const r = explain({ error: NOT_EXPORTED });
    const f = r.findings[0];
    expect(f.id).toBe('package-path-not-exported');
    expect(f.cause).toMatch(/"some-lib"/);
    expect(f.fixes[0].code).toMatch(/import x from 'some-lib';/);
    expect(f.source.url).toMatch(/package-entry-points/);
  });

  test('"No exports main defined" → condition mismatch explanation', () => {
    const r = explain({ error: NO_MAIN });
    expect(r.findings[0].why).toMatch(/mutually exclusive/);
    expect(r.findings[0].fixes[0].code).toMatch(/import\('uuid'\)/);
  });
});

describe('inputs, masking, garbage', () => {
  test('empty input → no findings, no crash', () => {
    expect(explain({}).findings).toEqual([]);
    expect(explain().findings).toEqual([]);
    expect(explain({ error: '   \n  ' }).findings).toEqual([]);
  });

  test('garbage input → no findings, bad version produces a note', () => {
    const r = explain({ error: 'lorem ipsum dolor sit amet ¯\\_(ツ)_/¯ '.repeat(500), packageJson: '{{{not json', nodeVersion: 'banana' });
    expect(r.findings).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/not a Node\.js version/);
  });

  test('huge pathological input stays fast', () => {
    const start = Date.now();
    explain({ error: '/'.repeat(60000) + 'a'.repeat(60000), packageJson: 'x'.repeat(20000) });
    expect(Date.now() - start).toBeLessThan(1500);
  });

  test('NEGATIVE: a successful run log triggers nothing', () => {
    const log = '> app@1.0.0 start\n> node server.js\n\nServer listening on http://localhost:3000';
    expect(explain({ error: log, nodeVersion: '22.12.0' }).findings).toEqual([]);
  });

  test('maskSecrets hides credentials in URLs, tokens and key=value pairs', () => {
    // fake tokens assembled at runtime so no token-shaped literal exists in the source
    const fakeNpm = ['npm', 'abcdefghijklmnopqrstuvwxyz0123'].join('_');
    const fakeGhp = ['ghp', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
    const s = maskSecrets(`postgres://admin:hunter2@db.example.com/app //registry.npmjs.org/:_authToken=${fakeNpm} Bearer abc.def.ghi ${fakeGhp} password=s3cret`);
    expect(s).not.toMatch(/hunter2|abcdefghijklmnopqrstuvwxyz0123|s3cret|abc\.def\.ghi/);
    expect(s).toMatch(/admin:\*\*\*\*@db\.example\.com/);
  });

  test('secrets inside the failing path never reach the output', () => {
    const err = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/token=abcdef123456/utils' imported from /app/src/index.js";
    const out = JSON.stringify(explain({ error: err }));
    expect(out).not.toMatch(/abcdef123456/);
  });

  test('parsePackageJson reads a whole file, a bare snippet, and broken JSON', () => {
    expect(parsePackageJson('{"type":"module","exports":{".":"./i.js"}}').type).toBe('module');
    expect(parsePackageJson('"type": "module",').type).toBe('module');
    const broken = parsePackageJson('{ "type": "commonjs", "scripts": { "dev": "tsx watch src" }, }');
    expect(broken.parseError).toBe(true);
    expect(broken.type).toBe('commonjs');
    expect(broken.scripts.dev).toBe('tsx watch src');
    expect(parsePackageJson('').provided).toBe(false);
  });

  test('extractFromError and normaliseExtension', () => {
    const f = extractFromError(EXPORTS_UNDEFINED);
    expect(f.ext).toBe('.js');
    expect(f.type).toBe('module');
    expect(normaliseExtension('TS')).toBe('.ts');
    expect(normaliseExtension('.mjs')).toBe('.mjs');
    expect(normaliseExtension('')).toBeNull();
  });

  test('every finding carries an https source link and ranked fixes', () => {
    const all = [REQUIRE_ESM, IMPORT_OUTSIDE, EXPORTS_UNDEFINED, UNKNOWN_TS, NOT_FOUND_EXT, ASSERT_ERR, NOT_EXPORTED, NO_MAIN];
    for (const e of all) {
      const r = explain({ error: e });
      expect(r.findings.length).toBeGreaterThan(0);
      for (const f of r.findings) {
        expect(f.source.url).toMatch(/^https:\/\//);
        expect(f.fixes.length).toBeGreaterThan(0);
      }
    }
    expect(RULE_IDS.length).toBeGreaterThanOrEqual(12);
  });
});


describe('regressions from review: unknown type, TypeScript extensions, .tsx', () => {
  test('package.json NOT provided on 22.12.0 → never claims the "type" field is absent', () => {
    const r = explain({ error: IMPORT_OUTSIDE, nodeVersion: '22.12.0' });
    const f = r.findings[0];
    expect(f.cause).not.toMatch(/has no "type" field/);
    expect(f.cause).toMatch(/not provided/);
    expect(f.why).toMatch(/"commonjs"/);
    expect(r.context.typeKnown).toBe(false);
  });

  test('.ts file under CommonJS → rename to .mts, never .mjs', () => {
    const r = explain({ error: IMPORT_OUTSIDE.replace('server.js', 'server.ts'), packageJson: '{"type":"commonjs"}', fileExt: '.ts', nodeVersion: '22.18.0' });
    const codes = r.findings[0].fixes.map((x) => x.code).join('\n');
    expect(codes).toMatch(/\.mts/);
    expect(codes).not.toMatch(/\.mjs/);
  });

  test('.ts file running as ESM with module.exports → rename to .cts, never .cjs', () => {
    const r = explain({ error: 'ReferenceError: module is not defined in ES module scope', packageJson: '{"type":"module"}', fileExt: 'ts', nodeVersion: '23.6.0' });
    const f = r.findings[0];
    expect(f.fixes[0].code).toBe('mv config.ts config.cts');
    expect(f.cause).toMatch(/ends in \.ts/);
  });

  test('.tsx → unsupported by Node.js, compile first (no strip-types advice)', () => {
    const r = explain({ error: 'TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".tsx" for /app/src/App.tsx', nodeVersion: '22.18.0' });
    const f = r.findings[0];
    expect(f.title).toMatch(/\.tsx/);
    expect(JSON.stringify(f)).not.toMatch(/strip-types/);
  });

  test('.ts importer on a stripping Node without a TS runner → ./x.ts ranked first', () => {
    const err = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/db' imported from /app/src/index.ts";
    const direct = explain({ error: err, nodeVersion: '22.18.0', packageJson: '{"type":"module","scripts":{"start":"node src/index.ts"}}' });
    expect(direct.findings[0].fixes[0].code).toMatch(/'\.\/db\.ts'/);
    const viaTsNode = explain({ error: err, nodeVersion: '22.18.0', packageJson: '{"scripts":{"dev":"ts-node src/index.ts"}}' });
    expect(viaTsNode.findings[0].fixes[0].code).toMatch(/'\.\/db\.js'/);
  });

  test('numeric enum example keeps numeric values', () => {
    const r = explain({ error: 'SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode' });
    expect(r.findings[0].fixes[0].code).toMatch(/Red: 0, Green: 1/);
  });

});

describe('adversarial review regressions (2026-09-25)', () => {
  const IMPORT_ERR = 'SyntaxError: Cannot use import statement outside a module';

  test('"type": "module" already set → never says the field is missing, never suggests adding it', () => {
    for (const [v, scripts] of [['18.19.0', {}], ['22.12.0', { test: 'jest' }]]) {
      const r = explain({ error: IMPORT_ERR, packageJson: JSON.stringify({ name: 'a', type: 'module', scripts }), nodeVersion: v });
      const f = r.findings.find((x) => x.id === 'import-outside-module');
      expect(f.cause).toMatch(/already has "type": "module"/);
      expect(f.cause).not.toMatch(/no "type" field/);
      expect(f.fixes.map((x) => x.title).join('|')).not.toMatch(/add "type": "module"/i);
    }
    const jest = explain({ error: IMPORT_ERR, packageJson: '{"type":"module","scripts":{"test":"jest"}}', nodeVersion: '22.12.0' });
    expect(jest.findings[0].fixes[0].code).toMatch(/--experimental-vm-modules/);
    const tsNode = explain({ error: IMPORT_ERR, packageJson: '{"type":"module","scripts":{"dev":"ts-node src/index.ts"}}', fileExt: '.ts' });
    expect(tsNode.findings[0].fixes[0].code).toMatch(/ts-node\/esm/);
  });

  test('alias-shaped "Cannot find package" never leads with npm install', () => {
    const at = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/lib' imported from /app/dist/index.js" });
    const f = at.findings.find((x) => x.id === 'package-not-found');
    expect(f.title).toMatch(/path alias/);
    expect(f.fixes.map((x) => x.code).join('\n')).not.toMatch(/npm install/);
    expect(f.fixes[0].code).toMatch(/"imports"/);
    const src = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'src' imported from /app/dist/index.js" });
    expect(src.findings[0].fixes[0].title).toMatch(/folder in your project/);
    expect(src.findings[0].fixes[0].code).not.toMatch(/npm install/);
    const real = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'express' imported from /app/index.js" });
    expect(real.findings[0].fixes[0].code).not.toMatch(/npm install express/);
    expect(real.findings[0].fixes[0].code).toMatch(/npm ls express/);
  });

  test('dotted basenames (user.model, auth.guard) are extensionless, and Node\'s hint is used', () => {
    const r = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/user.model' imported from /app/src/index.ts", nodeVersion: '22.18.0' });
    expect(ids(r)).toContain('module-not-found-extension');
    const h = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/dist/auth.guard' imported from /app/dist/main.js\nDid you mean to import \"./auth.guard.js\"?" });
    const f = h.findings.find((x) => x.id === 'module-not-found-extension');
    expect(f.fixes[0].title).toMatch(/auth\.guard\.js/);
  });

  test('ERR_MODULE_NOT_FOUND on a path WITH an extension gets a finding', () => {
    const r = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/dist/utils.js' imported from /app/dist/index.js\n\nNode.js v22.12.0" });
    expect(ids(r)).toEqual(['module-not-found-file']);
    const ts = explain({ error: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/src/db.js' imported from /app/src/index.ts" });
    expect(ts.findings[0].fixes[0].code).toMatch(/'\.\/db\.ts'/);
  });

  test('ERR_IMPORT_ASSERTION_TYPE_MISSING on 20.5.0 recommends assert, not with', () => {
    const r = explain({ error: 'TypeError [ERR_IMPORT_ASSERTION_TYPE_MISSING]: Module "file:///app/data.json" needs an import assertion of type "json"', nodeVersion: '20.5.0' });
    const f = r.findings.find((x) => x.id === 'import-attribute-missing');
    expect(f.fixes[0].code).toMatch(/assert \{ type: 'json' \}/);
    const modern = explain({ error: 'TypeError [ERR_IMPORT_ATTRIBUTE_MISSING]: Module "file:///app/data.json" needs an import attribute of "type: json"', nodeVersion: '22.12.0' });
    expect(modern.findings[0].fixes[0].code).toMatch(/with \{ type: 'json' \}/);
  });

  test('ERR_INVALID_TYPESCRIPT_SYNTAX (22.10–22.13) in strip-only mode is recognised', () => {
    const r = explain({ error: 'SyntaxError [ERR_INVALID_TYPESCRIPT_SYNTAX]: x TypeScript enum is not supported in strip-only mode', nodeVersion: '22.12.0' });
    expect(ids(r)).toContain('ts-unsupported-syntax');
    expect(r.findings[0].source.url).toMatch(/err_invalid_typescript_syntax/);
  });

  test('pnpm layout → the real package name, not ".pnpm"', () => {
    const r = explain({ error: 'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/.pnpm/node-fetch@3.3.2/node_modules/node-fetch/src/index.js from /app/src/a.js not supported.', nodeVersion: '20.10.0' });
    const code = r.findings[0].fixes.map((x) => x.code).join('\n');
    expect(code).toMatch(/import\('node-fetch'\)/);
    expect(code).not.toMatch(/\.pnpm'/);
  });

});
