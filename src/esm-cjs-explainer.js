// esm-cjs-explainer — pure diagnostic logic for the ESM/CJS error explainer.
//
// For Node.js CONSUMERS (people running an app or a script), not library authors.
// Input: the pasted error text, an optional package.json snippet, the extension
// of the failing file and the Node.js version. Output: detected causes, why,
// and fixes ranked least-invasive first, each with its primary source.
//
// No React, no DOM, no network: this module is imported by a client component
// and runs entirely in the browser.
//
// EVERY version number below was read in the Node.js docs YAML history or in
// the release notes / CHANGELOG (verified 2026-09-25). Nothing is inferred from
// memory. If a fact could not be verified, the rule was dropped.

// ─── Sources ────────────────────────────────────────────────────────────────

export const SOURCES = {
  requireEsm: {
    url: 'https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require',
    label: 'Node.js docs — Loading ECMAScript modules using require()',
  },
  requireEsmRelease: {
    url: 'https://nodejs.org/en/blog/release/v22.12.0',
    label: 'Node.js 22.12.0 release notes — require(esm) enabled by default',
  },
  errRequireEsm: {
    url: 'https://nodejs.org/api/errors.html#err_require_esm',
    label: 'Node.js docs — ERR_REQUIRE_ESM',
  },
  errRequireAsync: {
    url: 'https://nodejs.org/api/errors.html#err_require_async_module',
    label: 'Node.js docs — ERR_REQUIRE_ASYNC_MODULE',
  },
  enabling: {
    url: 'https://nodejs.org/api/esm.html#enabling',
    label: 'Node.js docs — Enabling ES modules',
  },
  determining: {
    url: 'https://nodejs.org/api/packages.html#determining-module-system',
    label: 'Node.js docs — Determining module system',
  },
  syntaxDetection: {
    url: 'https://nodejs.org/api/packages.html#syntax-detection',
    label: 'Node.js docs — Syntax detection',
  },
  noRequire: {
    url: 'https://nodejs.org/api/esm.html#no-require-exports-or-moduleexports',
    label: 'Node.js docs — No require, exports or module.exports in ESM',
  },
  noDirname: {
    url: 'https://nodejs.org/api/esm.html#no-__filename-or-__dirname',
    label: 'Node.js docs — No __filename or __dirname in ESM',
  },
  typescript: {
    url: 'https://nodejs.org/api/typescript.html',
    label: 'Node.js docs — Modules: TypeScript',
  },
  stripTypesRelease: {
    url: 'https://nodejs.org/en/blog/release/v22.18.0',
    label: 'Node.js 22.18.0 release notes — type stripping enabled by default',
  },
  tsNodeEsm: {
    url: 'https://typestrong.org/ts-node/docs/imports',
    label: 'ts-node docs — Native ECMAScript modules',
  },
  errUnknownExt: {
    url: 'https://nodejs.org/api/errors.html#err_unknown_file_extension',
    label: 'Node.js docs — ERR_UNKNOWN_FILE_EXTENSION',
  },
  errNodeModulesStrip: {
    url: 'https://nodejs.org/api/errors.html#err_unsupported_node_modules_type_stripping',
    label: 'Node.js docs — ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING',
  },
  errTsSyntax: {
    url: 'https://nodejs.org/api/errors.html#err_unsupported_typescript_syntax',
    label: 'Node.js docs — ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX',
  },
  errInvalidTsSyntax: {
    url: 'https://nodejs.org/api/errors.html#err_invalid_typescript_syntax',
    label: 'Node.js docs — ERR_INVALID_TYPESCRIPT_SYNTAX (thrown for unsupported syntax before 23.7.0 / 22.14.0)',
  },
  subpathImports: {
    url: 'https://nodejs.org/api/packages.html#subpath-imports',
    label: 'Node.js docs — Subpath imports',
  },
  tsPathsAliases: {
    url: 'https://nodejs.org/api/typescript.html#paths-aliases',
    label: 'Node.js docs — TypeScript: Paths aliases',
  },
  jestEsm: {
    url: 'https://jestjs.io/docs/ecmascript-modules',
    label: 'Jest docs — ECMAScript Modules',
  },
  errAssertionMissing: {
    url: 'https://nodejs.org/api/errors.html#err_import_assertion_type_missing',
    label: 'Node.js docs — ERR_IMPORT_ASSERTION_TYPE_MISSING (added v17.1.0 / v16.14.0, removed v21.1.0)',
  },
  mandatoryExt: {
    url: 'https://nodejs.org/api/esm.html#mandatory-file-extensions',
    label: 'Node.js docs — Mandatory file extensions',
  },
  errModuleNotFound: {
    url: 'https://nodejs.org/api/errors.html#err_module_not_found',
    label: 'Node.js docs — ERR_MODULE_NOT_FOUND',
  },
  errDirImport: {
    url: 'https://nodejs.org/api/errors.html#err_unsupported_dir_import',
    label: 'Node.js docs — ERR_UNSUPPORTED_DIR_IMPORT',
  },
  importAttributes: {
    url: 'https://nodejs.org/api/esm.html#import-attributes',
    label: 'Node.js docs — Import attributes',
  },
  dropAssertions: {
    url: 'https://github.com/nodejs/node/pull/52104',
    label: 'nodejs/node#52104 — esm: drop support for import assertions (Node.js 22.0.0)',
  },
  errAttrMissing: {
    url: 'https://nodejs.org/api/errors.html#err_import_attribute_missing',
    label: 'Node.js docs — ERR_IMPORT_ATTRIBUTE_MISSING',
  },
  exportsEncapsulation: {
    url: 'https://nodejs.org/api/packages.html#package-entry-points',
    label: 'Node.js docs — Package entry points (exports encapsulation)',
  },
  conditionalExports: {
    url: 'https://nodejs.org/api/packages.html#conditional-exports',
    label: 'Node.js docs — Conditional exports',
  },
  errPathNotExported: {
    url: 'https://nodejs.org/api/errors.html#err_package_path_not_exported',
    label: 'Node.js docs — ERR_PACKAGE_PATH_NOT_EXPORTED',
  },
};

// ─── Verified version facts ─────────────────────────────────────────────────
// Each feature = { floor, backports }. A version has the feature when it is
// >= floor, or when its major line has a backport and it is >= that backport.
// Odd majors between lines (e.g. 21.x) only qualify through the floor.

export const FEATURES = {
  // modules.md "Loading ECMAScript modules using require()" history +
  // cli.md --no-require-module: "v23.0.0, v22.12.0, v20.19.0 — This feature is
  // no longer behind the --experimental-require-module CLI flag." (PR #55085;
  // confirmed in the 22.12.0 and 20.19.0 release notes).
  requireEsmDefault: { floor: '23.0.0', backports: { 20: '20.19.0', 22: '22.12.0' } },
  // modules.md: "Added in: v22.0.0, v20.17.0" (behind --experimental-require-module).
  requireEsmFlag: { floor: '22.0.0', backports: { 20: '20.17.0' } },
  // packages.md "Syntax detection": "v22.7.0, v20.19.0 — Syntax detection is
  // enabled by default." (PR #53619; confirmed in the 20.19.0 release notes).
  syntaxDetection: { floor: '22.7.0', backports: { 20: '20.19.0' } },
  // Node.js 22.6.0 release notes: "module: add --experimental-strip-types" (#53725);
  // cli.md --no-strip-types "added: v22.6.0".
  stripTypesFlag: { floor: '22.6.0', backports: {} },
  // cli.md --no-strip-types: "v23.6.0, v22.18.0 — Type stripping is enabled by
  // default." (PR #56350; confirmed in the 23.6.0 and 22.18.0 release notes).
  stripTypesDefault: { floor: '23.6.0', backports: { 22: '22.18.0' } },
  // typescript.md history: "v22.7.0 Added --experimental-transform-types flag";
  // "v26.0.0 Removed --experimental-transform-types flag." (range handled below).
  transformTypesFlag: { floor: '22.7.0', backports: {}, removedIn: '26.0.0' },
  // esm.md history: "v22.0.0 Drop support for import assertions." (CHANGELOG_V22:
  // "esm: drop support for import assertions" #52104, in 22.0.0).
  assertRemoved: { floor: '22.0.0', backports: {} },
  // esm.md history: "v21.0.0, v20.10.0, v18.20.0 Add experimental support for
  // import attributes."
  importAttributes: { floor: '21.0.0', backports: { 18: '18.20.0', 20: '20.10.0' } },
  // esm.md import.meta.dirname / import.meta.filename: "added: v21.2.0, v20.11.0".
  importMetaDirname: { floor: '21.2.0', backports: { 20: '20.11.0' } },
};

