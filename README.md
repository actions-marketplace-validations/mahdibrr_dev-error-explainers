# dev-error-explainers

Paste a developer error, get the real cause and the fix.

Six small, **pure** JavaScript modules: no dependencies, no network, no LLM. Each one
recognises the exact error text a developer pastes (from the browser console, `npm`,
`next build`, `curl -I`…), explains *why* it happens, and returns concrete fixes with a
link to the primary source where one exists (MDN, the Node.js docs, the npm docs, the
Supabase docs…). Five of the six mask anything that looks like a secret (tokens,
passwords, cookies, API keys) before echoing it back; the build-error decoder quotes the
matching lines of your build output as they are.

They power the free tools on **[iloveblogs.blog/tools](https://www.iloveblogs.blog/tools)**,
where you can try each one in the browser.

| Module | What it explains | Try it live |
|---|---|---|
| `cors-error-explainer` | Chrome / Firefox / Safari "blocked by CORS policy" errors: missing or wrong `Access-Control-Allow-*` headers, preflight failures, credentials, mixed content — with a fix for your stack | [CORS Error Explainer](https://www.iloveblogs.blog/tools/cors-error-explainer) |
| `esm-cjs-explainer` | `ERR_REQUIRE_ESM`, "Cannot use import statement outside a module", "exports is not defined in ES module scope", `ERR_UNKNOWN_FILE_EXTENSION ".ts"`, `ERR_MODULE_NOT_FOUND`, `ERR_PACKAGE_PATH_NOT_EXPORTED` — aware of your Node.js version | [ESM/CJS Error Explainer](https://www.iloveblogs.blog/tools/esm-cjs-error-explainer) |
| `npm-eresolve-explainer` | `npm ERR! ERESOLVE` peer-dependency conflicts: who asks for which range, what is installed, and why they do not intersect | [npm ERESOLVE Explainer](https://www.iloveblogs.blog/tools/npm-eresolve-explainer) |
| `chunk-cache-explainer` | `ChunkLoadError` / "Loading chunk failed" after a deploy: reads your response headers and finds the stale HTML, the CDN cache hit or the SPA fallback | [ChunkLoadError Cache Checker](https://www.iloveblogs.blog/tools/chunkloaderror-cache-checker) |
| `database-url-doctor` | Postgres / Supabase connection strings: pooler vs direct, port 5432 vs 6543, `pgbouncer`, SSL, unencoded password characters — with a corrected URL for Prisma, Drizzle, `pg` or `psql` | [DATABASE_URL Doctor](https://www.iloveblogs.blog/tools/supabase-database-url-doctor) |
| `build-error-decoder` | Failing `next build` / `next dev` output: Suspense bailouts, dynamic server usage, `window is not defined`, hydration mismatches, module resolution, heap out of memory, `EADDRINUSE`… | [Next.js Build Error Decoder](https://www.iloveblogs.blog/tools/nextjs-build-error-decoder) |

## Install

```bash
npm install github:mahdibrr/dev-error-explainers
```

Node.js 20 or later. ES modules only.

## Usage

```js
import { explain } from 'dev-error-explainers/esm-cjs-explainer';

const { findings } = explain({
  error: 'Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/node-fetch/src/index.js from /app/index.js not supported.',
  nodeVersion: '20.10.0',
});
console.log(findings[0].title); // "ERR_REQUIRE_ESM — require() of an ES module"
console.log(findings[0].fixes); // [{ title, detail, code }, …]
```

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
import { analyseEresolveLog } from 'dev-error-explainers/npm-eresolve-explainer';
import { diagnose as checkUrl } from 'dev-error-explainers/database-url-doctor';
import { diagnose as checkHeaders } from 'dev-error-explainers/chunk-cache-explainer';
import { decode } from 'dev-error-explainers/build-error-decoder';

analyseEresolveLog(npmOutput);                                  // { detected, code, conflicts: [...] }
checkUrl(process.env.DATABASE_URL, { client: 'prisma' });      // { ok, kind, findings, corrected }
checkHeaders({ htmlHeaders, chunkHeaders });                    // headers from `curl -I`
decode(nextBuildOutput);                                        // matched rules, most severe first
```

## Principles

- **Deterministic.** The same input always gives the same answer; the rules are tested
  against real error text (Stack Overflow questions, GitHub issues, framework output).
- **Offline.** Nothing is sent anywhere: the input never leaves the process.
- **Cited.** Findings link to the documentation that states the rule, where one exists.
- **Honest about unknowns.** An error the module does not recognise is reported as not
  recognised, never guessed.

## Tests

```bash
npm install
npm test
```

## Contributing

An error that should be recognised but is not? Open an issue with the **exact** error text
and where it came from. A new rule needs a test built from a real error.

## License

MIT
