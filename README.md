# dev-error-explainers

[![npm version](https://img.shields.io/npm/v/dev-error-explainers.svg)](https://www.npmjs.com/package/dev-error-explainers)
[![test](https://github.com/mahdibrr/dev-error-explainers/actions/workflows/test.yml/badge.svg)](https://github.com/mahdibrr/dev-error-explainers/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Paste an error. Get a deterministic explanation.**

No LLM · no API · no network · no telemetry

```bash
npm install dev-error-explainers
```

```js
import { detect, explainEsmCjs } from 'dev-error-explainers';
const error = 'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.';
console.log(detect(error));
const { findings } = explainEsmCjs({ error, nodeVersion: '20.10.0' });
console.log(findings[0].title, findings[0].fixes.map((f) => f.title));
```

Output:

```text
[ 'esm-cjs-explainer' ]
ERR_REQUIRE_ESM — require() of an ES module [
  'Upgrade Node.js (you are on 20.10.0)',
  'Use dynamic import() from CommonJS',
  'Convert the calling file to ESM'
]
```

Six small, **pure** JavaScript modules with zero dependencies. Each one recognises the
exact error text a developer pastes (from the browser console, `npm`, `next build`,
`curl -I`…), explains *why* it happens, and returns concrete fixes with a link to the
primary source where one exists (MDN, the Node.js docs, the npm docs, the Supabase
docs…). Five of the six mask anything that looks like a secret (tokens, passwords,
cookies, API keys) before echoing it back; **the build-error decoder does not** — it
quotes the matching lines of your build output as they are.

They power the free tools on **[iloveblogs.blog/tools](https://www.iloveblogs.blog/tools)**,
where you can try each one in the browser.

| Module | Main export (`dev-error-explainers`) | What it explains | Try it live |
|---|---|---|---|
| `cors-error-explainer` | `diagnoseCors` | Chrome / Firefox / Safari "blocked by CORS policy" errors: missing or wrong `Access-Control-Allow-*` headers, preflight failures, credentials, mixed content — with a fix for your stack | [CORS Error Explainer](https://www.iloveblogs.blog/tools/cors-error-explainer) |
| `esm-cjs-explainer` | `explainEsmCjs` | `ERR_REQUIRE_ESM`, "Cannot use import statement outside a module", "exports is not defined in ES module scope", `ERR_UNKNOWN_FILE_EXTENSION ".ts"`, `ERR_MODULE_NOT_FOUND`, `ERR_PACKAGE_PATH_NOT_EXPORTED` — aware of your Node.js version | [ESM/CJS Error Explainer](https://www.iloveblogs.blog/tools/esm-cjs-error-explainer) |
| `npm-eresolve-explainer` | `analyseEresolveLog` | `npm ERR! ERESOLVE` peer-dependency conflicts: who asks for which range, what is installed, and why they do not intersect | [npm ERESOLVE Explainer](https://www.iloveblogs.blog/tools/npm-eresolve-explainer) |
| `chunk-cache-explainer` | `diagnoseChunkCache` | `ChunkLoadError` / "Loading chunk failed" after a deploy: reads your response headers and finds the stale HTML, the CDN cache hit or the SPA fallback | [ChunkLoadError Cache Checker](https://www.iloveblogs.blog/tools/chunkloaderror-cache-checker) |
| `database-url-doctor` | `diagnoseDatabaseUrl` | Postgres / Supabase connection strings: pooler vs direct, port 5432 vs 6543, `pgbouncer`, SSL, unencoded password characters — with a corrected URL for Prisma, Drizzle, `pg` or `psql` | [DATABASE_URL Doctor](https://www.iloveblogs.blog/tools/supabase-database-url-doctor) |
| `build-error-decoder` | `decodeBuildError` | Failing `next build` / `next dev` output: Suspense bailouts, dynamic server usage, `window is not defined`, hydration mismatches, module resolution, heap out of memory, `EADDRINUSE`… | [Next.js Build Error Decoder](https://www.iloveblogs.blog/tools/nextjs-build-error-decoder) |

Node.js 20 or later. ES modules only.

## Usage

Everything is available from the package root, and each module can also be imported on
its own:

```js
import { diagnose } from 'dev-error-explainers/cors-error-explainer';

const r = diagnose({
  error: "Access to fetch at 'https://api.example.com/data' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
});
r.isCorsProblem; // true
r.findings;      // what is wrong, why, and the source
r.fix;           // a fix for the detected (or guessed) stack
```

```js
import {
  analyseEresolveLog, diagnoseDatabaseUrl, diagnoseChunkCache, decodeBuildError,
} from 'dev-error-explainers';

analyseEresolveLog(npmOutput);                                        // { detected, code, conflicts: [...] }
diagnoseDatabaseUrl(process.env.DATABASE_URL, { client: 'prisma' }); // { ok, kind, findings, corrected }
diagnoseChunkCache({ htmlHeaders, chunkHeaders });                    // headers from `curl -I`
decodeBuildError(nextBuildOutput);                                    // matched rules, most severe first
```

### `detect(text)`

Returns the names of the modules that recognise `text`, in a fixed order, or `[]`.
Each module is asked through its own recogniser — `detect` adds no heuristics of its own.
Note that `chunk-cache-explainer` reads HTTP response headers (the output of `curl -I`),
not the `ChunkLoadError` message itself; the message alone is recognised by
`build-error-decoder`.

## CLI

Pipe a failing command into it, or pass a log file. Nothing is sent anywhere.

```bash
npm run build 2>&1 | npx dev-error-explainers
npx dev-error-explainers < error.log
npx dev-error-explainers --text "Error [ERR_REQUIRE_ESM]: require() of ES Module …" --node 18.17.0
npx dev-error-explainers --json < error.log     # machine-readable output
```

Flags: `--only cors|esm|eresolve|build|database-url|chunk-cache`, `--json`, `--node <version>`,
`--client prisma|drizzle|pg|psql`, `--html-headers <file> --chunk-headers <file>`, `--help`, `--version`.

Exit codes: `0` an error was recognised, `2` nothing recognised (nothing is guessed), `64` usage error.
A connection string is always printed with its password masked; build-log lines echoed by the
build decoder are passed through the same secret masking.

## Principles

- **Deterministic.** The same input always gives the same answer; the rules are tested
  against real error text (Stack Overflow questions, GitHub issues, framework output).
- **Offline.** Nothing is sent anywhere: the input never leaves the process.
- **Cited where possible.** Findings link to the documentation that states the rule, where
  one exists — not every rule cites a source.
- **Honest about unknowns.** An error the module does not recognise is reported as not
  recognised, never guessed.

## Tests

```bash
npm install
npm test
```

CI runs the suite on Node.js 20, 22 and 24.

## Contributing

**Unrecognised error? [Open an issue](https://github.com/mahdibrr/dev-error-explainers/issues/new/choose)
with the exact text.** Paste the error as printed, the command that produced it, and the
tool versions. A new rule needs a test built from a real error. A diagnosis that is wrong
is a bug too — there is a separate template for that.

## License

[MIT](LICENSE)