// ─── Semver helpers (tiny, no dependency) ───────────────────────────────────

export function parseVersion(input) {
  if (input == null) return null;
  const m = String(input).trim().match(/^v?(\d{1,3})(?:\.(\d{1,4}))?(?:\.(\d{1,4}))?(?:[-+][\w.-]*)?$/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2] || 0), patch: Number(m[3] || 0), raw: `${Number(m[1])}.${Number(m[2] || 0)}.${Number(m[3] || 0)}` };
}

export function compareVersions(a, b) {
  const pa = typeof a === 'string' ? parseVersion(a) : a;
  const pb = typeof b === 'string' ? parseVersion(b) : b;
  if (!pa || !pb) return NaN;
  return (pa.major - pb.major) || (pa.minor - pb.minor) || (pa.patch - pb.patch);
}

/** true / false, or null when the version is unknown. */
export function hasFeature(version, featureName) {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  const f = FEATURES[featureName];
  if (!v || !f) return null;
  if (f.removedIn && compareVersions(v, f.removedIn) >= 0) return false;
  if (compareVersions(v, f.floor) >= 0) return true;
  const bp = f.backports[v.major];
  return bp ? compareVersions(v, bp) >= 0 : false;
}

/** Human "22.12.0+ (or 20.19.0+ on the 20.x line)" string for a feature. */
export function describeFeatureVersions(featureName) {
  const f = FEATURES[featureName];
  const lines = Object.values(f.backports);
  const parts = [...lines.map((v) => `${v}+`), `${f.floor}+`];
  return parts.join(', ');
}

// ─── Secret masking ─────────────────────────────────────────────────────────
// Pasted logs can carry credentials (registry tokens, DB URLs, bearer tokens).
// Anything echoed back in the output goes through maskSecrets().

export function maskSecrets(text) {
  if (!text) return '';
  return String(text)
    // scheme://user:password@host
    .replace(/([a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@]{1,200}:)[^\s@/]{1,500}@/gi, '$1****@')
    // _authToken=..., token=..., password: ..., api_key=..., secret=...
    .replace(/((?:_?auth_?token|token|password|passwd|secret|api[_-]?key|access[_-]?key)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1****')
    // Authorization: Bearer xxx
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g, '$1****')
    // Well-known token shapes (GitHub, npm, Stripe/OpenAI-like, JWT)
    .replace(/\b(gh[pousr]_)[A-Za-z0-9]{20,}\b/g, '$1****')
    .replace(/\b(npm_)[A-Za-z0-9]{20,}\b/g, '$1****')
    .replace(/\b(sk_(?:live|test)_|sk-)[A-Za-z0-9_-]{16,}\b/g, '$1****')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/g, 'eyJ****');
}

// ─── Input parsing ──────────────────────────────────────────────────────────

/**
 * Tolerant package.json parser: accepts the whole file, or a bare snippet like
 * `"type": "module", "main": "index.js"`. Falls back to regexes on garbage.
 */
export function parsePackageJson(text) {
  const empty = { provided: false, type: null, exports: undefined, main: null, module: null, name: null, scripts: {}, parseError: false };
  if (!text || !String(text).trim()) return empty;
  const src = String(text).trim();
  const attempts = [src, `{${src.replace(/,\s*$/, '')}}`];
  for (const a of attempts) {
    try {
      const obj = JSON.parse(a);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return {
          provided: true,
          type: typeof obj.type === 'string' ? obj.type : null,
          exports: obj.exports,
          main: typeof obj.main === 'string' ? obj.main : null,
          module: typeof obj.module === 'string' ? obj.module : null,
          name: typeof obj.name === 'string' ? obj.name : null,
          scripts: obj.scripts && typeof obj.scripts === 'object' ? obj.scripts : {},
          parseError: false,
        };
      }
    } catch { /* try next */ }
  }
  // Regex fallback (trailing commas, comments, partial paste).
  const pick = (key) => {
    const m = src.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`));
    return m ? m[1] : null;
  };
  const scripts = {};
  const sm = src.match(/"scripts"\s*:\s*\{([^}]*)\}/);
  if (sm) {
    for (const m of sm[1].matchAll(/"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) scripts[m[1]] = m[2];
  }
  return {
    provided: true,
    type: pick('type'),
    exports: /"exports"\s*:/.test(src) ? '(unparsed)' : undefined,
    main: pick('main'),
    module: pick('module'),
    name: pick('name'),
    scripts,
    parseError: true,
  };
}

export function normaliseExtension(ext) {
  if (!ext) return null;
  const m = String(ext).trim().toLowerCase().match(/\.?([a-z0-9]{1,5})$/);
  return m ? `.${m[1]}` : null;
}

const FILE_EXT_RE = /\.(mjs|cjs|js|mts|cts|ts|tsx|jsx|json)\b/;

/** Pull every fact the error text itself reveals. */
export function extractFromError(text) {
  const t = String(text || '');
  const facts = {};
  // Node prints "Node.js v22.3.0" under every uncaught error.
  const nv = t.match(/Node\.js v(\d+\.\d+\.\d+)/);
  if (nv) facts.nodeVersion = nv[1];
  // "This file is being treated as an ES module because it has a '.js' file
  // extension and '/app/package.json' contains "type": "module"."
  if (/treated as an ES module because/i.test(t)) facts.treatedAs = 'esm';
  const typeHint = t.match(/contains "type":\s*"(module|commonjs)"/);
  if (typeHint) facts.type = typeHint[1];
  // The failing file: first absolute path / file URL with a known extension.
  const fm = t.match(/(?:file:\/\/)?((?:[A-Za-z]:)?[\\/][^\s'"():]{1,400}?\.(?:mjs|cjs|js|mts|cts|ts|tsx|jsx|json))\b/);
  if (fm) {
    facts.file = fm[1];
    const em = fm[1].match(FILE_EXT_RE);
    if (em) facts.ext = `.${em[1]}`;
  }
  return facts;
}

const MODULE_EXT_RE = /\.(?:js|mjs|cjs|json|node|ts|mts|cts|wasm)$/i;

/**
 * ESM "Cannot find module '<path>' imported from ..." with a relative/absolute
 * path specifier, or null. CommonJS MODULE_NOT_FOUND is excluded: require()
 * does resolve extensionless paths.
 */
function esmPathNotFound(error) {
  if (!/ERR_MODULE_NOT_FOUND|' imported from /i.test(error)) return null;
  const m = error.match(/Cannot find module '([^']+)'/i);
  if (!m) return null;
  const target = m[1];
  const isPath = /^(?:[A-Za-z]:)?[\\/]|^\.{1,2}[\\/]|^file:/.test(target);
  if (!isPath) return null;
  const lastSeg = target.split(/[\\/]/).pop();
  return { target, lastSeg, hasKnownExt: MODULE_EXT_RE.test(lastSeg) };
}

function scriptsText(pkg) {
  return Object.values(pkg.scripts || {}).join('\n');
}

function exportSubpaths(exp) {
  if (!exp || typeof exp !== 'object') return [];
  const keys = Object.keys(exp);
  return keys.every((k) => k.startsWith('.')) ? keys : ['.'];
}

// ─── Rules ──────────────────────────────────────────────────────────────────
// Each rule: { id, test(ctx) → match|null, build(ctx, match) → finding }.
// Fixes are ordered least invasive first.

const RULES = [
  // ERR_REQUIRE_ASYNC_MODULE — listed before ERR_REQUIRE_ESM (it replaces it
  // once require(esm) is on). Source: errors.md + modules.md.
  {
    id: 'require-async-module',
    test: (c) => /ERR_REQUIRE_ASYNC_MODULE|require\(\) cannot be used on an ESM graph with top-level await/i.test(c.error),
    build: (c) => ({
      title: 'require() hit an ES module that uses top-level await',
      cause: 'Your Node.js loads ES modules through require(), but this module (or something it imports) contains top-level await, so it cannot be loaded synchronously.',
      why: 'require() only supports ES modules that are fully synchronous. When the module graph contains top-level await, Node.js throws ERR_REQUIRE_ASYNC_MODULE and the docs say to load it with import() instead.',
      fixes: [
        { title: 'Load it with dynamic import()', detail: 'import() is valid inside CommonJS files and handles asynchronous modules.', code: "// inside an async function (CommonJS is fine)\nconst mod = await import('the-package');" },
        { title: 'Find the top-level await', detail: 'Run once with --experimental-print-required-tla to print where the top-level await lives in the graph.', code: 'node --experimental-print-required-tla your-script.js' },
        { title: 'Convert the calling file to ESM', detail: 'Rename it to .mjs (or set "type": "module") and use a static import.', code: "import mod from 'the-package';" },
      ],
      source: SOURCES.errRequireAsync,
    }),
  },

  // ERR_REQUIRE_ESM. Source: errors.md (deprecated since v23.0.0, v22.12.0,
  // v20.19.0 — PR #55085), modules.md, 22.12.0 / 20.19.0 release notes.
  {
    id: 'require-esm',
    test: (c) => /ERR_REQUIRE_ESM|require\(\) of ES Module/i.test(c.error),
    build: (c) => {
      const mod = c.error.match(/require\(\) of ES Module\s+(\S+)/i);
      const target = mod ? maskSecrets(mod[1]) : 'the package';
      // Greedy .* → the LAST node_modules segment (pnpm: node_modules/.pnpm/x@1/node_modules/x).
      const pkgMatch = mod && mod[1].match(/.*node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/);
      const pkgName = pkgMatch && !pkgMatch[1].startsWith('.') ? pkgMatch[1].replace(/\\/g, '/') : 'the-package';
      const supported = hasFeature(c.version, 'requireEsmDefault');
      const fixes = [];
      let cause = `A CommonJS file called require() on ${target}, which is an ES module.`;
      let why = 'Before require(esm) was enabled by default, Node.js refused to require() an ES module and threw ERR_REQUIRE_ESM. Node.js enabled it by default in 23.0.0, 22.12.0 and 20.19.0; since then the error is deprecated.';
      if (supported === true) {
        cause = `You report Node.js ${c.version.raw}, which loads synchronous ES modules through require() by default — yet something still threw ERR_REQUIRE_ESM.`;
        why = 'On this version Node.js itself no longer throws ERR_REQUIRE_ESM for synchronous ES modules. The process that failed is therefore most likely running a different Node.js binary (nvm, Docker base image, CI runner), has require(esm) turned off with --no-experimental-require-module / --no-require-module, or the require() comes from a tool that implements its own module loader.';
        fixes.push(
          { title: 'Check which Node.js actually ran', detail: 'The last line of an uncaught error prints the real version ("Node.js vX.Y.Z"). Compare it with what you expect, locally and in CI.', code: 'node -p "process.version + \' require(esm): \' + process.features.require_module"' },
          { title: 'Look for a flag that disables it', detail: 'Search NODE_OPTIONS and your scripts for --no-experimental-require-module or --no-require-module.', code: 'echo $NODE_OPTIONS' },
        );
      } else {
        if (supported === false) {
          fixes.push({ title: `Upgrade Node.js (you are on ${c.version.raw})`, detail: `require() loads synchronous ES modules by default from ${describeFeatureVersions('requireEsmDefault')}. Often the smallest change if your platform lets you pick the version.`, code: 'nvm install 22   # any 22.12.0+ or 20.19.0+ works\nnode -p "process.features.require_module"   # true' });
          if (hasFeature(c.version, 'requireEsmFlag')) {
            fixes.push({ title: 'Or enable the flag on your current version', detail: `Your version (${c.version.raw}) already ships require(esm) behind --experimental-require-module (added in 22.0.0 / 20.17.0).`, code: 'node --experimental-require-module your-script.js' });
          }
        }
        fixes.push(
          { title: 'Use dynamic import() from CommonJS', detail: 'import() is valid inside CommonJS on every supported Node.js version. It is asynchronous, so await it inside an async function.', code: `const { default: pkg } = await import('${pkgName}');` },
          { title: 'Convert the calling file to ESM', detail: 'Rename it to .mjs, or add "type": "module" to your package.json, then use import.', code: `import pkg from '${pkgName}';` },
        );
        if (supported === null) {
          fixes.unshift({ title: 'Tell the tool your Node.js version', detail: 'The right fix depends on it: 23.0.0+, 22.12.0+ and 20.19.0+ load synchronous ES modules through require() by default.', code: 'node --version' });
        }
      }
      return { title: 'ERR_REQUIRE_ESM — require() of an ES module', cause, why, fixes, source: supported === true ? SOURCES.requireEsmRelease : SOURCES.requireEsm };
    },
  },

  // "Cannot use import statement outside a module". Sources: esm.md "Enabling",
  // packages.md "Determining module system" + "Syntax detection" (v22.7.0, v20.19.0).
  {
    id: 'import-outside-module',
    test: (c) => /Cannot use import statement outside a module/i.test(c.error),
    build: (c) => {
      const detection = hasFeature(c.version, 'syntaxDetection');
      const isTs = ['.ts', '.mts', '.cts'].includes(c.ext);
      // .mts / .cts are the TypeScript equivalents of .mjs / .cjs (typescript.md
      // "Determining module system") — never tell a TS user to rename to .mjs.
      const esmExt = isTs ? '.mts' : '.mjs';
      const srcExt = isTs ? '.ts' : '.js';
      const renameFix = (detail) => ({ title: `Rename this file to ${esmExt}`, detail, code: `mv script${srcExt} script${esmExt}` });
      const addTypeFix = { title: 'Or add "type": "module" to package.json', detail: `Every ${srcExt} file in the package becomes ESM — convert any require()/module.exports first, or rename those files to ${isTs ? '.cts' : '.cjs'}.`, code: '{\n  "type": "module"\n}' };
      const upgradeFix = { title: 'Or upgrade Node.js', detail: `Syntax detection is on by default from ${describeFeatureVersions('syntaxDetection')}.`, code: 'nvm install 22' };
      const fixes = [];
      let cause = 'Node.js loaded this file as CommonJS, and CommonJS has no import statement.';
      let why = `Node.js decides the module system per file: .mjs${isTs ? '/.mts' : ''} is always ESM, .cjs${isTs ? '/.cts' : ''} is always CommonJS, and ${srcExt} follows the "type" field of the nearest package.json.`;
      if (isTs) why += ' TypeScript files follow the same rule as .js files when Node.js runs them.';

      if (c.ext === '.cjs' || c.ext === '.cts') {
        const to = c.ext === '.cts' ? '.mts' : '.mjs';
        cause = `The file has the ${c.ext} extension, which Node.js always runs as CommonJS.`;
        fixes.push(
          { title: `Rename it to ${to}`, detail: 'The extension is an explicit marker; it wins over package.json.', code: `mv file${c.ext} file${to}` },
          { title: 'Or keep CommonJS and use require()', detail: 'Replace the import statements with require() calls.', code: "const express = require('express');" },
        );
      } else if (c.type === 'commonjs') {
        cause = `Your package.json says "type": "commonjs", so every ${srcExt} file in it runs as CommonJS.`;
        fixes.push(
          renameFix('Least invasive: only this file becomes ESM, the rest of the project is untouched.'),
          { title: 'Or switch the package to ESM', detail: `Changes how every ${srcExt} file is loaded — convert any require()/module.exports first.`, code: '"type": "module"' },
        );
      } else if (c.type === 'module') {
        // Node.js itself would run this file as ESM, so something else loaded it
        // as CommonJS. Never tell this user to add "type": "module" again.
        cause = `Your package.json already has "type": "module", so Node.js itself would run this ${srcExt} file as ESM. It was loaded as CommonJS by something else: a runner that compiles files to CommonJS (Jest without its ESM mode, ts-node without its ESM loader, a require() hook), or a nearer package.json without "type": "module" that governs this file.`;
        why = 'Node.js applies the "type" field of the NEAREST package.json above the file. Test runners and register hooks can bypass Node.js\'s own loader and compile every file to CommonJS, whatever package.json says. Adding "type": "module" again changes nothing.';
        if (c.runsJest) {
          fixes.push({ title: 'Run Jest in ESM mode', detail: 'Jest documents ESM support as experimental: run Node.js with --experimental-vm-modules, and disable transforms (transform: {}) or configure your transformer to emit ESM instead of CommonJS.', code: 'NODE_OPTIONS=--experimental-vm-modules npx jest\n// jest.config.js\nexport default { transform: {} };' });
        }
        if (c.runsTsNode) {
          fixes.push({ title: 'Use ts-node’s ESM loader, or tsx', detail: 'Plain ts-node hooks require() and compiles to CommonJS; native ESM needs its dedicated loader. tsx handles ESM without extra flags.', code: `node --loader ts-node/esm src/index${srcExt}\n# or\nnpx tsx src/index${srcExt}` });
        }
        fixes.push(
          { title: 'Look for a nearer package.json', detail: 'A package.json in a sub-folder (or in a build output folder such as dist/) without "type": "module" wins over the root one for every file below it.', code: 'find . -name package.json -not -path "*/node_modules/*"' },
          { title: 'Run the file with plain Node.js to confirm', detail: 'If this works, the problem is the runner or hook in front of Node.js, not your package.json.', code: `node path/to/file${srcExt}` },
        );
        if (!c.runsJest) {
          fixes.push({ title: 'Is this failing under Jest?', detail: 'Jest compiles to CommonJS by default. Its ESM mode needs --experimental-vm-modules and transform: {} (or an ESM-emitting transformer).', code: 'NODE_OPTIONS=--experimental-vm-modules npx jest' });
        }
      } else if (!c.typeKnown) {
        // package.json not provided: do NOT assume the "type" field is absent.
        cause = 'Node.js loaded this file as CommonJS. Which marker decided that depends on your package.json, which was not provided — paste it for a sharper answer.';
        why += ' If "type" is "commonjs", this file is CommonJS by declaration. If there is no "type" field, the outcome depends on your Node.js version: from 22.7.0 / 20.19.0, syntax detection retries .js files containing import/export as ESM.';
        fixes.push(renameFix('Least invasive whatever your package.json says: the extension is an explicit marker that wins over the "type" field.'), addTypeFix);
        if (detection === false) fixes.push(upgradeFix);
      } else if (detection === true && (c.ext === '.js' || !c.ext)) {
        cause = `Your package.json has no "type" field, and on Node.js ${c.version.raw} syntax detection should retry such a file as ESM — so the code was most likely not loaded by Node.js's own loader.`;
        why = 'Since 22.7.0 / 20.19.0, Node.js inspects ambiguous .js files (no "type" field) and runs them as ESM when they contain import/export. When this error still appears, something that loads files as CommonJS itself (a test runner, a register hook) is likely in the way, or the "type" field lives in a different package.json than the one you pasted.';
        fixes.push({ title: 'Add "type": "module" explicitly', detail: 'An explicit marker also removes the detection cost Node.js pays on every ambiguous file.', code: '{\n  "type": "module"\n}' });
      } else {
        cause = `Your package.json has no "type" field, so ${srcExt} files are loaded as CommonJS.`;
        if (detection === false) why += ` Your Node.js (${c.version.raw}) predates syntax detection being on by default (22.7.0, 20.19.0), so it does not retry the file as ESM.`;
        fixes.push(renameFix('Least invasive: only this file becomes ESM.'), addTypeFix);
        if (detection === false) fixes.push(upgradeFix);
      }
      const moduleTyped = c.type === 'module' && c.ext !== '.cjs' && c.ext !== '.cts';
      return {
        title: '"Cannot use import statement outside a module"',
        cause,
        why,
        fixes,
        source: !moduleTyped && detection === true && c.typeKnown && !c.type ? SOURCES.syntaxDetection : SOURCES.determining,
        ...(moduleTyped ? { extraSource: SOURCES.jestEsm } : {}),
      };
    },
  },

  // "X is not defined in ES module scope". Sources: esm.md "No require, exports,
  // or module.exports" / "No __filename or __dirname"; import.meta.dirname added
  // v21.2.0, v20.11.0 (esm.md YAML).
  {
    id: 'cjs-global-in-esm',
    test: (c) => /\b(require|exports|module|__dirname|__filename) is not defined in ES module scope/i.test(c.error),
    build: (c) => {
      const name = c.error.match(/\b(require|exports|module|__dirname|__filename) is not defined in ES module scope/i)[1];
      const isPath = name === '__dirname' || name === '__filename';
      const isTs = ['.ts', '.mts'].includes(c.ext);
      const cjsExt = isTs ? '.cts' : '.cjs';
      const fromExt = c.ext === '.mts' || c.ext === '.mjs' ? c.ext : isTs ? '.ts' : '.js';
      const esmReason = c.ext === '.mjs' || c.ext === '.mts'
        ? `the file has the ${c.ext} extension`
        : c.type === 'module'
          ? `your package.json contains "type": "module" and the file ends in ${fromExt}`
          : `the file is being loaded as an ES module (${isTs ? '.mts, or .ts' : '.mjs, or .js'} under "type": "module")`;
      const fixes = [
        { title: `Rename the file to ${cjsExt}`, detail: `Least invasive when the file is genuinely CommonJS (config files, old scripts): ${cjsExt} is always CommonJS, whatever package.json says.`, code: `mv config${fromExt} config${cjsExt}` },
      ];
      if (isPath) {
        const dn = hasFeature(c.version, 'importMetaDirname');
        fixes.push(dn === false
          ? { title: `Rebuild ${name} from import.meta.url`, detail: `import.meta.dirname / filename need 21.2.0+ or 20.11.0+; on ${c.version.raw} derive them from the URL.`, code: "import { fileURLToPath } from 'node:url';\nimport path from 'node:path';\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = path.dirname(__filename);" }
          : { title: `Use import.meta.${name === '__dirname' ? 'dirname' : 'filename'}`, detail: 'Available from 21.2.0 and 20.11.0.', code: `const dir = import.meta.dirname;\nconst file = import.meta.filename;` });
      } else if (name === 'require') {
        fixes.push(
          { title: 'Switch to import', detail: 'In ESM, import loads CommonJS packages too.', code: "import express from 'express';" },
          { title: 'Or build a require() with createRequire', detail: 'When you really need require (e.g. to load JSON or a CommonJS-only path).', code: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);" },
        );
      } else {
        fixes.push({ title: 'Switch to export', detail: 'ES modules export with the export keyword; module.exports / exports do not exist.', code: 'export default config;\n// or: export const handler = …' });
      }
      return {
        title: `"${name} is not defined in ES module scope"`,
        cause: `The file is running as an ES module because ${esmReason}, and ${name} only exists in CommonJS.`,
        why: 'CommonJS injects require, exports, module, __filename and __dirname into every file. ES modules do not have them.',
        fixes,
        source: isPath ? SOURCES.noDirname : SOURCES.noRequire,
      };
    },
  },

  // ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING (errors.md, added v22.6.0).
  {
    id: 'ts-in-node-modules',
    test: (c) => /ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING|Stripping types is currently unsupported for files under node_modules/i.test(c.error),
    build: () => ({
      title: 'A dependency ships raw TypeScript',
      cause: 'Node.js refuses to strip types from files under node_modules.',
      why: 'The Node.js docs say this is deliberate: it discourages publishing packages written in TypeScript. Type stripping only applies to your own files.',
      fixes: [
        { title: 'Import the package’s compiled JavaScript entry', detail: 'Check its package.json "exports"/"main" — you may be importing a src/*.ts path directly.', code: "import x from 'the-package'; // not 'the-package/src/index.ts'" },
        { title: 'Ask the maintainer to publish compiled JavaScript', detail: 'Or move the code into your own source tree (a workspace package that is not under node_modules).', code: '' },
      ],
      source: SOURCES.errNodeModulesStrip,
    }),
  },

  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX (errors.md, added v23.7.0, v22.14.0);
  // transform flag v22.7.0 → removed v26.0.0 (typescript.md history).
  {
    id: 'ts-unsupported-syntax',
    // Before 23.7.0 / 22.14.0 the same case was reported as
    // ERR_INVALID_TYPESCRIPT_SYNTAX (errors.md: added v23.0.0, v22.10.0; "no
    // longer thrown on valid yet unsupported syntax" since v23.7.0, v22.14.0,
    // PR #56610). That code now means genuinely invalid syntax, so it only
    // matches together with the "not supported in strip-only mode" message.
    test: (c) => /ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/.test(c.error) || /not supported in strip-only mode/i.test(c.error),
    build: (c) => {
      const transform = hasFeature(c.version, 'transformTypesFlag');
      const fixes = [
        { title: 'Replace the construct with plain JavaScript', detail: 'Type stripping only removes types. Enums, namespaces with runtime code, parameter properties and import aliases need a transform.', code: '// enum Colour { Red, Green }  →  numeric: Red = 0, Green = 1\nexport const Colour = { Red: 0, Green: 1 } as const;\nexport type Colour = (typeof Colour)[keyof typeof Colour];' },
        { title: 'Run it through tsx instead', detail: 'The Node.js TypeScript docs recommend tsx for full TypeScript support.', code: 'npx tsx file.ts\n# or\nnode --import=tsx file.ts' },
      ];
      if (transform === true) {
        fixes.push({ title: 'Or use --experimental-transform-types', detail: `Available on your version (${c.version.raw}); added in 22.7.0 and removed in 26.0.0, so do not build on it.`, code: 'node --experimental-transform-types file.ts' });
      }
      return {
        title: 'TypeScript syntax that type stripping cannot handle',
        cause: 'The file uses TypeScript syntax that has to be transformed into JavaScript, not just stripped.',
        why: 'Node.js runs TypeScript by erasing type annotations. Syntax that produces runtime code (enum, namespace with code, parameter properties, import aliases) raises ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX on 23.7.0+ / 22.14.0+; from 22.10.0 / 23.0.0 up to those versions the same case was reported as ERR_INVALID_TYPESCRIPT_SYNTAX.',
        fixes,
        source: /ERR_INVALID_TYPESCRIPT_SYNTAX/.test(c.error) ? SOURCES.errInvalidTsSyntax : SOURCES.errTsSyntax,
      };
    },
  },

  // ERR_UNKNOWN_FILE_EXTENSION. Sources: errors.md; typescript.md (history:
  // --experimental-strip-types added v22.6.0, default v23.6.0 / v22.18.0);
  // ts-node docs (node --loader ts-node/esm, requires "type": "module").
  {
    id: 'unknown-file-extension',
    test: (c) => /ERR_UNKNOWN_FILE_EXTENSION|Unknown file extension/i.test(c.error),
    build: (c) => {
      const em = c.error.match(/Unknown file extension "(\.[A-Za-z0-9]+)"/i);
      const ext = (em && em[1].toLowerCase()) || c.ext || '.ts';
      const isTs = ['.ts', '.mts', '.cts'].includes(ext);
      const usesTsNode = /ts-node/.test(c.error) || /ts-node/.test(c.scripts);
      if (ext === '.tsx') {
        // typescript.md "Determining module system": ".tsx files are unsupported".
        return {
          title: 'ERR_UNKNOWN_FILE_EXTENSION ".tsx"',
          cause: 'Node.js was asked to run a .tsx file directly.',
          why: 'Node.js built-in TypeScript support does not cover .tsx files at all — the Node.js docs list them as unsupported. JSX has to be compiled before Node.js can run it.',
          fixes: [
            { title: 'Compile first, then run the JavaScript output', detail: 'Use the TypeScript compiler or your bundler to turn .tsx into .js.', code: 'npx tsc && node dist/index.js' },
          ],
          source: SOURCES.typescript,
        };
      }
      if (!isTs) {
        return {
          title: `ERR_UNKNOWN_FILE_EXTENSION "${ext}"`,
          cause: `The ES module loader does not know how to run "${ext}" files.`,
          why: 'Node.js throws ERR_UNKNOWN_FILE_EXTENSION when an attempt is made to load a module with an unknown or unsupported file extension. The file needs a build step (or a loader) that turns it into JavaScript first.',
          fixes: [
            { title: 'Compile the file first', detail: `Run your bundler or compiler so Node.js receives plain JavaScript instead of "${ext}".`, code: '' },
          ],
          source: SOURCES.errUnknownExt,
        };
      }
      const stripDefault = hasFeature(c.version, 'stripTypesDefault');
      const stripFlag = hasFeature(c.version, 'stripTypesFlag');
      const fixes = [];
      let cause = `Node.js's ES module loader was asked to run a "${ext}" file it could not handle.`;
      let why = 'This happens when a .ts file is loaded as an ES module (e.g. under "type": "module") by a Node.js that is not stripping types, or through a TypeScript runner that only hooks require(). ts-node documents this error for files executed as native ESM.';
      if (stripDefault === true) {
        why = `Your Node.js (${c.version.raw}) strips types by default, so plain "node file${ext}" should work. The error means something else is loading the file: type stripping disabled (--no-experimental-strip-types / --no-strip-types), a different Node.js binary, or a runner such as ts-node sitting in front of Node.js.`;
        fixes.push({ title: 'Run the file with Node.js directly', detail: 'No runner needed on this version. Limits: types must be erasable (no enum, no namespace with code), relative imports need the .ts extension, and import type is required for type-only imports.', code: `node src/index${ext}` });
      } else if (stripFlag === true) {
        fixes.push({ title: 'Enable type stripping on your version', detail: `Your Node.js (${c.version.raw}) has --experimental-strip-types (added in 22.6.0); it becomes the default in 23.6.0 and 22.18.0.`, code: `node --experimental-strip-types src/index${ext}` });
      } else if (stripFlag === false) {
        fixes.push({ title: `Upgrade Node.js for built-in TypeScript (you are on ${c.version.raw})`, detail: `Type stripping is on by default from ${describeFeatureVersions('stripTypesDefault')} (flag since 22.6.0).`, code: 'nvm install 22   # 22.18.0+ runs .ts directly' });
      }
      fixes.push({ title: 'Use tsx', detail: 'The Node.js TypeScript docs recommend tsx for full TypeScript support, including syntax type stripping cannot handle.', code: `npx tsx src/index${ext}\n# or keep plain node:\nnode --import=tsx src/index${ext}` });
      if (usesTsNode) {
        cause = 'ts-node is running a TypeScript file that Node.js loads as a native ES module.';
        fixes.push({ title: 'Or keep ts-node, with its ESM loader', detail: 'ts-node needs "type": "module" and its dedicated ESM loader for native ESM (its docs flag the loader hooks as experimental).', code: `node --loader ts-node/esm src/index${ext}` });
      }
      fixes.push({ title: 'Or compile, then run JavaScript', detail: 'The most robust for production: tsc (or a bundler) emits .js and Node.js never sees a .ts file.', code: 'npx tsc && node dist/index.js' });
      return { title: `ERR_UNKNOWN_FILE_EXTENSION "${ext}"`, cause, why, fixes, source: stripDefault === true || stripFlag === true ? SOURCES.typescript : usesTsNode ? SOURCES.tsNodeEsm : SOURCES.typescript };
    },
  },

  // ERR_UNSUPPORTED_DIR_IMPORT (errors.md).
  {
    id: 'dir-import',
    test: (c) => /ERR_UNSUPPORTED_DIR_IMPORT|Directory import .* is not supported/i.test(c.error),
    build: (c) => {
      const m = c.error.match(/Directory import '([^']+)'/);
      const dir = m ? maskSecrets(m[1]) : './dir';
      return {
        title: 'Importing a directory in ESM',
        cause: `An import points at a directory (${dir}) instead of a file.`,
        why: 'CommonJS resolves a folder to its index.js; the ES module loader does not. Directory indexes must be fully specified.',
        fixes: [
          { title: 'Point at the index file', detail: 'Spell out the file and its extension.', code: "import { x } from './utils/index.js';" },
          { title: 'Or, for a package, use its name', detail: 'Self-reference the package by name and declare the subpath in "exports".', code: "import x from 'your-package/utils';" },
        ],
        source: SOURCES.errDirImport,
      };
    },
  },

  // ERR_MODULE_NOT_FOUND on a relative/absolute specifier without extension.
  // Sources: esm.md "Mandatory file extensions"; typescript.md (".ts" extension
  // mandatory under type stripping); TS handbook (nodenext: extensionless
  // relative paths unsupported in ESM, write "./foo.js").
  {
    id: 'module-not-found-extension',
    // A dot in the basename is NOT an extension (user.model, auth.guard,
    // api.types): only a known module extension counts.
    test: (c) => {
      const t = esmPathNotFound(c.error);
      return Boolean(t) && !t.hasKnownExt;
    },
    build: (c) => {
      const target = c.error.match(/Cannot find module '([^']+)'/i)[1];
      const from = (c.error.match(/imported from (\S+)/) || [])[1];
      const hint = (c.error.match(/Did you mean to import "?([^"\s?]+)"?\?/) || [])[1];
      const base = maskSecrets(target.split(/[\\/]/).pop());
      const importerIsTs = Boolean(from && /\.m?ts$/.test(from));
      const isTs = ['.ts', '.mts'].includes(c.ext) || importerIsTs;
      const generic = { title: hint ? `Import "${maskSecrets(hint)}" (Node.js's own suggestion)` : `Add the extension: "./${base}.js"`, detail: 'The ES module loader resolves exactly the path you write — no .js/.json/index guessing like require().', code: `import { x } from './${base}.js';` };
      const tscFix = { title: 'Compiling with tsc (module: nodenext)?', detail: 'Write the extension of the emitted file — "./foo.js" — even though the source is foo.ts.', code: `import { x } from './${base}.js';` };
      const stripFix = { title: 'Running .ts directly with Node.js type stripping?', detail: 'Then the extension is .ts, because Node.js loads the source file (the Node.js TypeScript docs: import \'./file.ts\', not import \'./file\').', code: `import { x } from './${base}.ts';` };
      let fixes = [generic];
      if (isTs) {
        // A .ts IMPORTER means Node.js ran the source file (compiled output
        // would name a .js importer). With no TS runner in the scripts and a
        // version that strips types, the .ts extension is the direct fix.
        const runner = /ts-node|tsx/.test(c.scripts);
        const strips = hasFeature(c.version, 'stripTypesFlag') === true;
        fixes = importerIsTs && !runner && strips ? [stripFix, tscFix] : [generic, tscFix, stripFix];
      }
      return {
        title: 'ERR_MODULE_NOT_FOUND — relative import without a file extension',
        cause: `The import of "${maskSecrets(target)}"${from ? ` from ${maskSecrets(from)}` : ''} has no file extension, and ESM does not add one for you.`,
        why: 'In ES modules, a file extension must be provided for relative and absolute specifiers, and directory indexes must be fully specified. This matches how import works in browsers.',
        fixes,
        source: SOURCES.mandatoryExt,
      };
    },
  },

  // ERR_MODULE_NOT_FOUND on a path that already has a module extension: the
  // file simply is not where the specifier points (wrong path, missing build
  // output, or a .js specifier for a .ts source under type stripping).
  // Sources: errors.md ERR_MODULE_NOT_FOUND; typescript.md (type stripping
  // loads the source file, so the import names the .ts file).
  {
    id: 'module-not-found-file',
    test: (c) => {
      const t = esmPathNotFound(c.error);
      return Boolean(t) && t.hasKnownExt;
    },
    build: (c) => {
      const t = esmPathNotFound(c.error);
      const target = maskSecrets(t.target);
      const from = (c.error.match(/imported from (\S+)/) || [])[1];
      const hint = (c.error.match(/Did you mean to import "?([^"\s?]+)"?\?/) || [])[1];
      const importerIsTs = Boolean(from && /\.[mc]?ts$/.test(from));
      const jsForTs = importerIsTs && /\.[mc]?js$/i.test(t.lastSeg);
      const base = maskSecrets(t.lastSeg);
      const fixes = [];
      if (hint) fixes.push({ title: `Import "${maskSecrets(hint)}" (Node.js's own suggestion)`, detail: 'Node.js found a file with a different extension at that path.', code: `import { x } from '${maskSecrets(hint)}';` });
      if (jsForTs) {
        const tsName = base.replace(/\.([mc]?)js$/i, '.$1ts');
        fixes.push({ title: `Running .ts directly? Import "./${tsName}"`, detail: 'The importer is a .ts file, so Node.js is running your source with type stripping. It loads files as they exist on disk and does not map a .js specifier to the .ts source — the import must name the .ts file (tsconfig "allowImportingTsExtensions" lets tsc accept it).', code: `import { x } from './${tsName}';` });
      }
      fixes.push(
        { title: 'Check the path relative to the importing file', detail: 'Relative specifiers resolve from the file that contains the import, not from the current working directory. Check the spelling and letter case too: Linux file systems are case-sensitive, macOS and Windows usually are not.', code: from ? `ls "${maskSecrets(t.target)}"` : 'ls path/to/the/file.js' },
        { title: 'Make sure the build output exists', detail: 'If the importer lives in a build folder (dist/, build/), the imported file must have been emitted there too: rebuild, and check that your compiler includes that source file and that no step deletes it.', code: 'npx tsc && ls dist' },
      );
      return {
        title: 'ERR_MODULE_NOT_FOUND — no file at that path',
        cause: `The import of "${target}"${from ? ` from ${maskSecrets(from)}` : ''} names a file that does not exist at the resolved path.`,
        why: 'ERR_MODULE_NOT_FOUND is thrown when the ES module loader cannot resolve a specifier. For a relative or absolute path with an extension, Node.js looks for exactly that file — no fallback to other extensions or folders.',
        fixes,
        source: SOURCES.errModuleNotFound,
      };
    },
  },

  // ERR_MODULE_NOT_FOUND on a bare name ("Cannot find package"). Alias-shaped
  // names (tsconfig "paths" / baseUrl imports left in compiled output) get the
  // alias explanation, never `npm install <alias>`. Sources: errors.md;
  // typescript.md "Paths aliases"; packages.md "Subpath imports".
  {
    id: 'package-not-found',
    test: (c) => /Cannot find package '([^']+)'/i.test(c.error),
    build: (c) => {
      const raw = c.error.match(/Cannot find package '([^']+)'/i)[1];
      const name = maskSecrets(raw);
      const first = raw.split('/')[0];
      // "@/x" and "~/x" can never be npm package names: certain aliases.
      const isAlias = /^[@~]\//.test(raw) || /^~/.test(raw);
      // Names that are ALSO common project folders (baseUrl imports such as
      // 'src/db'). Some are real npm packages too, so this is a hint, not a verdict.
      const folderLike = /^(?:src|app|lib|libs|components|utils|config|server|client|shared|common|types|pages|modules|services|helpers|hooks|models|core)$/.test(first);
      if (isAlias) {
        return {
          title: `ERR_MODULE_NOT_FOUND — "${name}" looks like a path alias, not a package`,
          cause: `"${name}" is a bare specifier, so Node.js looked for a package with that name in node_modules. It reads like a tsconfig "paths" / "baseUrl" alias (or a bundler alias) that was never rewritten to a relative path.`,
          why: 'Node.js does not read tsconfig.json: "paths" aliases are not applied at runtime (the Node.js TypeScript docs say they produce an error), and tsc does not rewrite them in its output. Bundlers resolve aliases, plain Node.js does not. The closest built-in feature is subpath imports, which must start with #.',
          fixes: [
            { title: 'Use package.json "imports" (subpath imports)', detail: 'The Node.js-native alias. Keys must start with #; update the imports in your code to match.', code: '// package.json\n"imports": {\n  "#lib/*": "./dist/lib/*.js"\n}\n// code\nimport { db } from \'#lib/db\';' },
            { title: 'Or switch to relative imports', detail: 'Always resolvable, no configuration.', code: "import { db } from '../lib/db.js';" },
            { title: 'Or rewrite aliases at build time', detail: 'A bundler (esbuild, tsup, Vite) resolves aliases while building; a post-tsc step such as tsc-alias rewrites them in the emitted files.', code: '' },
            { title: 'Do not npm install this name', detail: `"${name}" is not a dependency. Installing whatever package happens to use that name on the public registry would pull unrelated code into your project.`, code: '' },
          ],
          source: SOURCES.tsPathsAliases,
          extraSource: SOURCES.subpathImports,
        };
      }
      const aliasFix = { title: `Is "${first}" a folder in your project?`, detail: `Then "${name}" is a tsconfig "baseUrl"/"paths" import, not a package. Node.js does not apply tsconfig at runtime and tsc does not rewrite it: use a relative import, or package.json "imports" (keys start with #). Do not npm install it.`, code: '// package.json\n"imports": {\n  "#src/*": "./dist/*.js"\n}' };
      return {
        title: `ERR_MODULE_NOT_FOUND — package "${name}" is not resolvable`,
        cause: `The ES module loader could not find "${name}" in any node_modules folder above the importing file.`,
        why: 'ERR_MODULE_NOT_FOUND is thrown when the ESM loader cannot resolve a specifier. For a bare name, that means no package with that name is installed where Node.js is looking.',
        ...(folderLike ? { extraSource: SOURCES.tsPathsAliases } : {}),
        fixes: [
          ...(folderLike ? [aliasFix] : []),
          { title: 'Is it in your dependencies?', detail: 'If package.json lists it, the install is missing where the code runs (a monorepo package, a Docker image, a CI job that skipped npm ci): reinstall there. npm ls shows whether it is installed.', code: `npm ls ${name}\nnpm ci   # reinstall what package.json declares` },
          { title: 'Check the spelling and the scope', detail: 'Scoped packages must include the scope: @scope/name. A typo here is a typo in the import.', code: '' },
          { title: 'Only then add it as a new dependency', detail: 'Confirm on npmjs.com that this is the package you mean (right name, right publisher) before installing — similarly named packages exist.', code: `npm install ${name}` },
        ],
        source: SOURCES.errModuleNotFound,
      };
    },
  },

  // Import assertions → attributes. Sources: esm.md history ("v22.0.0 Drop
  // support for import assertions"; attributes added v21.0.0, v20.10.0,
  // v18.20.0), CHANGELOG_V22 #52104.
  {
    id: 'import-assert',
    test: (c) => /Unexpected identifier '?assert'?/i.test(c.error) || (/\bassert\s*\{\s*type\s*:/.test(c.error) && /SyntaxError/i.test(c.error)),
    build: (c) => {
      const attrs = hasFeature(c.version, 'importAttributes');
      const removed = hasFeature(c.version, 'assertRemoved');
      const fixes = [
        { title: 'Replace assert with with', detail: 'Import attributes are the standardised form of import assertions; only the keyword changes.', code: "import data from './data.json' with { type: 'json' };\n// dynamic:\nconst { default: data2 } = await import('./data2.json', { with: { type: 'json' } });" },
      ];
      if (attrs === false) {
        fixes[0].detail += ` Note: your Node.js (${c.version.raw}) predates import attributes (${describeFeatureVersions('importAttributes')}) — upgrade, or use the fallback below.`;
      }
      fixes.push({ title: 'Version-proof fallback: read the JSON yourself', detail: 'Works on every Node.js version, no syntax to negotiate.', code: "import { readFileSync } from 'node:fs';\nconst data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));" });
      fixes.push({ title: 'Is the assert in a dependency?', detail: 'If the stack points into node_modules, the fix belongs to that package: check its changelog for a release that switched to with, then upgrade.', code: 'npm outdated' });
      return {
        title: "SyntaxError: Unexpected identifier 'assert'",
        cause: removed === true || removed === null
          ? "The code uses the old import assertions syntax (assert { type: 'json' }), which Node.js 22.0.0 removed."
          : "The code uses the import assertions syntax (assert { type: 'json' }).",
        why: 'Import assertions were replaced by import attributes, which use the with keyword. Node.js dropped the assert form in 22.0.0 (nodejs/node#52104); on 22+ the parser no longer recognises assert and reports it as an unexpected identifier.',
        fixes,
        source: SOURCES.importAttributes,
        extraSource: SOURCES.dropAssertions,
      };
    },
  },

  // ERR_IMPORT_ATTRIBUTE_MISSING (errors.md, added v21.1.0; esm.md: 'json' needed for JSON modules).
  {
    id: 'import-attribute-missing',
    // Version-aware: ERR_IMPORT_ASSERTION_TYPE_MISSING (added v17.1.0/v16.14.0,
    // removed v21.1.0, errors.md) only exists on Node.js lines that support the
    // assert keyword; `with` needs 21.0.0 / 20.10.0 / 18.20.0 (esm.md history),
    // and on older versions it is itself a SyntaxError.
    test: (c) => /ERR_IMPORT_ATTRIBUTE_MISSING|ERR_IMPORT_ASSERTION_TYPE_MISSING|needs an import (?:attribute|assertion) of/i.test(c.error),
    build: (c) => {
      const attrs = hasFeature(c.version, 'importAttributes');
      const assertionCode = /ERR_IMPORT_ASSERTION_TYPE_MISSING|needs an import assertion of/i.test(c.error);
      const useAssert = attrs === false || (assertionCode && attrs !== true);
      const withFix = { title: "Add with { type: 'json' }", detail: 'The attribute is required for JSON modules.', code: "import pkg from './package.json' with { type: 'json' };" };
      const fsFix = { title: 'Or read it with fs', detail: 'Works on every Node.js version, no syntax to negotiate.', code: "import { readFileSync } from 'node:fs';\nconst pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));" };
      if (useAssert) {
        const on = c.version ? `Your Node.js (${c.version.raw})` : 'The Node.js that printed ERR_IMPORT_ASSERTION_TYPE_MISSING';
        return {
          title: 'JSON imported without an import assertion',
          cause: "A .json file was imported without a type: 'json' assertion.",
          why: `${on} predates import attributes (the with keyword arrived in ${describeFeatureVersions('importAttributes')}), so the with form is a SyntaxError there; it uses the older assert keyword. Node.js 22.0.0 removed assert, so plan the switch to with when you upgrade.`,
          fixes: [
            { title: "Add assert { type: 'json' }", detail: 'The form your Node.js version understands.', code: "import pkg from './package.json' assert { type: 'json' };" },
            { title: 'Or upgrade Node.js and use with', detail: `with { type: 'json' } works from ${describeFeatureVersions('importAttributes')}; assert stops working in 22.0.0.`, code: "import pkg from './package.json' with { type: 'json' };" },
            fsFix,
          ],
          source: assertionCode ? SOURCES.errAssertionMissing : SOURCES.importAttributes,
          extraSource: SOURCES.importAttributes,
        };
      }
      return {
        title: 'JSON imported without an import attribute',
        cause: "A .json file was imported without with { type: 'json' }.",
        why: "In ES modules, Node.js only loads a JSON module when the import carries the type attribute set to 'json'.",
        fixes: [withFix, fsFix],
        source: SOURCES.importAttributes,
      };
    },
  },

  // ERR_PACKAGE_PATH_NOT_EXPORTED. Sources: errors.md; packages.md "Package
  // entry points" (exports encapsulation), "Conditional exports"
  // ("import" and "require" mutually exclusive; "module-sync"; "default").
  {
    id: 'package-path-not-exported',
    test: (c) => /ERR_PACKAGE_PATH_NOT_EXPORTED|is not defined by "exports"|No "exports" main defined/i.test(c.error),
    build: (c) => {
      const sub = c.error.match(/Package subpath '([^']+)' is not defined by "exports" in (\S+)/i);
      const noMain = /No "exports" main defined in (\S+)/i.exec(c.error);
      const pkgPath = (sub && sub[2]) || (noMain && noMain[1]) || '';
      const pm = pkgPath.match(/node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]package\.json/);
      const pkgName = pm ? pm[1].replace(/\\/g, '/') : null;
      const own = !pkgName && c.pkg.provided && c.pkg.exports !== undefined;
      if (noMain && !sub) {
        return {
          title: 'ERR_PACKAGE_PATH_NOT_EXPORTED — no entry for how you load it',
          cause: `${pkgName ? `"${pkgName}"` : 'The package'} defines "exports", but none of its root (".") conditions match the way your code loads it.`,
          why: 'Conditional exports pick an entry by how the package is loaded: "import" matches import/import(), "require" matches require(), and the two are mutually exclusive; "default" always matches. A package whose "." entry only lists "import" has nothing for require().',
          fixes: [
            { title: 'Load it the way the package supports', detail: 'If it only exports "import", switch to import — or dynamic import() from CommonJS.', code: `const mod = await import('${pkgName || 'the-package'}');` },
            { title: 'Check the package’s exports map', detail: 'See which conditions it actually declares.', code: `cat node_modules/${pkgName || 'the-package'}/package.json` },
          ],
          source: SOURCES.conditionalExports,
        };
      }
      const subpath = sub ? maskSecrets(sub[1]) : './internal/path';
      const declared = own ? exportSubpaths(c.pkg.exports) : [];
      const fixes = [
        { title: 'Import a documented entry point instead', detail: `Once a package defines "exports", every path not listed there is private — including deep paths like ${subpath}.`, code: `// ✗ import x from '${pkgName || 'the-package'}/${subpath.replace(/^\.\//, '')}'\nimport x from '${pkgName || 'the-package'}';` },
        { title: 'List what the package exports', detail: 'The keys of "exports" are the only subpaths you may import.', code: `node -p "Object.keys(require('./node_modules/${pkgName || 'the-package'}/package.json').exports || {})"` },
        { title: 'If an upgrade introduced it, pin the previous version while you migrate', detail: 'Adding "exports" to an existing package is usually a breaking change for deep imports.', code: `npm install ${pkgName || 'the-package'}@<previous-version>` },
      ];
      if (own) {
        fixes.unshift({ title: 'It is your own package.json: add the subpath to "exports"', detail: `Your "exports" currently declares: ${declared.length ? declared.join(', ') : '(could not read it)'}.`, code: `"exports": {\n  ".": "./index.js",\n  "${subpath}": "${subpath}.js"\n}` });
      }
      return {
        title: 'ERR_PACKAGE_PATH_NOT_EXPORTED — subpath is not in "exports"',
        cause: `${pkgName ? `"${pkgName}"` : 'The package'} does not export the subpath ${subpath}.`,
        why: 'When "exports" is defined, all subpaths of the package are encapsulated and no longer available to importers; "exports" also takes precedence over "main".',
        fixes,
        source: SOURCES.exportsEncapsulation,
      };
    },
  },
];

// ─── Entry point ────────────────────────────────────────────────────────────

/**
 * @param {{ error?: string, packageJson?: string, fileExt?: string, nodeVersion?: string }} input
 * @returns {{ findings: object[], context: object, notes: string[] }}
 */
export function explain(input = {}) {
  const error = String(input.error || '').slice(0, 50000);
  const pkg = parsePackageJson(input.packageJson);
  const facts = extractFromError(error);
  const notes = [];

  const typedVersion = parseVersion(input.nodeVersion);
  const loggedVersion = parseVersion(facts.nodeVersion);
  if (input.nodeVersion && String(input.nodeVersion).trim() && !typedVersion) {
    notes.push(`"${maskSecrets(String(input.nodeVersion).trim().slice(0, 40))}" is not a Node.js version (expected e.g. 22.12.0) — version-specific advice is generic.`);
  }
  if (typedVersion && loggedVersion && compareVersions(typedVersion, loggedVersion) !== 0) {
    notes.push(`You entered Node.js ${typedVersion.raw}, but the error was printed by Node.js ${loggedVersion.raw}. The advice below uses ${loggedVersion.raw} — the version that actually ran.`);
  }
  const version = loggedVersion || typedVersion || null;
  const ext = normaliseExtension(input.fileExt) || facts.ext || null;
  const type = pkg.type || facts.type || null;
  if (pkg.parseError) notes.push('package.json was not valid JSON; fields were read with a best-effort fallback.');

  // "type" is KNOWN only when a parseable package.json was pasted, or when the
  // error text itself names it. A missing paste is not a missing field.
  const typeKnown = Boolean(facts.type) || (pkg.provided && (!pkg.parseError || Boolean(pkg.type)));
  const scripts = scriptsText(pkg);
  const ctx = {
    error, pkg, version, ext, type, typeKnown, scripts,
    runsJest: /\bjest\b/.test(scripts) || /node_modules[\\/](?:jest-runtime|jest-circus|@jest)[\\/]/.test(error),
    runsTsNode: /\bts-node\b/.test(scripts) || /node_modules[\\/]ts-node[\\/]/.test(error),
  };
  const findings = [];
  if (error.trim()) {
    for (const rule of RULES) {
      if (rule.test(ctx)) findings.push({ id: rule.id, ...rule.build(ctx) });
    }
  }
  // ERR_REQUIRE_ASYNC_MODULE supersedes ERR_REQUIRE_ESM when both match.
  const ids = new Set(findings.map((f) => f.id));
  const out = ids.has('require-async-module') ? findings.filter((f) => f.id !== 'require-esm') : findings;

  return {
    findings: out.map((f) => ({ ...f, fixes: f.fixes.map((x) => ({ ...x, code: maskSecrets(x.code) })) })),
    context: { nodeVersion: version ? version.raw : null, versionSource: loggedVersion ? 'error' : typedVersion ? 'input' : null, type, typeKnown, ext, file: facts.file ? maskSecrets(facts.file) : null },
    notes,
  };
}

export const RULE_IDS = RULES.map((r) => r.id);
