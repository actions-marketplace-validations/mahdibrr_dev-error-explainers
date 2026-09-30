# The result contract

`dev-error-explainers` has seven modules with seven native result shapes. The contract gives every interface (the CLI with `--json`, the GitHub Action, the MCP server, the web page) one shape to share:

```js
import { diagnose } from 'dev-error-explainers/contract';

diagnose(text, { nodeVersion, client, only });
// → { version: '0.1', matched: boolean, redactions: number, results: Diagnosis[] }
```

It is kept small on purpose. There is no rule language and no scoring. The contract adds no diagnosis of its own. Each module is asked through its own recogniser, the same one `detect()` uses, and its native findings are mapped onto one shape.

## Result

| field | type | meaning |
|---|---|---|
| `version` | `'0.1'` | Contract version. It changes only when the shape changes or a rule id is renamed or removed. |
| `matched` | `boolean` | `results.length > 0`. |
| `redactions` | `number` | How many values `redact()` masked in the input. See [Redaction](#redaction). |
| `results` | `Diagnosis[]` | Ordered by severity (critical, warning, info), then by family order (the table below), then by the module's own order. |

### Diagnosis

```ts
interface Diagnosis {
  rule: string;          // stable id, e.g. 'esm.require-esm'
  family: 'cors' | 'esm-cjs' | 'npm-eresolve' | 'chunk-cache' | 'database-url' | 'next-build' | 'database-connection';
  title: string;         // the module's title (can include values from the paste, already redacted)
  severity: 'critical' | 'warning' | 'info';
  confidence: 'high' | 'medium';
  cause: string;
  why?: string;          // only when the module separates "why" from "cause"
  fixes: { title: string; detail?: string; code?: string }[];
  evidence: { url: string; label: string }[];   // where to read more (see below)
  module: string;        // e.g. 'esm-cjs-explainer'
}
```

`evidence` holds the primary sources (specs, vendor docs, browser / Node.js / npm / PostgreSQL source) the rule was checked against, for the cors, esm-cjs, npm-eresolve, chunk-cache and database-connection families. The build-error-decoder carries no primary-source URL, so `next-build` evidence is the linked article on iloveblogs.blog. `database-url` evidence is the primary source plus, on some rules, that article link.

The **stable** parts are `rule`, `family`, `severity`, `confidence` and `module`. Titles, causes, fixes and evidence are prose and may be reworded in any release. Test against the stable parts. The corpus in `fixtures/` does exactly that.

## Rule ids

A rule id is `<prefix>.<native id>`. The native id is the module's own finding id, so an id changes only when a module renames a finding. Renaming a finding is already a breaking change of that module. Prefixes: `cors`, `esm`, `npm-eresolve`, `chunk-cache`, `database-url`, `next-build`, `database-connection`. The database-connection module's own ids start with `db.`; the contract drops that prefix (`db.econnrefused` → `database-connection.econnrefused`).

Three families needed extra decisions:

- **npm-eresolve.** The module's findings (`conflict`, `range`, `chain`, `no-root-name`) describe one ERESOLVE report together. The contract therefore emits **one Diagnosis per report**. The rule is `npm-eresolve.conflict` for an error and `npm-eresolve.overriding-peer-dependency` for npm's warning. The `range` / `chain` findings go in `why`. A log with two reports gives two results with the same rule id. When npm printed `ERESOLVE` but no report could be parsed, the result is `npm-eresolve.unparsed`, at medium confidence.
- **chunk-cache.** The module compares two header dumps, one for the HTML page and one for a chunk, and a single paste is only one of them. The contract assigns a role only on explicit evidence:
  - a request target under `/_next/static/` → chunk;
  - otherwise `content-type: text/html` → HTML page;
  - otherwise a JavaScript or CSS content type → chunk;
  - anything else → **not diagnosed**.

  The module's `input-*` and `html-redirect` notes describe the input form, not the site, so they are never reported. `deployment-id-mismatch` needs both dumps, so a single paste cannot produce it: pass both to `diagnoseHeaders({ htmlHeaders, chunkHeaders })` (below).
- **database-url.** The doctor's corrected connection string (password written as `[YOUR-PASSWORD]`) has no field of its own in a Diagnosis. It is added as one more fix, titled `Corrected connection string (password masked)`, on the **first** database-url result only.

### Both chunk-cache dumps: `diagnoseHeaders`

```js
import { diagnoseHeaders } from 'dev-error-explainers/contract';

diagnoseHeaders({ htmlHeaders, chunkHeaders }); // same envelope as diagnose()
```

The CLI's `--html-headers` / `--chunk-headers` mode uses it. Only chunk-cache results come back, ordered by severity then the module's order. Both dumps are redacted first and `redactions` is the sum of the two counts.

### Confidence

| confidence | meaning |
|---|---|
| `high` | The module keys on an explicit signal: an exact error code (`ERR_REQUIRE_ESM`, `EADDRINUSE`, `ERESOLVE`, `ECONNREFUSED` next to a Postgres signal), an exact browser, Node.js, npm, Next.js, PostgreSQL or Prisma message, or a parsed header or URL component value. |
| `medium` | A looser pattern (`/env.*undefined/`, "stuck on compiling"), a generic fallback (`cors.unrecognised-cors`, `npm-eresolve.unparsed`), or a finding the module itself words as "check whether…" (`cors.preflight-maybe-unhandled`, `database-connection.prisma-p1017`, for which Prisma documents no cause). |

Confidence is a static property of the rule, listed in the table below. It is not computed per run. It is independent of severity: `database-url.missing-port` is `info` and `high` (the port is definitely absent), while `next-build.hydration-mismatch` is `warning` and `medium`.

### Unknown input: no guess

If no module recognises the text, the result is `{ matched: false, results: [] }`. The contract never falls back to a "closest match". A clean connection string, a healthy chunk, a successful build log and a random stack trace all give `matched: false`. `detect()` in `src/index.js` answers a different question ("which module would read this?"), so it can name a module for text that yields no Diagnosis. For example, a bare `HTTP/2 404` header dump has no evidence that it is a chunk, so `detect()` names the module but the contract gives no result.

### Options

| option | effect |
|---|---|
| `nodeVersion` | Passed to the esm-cjs explainer (a version printed in the error still wins). |
| `client` | `'prisma'` (default), `'drizzle'`, `'pg'`, `'psql'`: passed to the database-url doctor. |
| `only` | A family or an array of families. Other families are not run. Unknown names are ignored, so `only: 'nope'` runs nothing. |

## Redaction

`redact(text)` → `{ text, redactions }` (`dev-error-explainers/redact`) runs **before** any diagnosis. Every module except one receives the redacted text.

**What it masks** (each value becomes `[REDACTED]`):

- the password in URL userinfo: `scheme://user:PASSWORD@host`, including passwords that contain an unencoded `@` or `#`;
- header values of `Authorization` / `Proxy-Authorization` (the scheme word `Bearer`/`Basic`… is kept), `Cookie` (cookie names kept, every value masked), `Set-Cookie` (the value masked, attributes kept), `x-api-key`, `api-key`, `apikey`. This covers `Name: value` lines, `curl -v` `>` lines, `-H "…"` arguments and JS/JSON object keys;
- `NAME=value` assignments where one **word** of the name is a secret word: `key`, `token`, `secret`, `password`, `passwd`, `pass`, `pwd`, `credential(s)`, `private`, `auth`, `passphrase` (plus the compounds `apikey`, `authtoken`, `accesstoken`, …). This covers `.env` lines, `export`, query strings (`?access_token=`) and `.npmrc` (`:_authToken=`). A name whose last word describes the secret instead of holding it is left alone (`API_KEY_ID`, `POSTGRES_PASSWORD_FILE`, `NEXTAUTH_URL`);
- `Bearer <token>` anywhere;
- JWT-shaped strings (three base64url segments, the first starting `eyJ`);
- well-known prefixes: `ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`, `glpat-`, `npm_` (36 characters), `sk_live_`, `sk_test_`, `rk_live_`, `rk_test_`, `xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxe-`, `AKIA…`, `ASIA…`, `sb_secret_`.

**Guarantees:**

- Placeholders are not secrets and are not counted: `[YOUR-PASSWORD]`, `<token>`, `$VAR`, `${VAR}`, `{{ … }}`, `***`.
- `redact` is idempotent (a second pass reports 0) and deterministic.
- The whole input is redacted before it is truncated to 50 000 characters, so a token is never cut in half.
- Ordinary error text is left byte-for-byte: file paths, versions and prereleases, error codes, hashes, credential-free URLs, `git@host:repo`, e-mail addresses, CORS wordings that name the `Authorization` header, `npm_config_*` variables. `test/redact.test.js` pins these cases. Almost every fixture in the corpus has `redactions: 0`.

**The one exception: the database-url doctor.** Whether a password needs percent-encoding, and where the user/host split falls, depends on the password's exact characters. If the doctor received the redacted text, it would report `[REDACTED]` as a leftover template placeholder. It would also stop seeing an unencoded `@`. So the doctor receives the **raw `postgres://` line**, and only that line, never the rest of the paste. Its own contract is that the password never appears in its result: the components table masks it, and corrected strings use `[YOUR-PASSWORD]`. `test/contract.test.js` builds a distinctive secret for every family and checks that it never appears in `JSON.stringify(diagnose(…))`.

**What it does NOT catch:**

- Secrets with no marker. A random string on its own, in a variable called `DATABASE`, `STRIPE`, `CONN` or `DSN`, or in YAML/JSON `name: value` form (`password: hunter2`), is not masked. There is no entropy detection, on purpose: it would mask hashes, chunk ids and cf-ray values.
- Userinfo without a scheme (`user:pass@host`), and a user name that is itself sensitive.
- Provider-specific token formats not listed above: OpenAI, Anthropic, Google API keys, Azure connection strings, SendGrid, Twilio, private-key PEM blocks.
- Secrets split across lines, or inside URL-encoded / base64-encoded blobs other than JWTs.
- Header values of custom auth headers (`x-access-token`, `x-supabase-auth`, …) that are not in the list. The chunk-cache module masks some of these itself in its own output.
- It can over-redact. A value after `Bearer` in prose is masked even if it is not a token, and a `NAME=value` pair whose name happens to contain `key` or `pass` as a word is masked.

Treat redaction as a guard against the common leaks, not as a guarantee that a paste is safe to publish.

## Fixtures

`fixtures/<family>/<case>/` holds `input.txt` (verbatim), `expected.json` (the stable parts only: `matched`, `redactions`, and `rule` / `family` / `severity` of each result, in order; negatives add `absentFamilies`; optional `options`) and `source.md` (provenance: the Stack Overflow question, GitHub issue or test file the input comes from, or "synthetic"). `test/fixtures.test.js` runs `diagnose()` over every case.

## Rule table

<!-- rule-table:start -->
121 rules. Generated from `RULES` in `src/contract.js`; `test/contract.test.js` fails if this table differs from it.

### cors (25, module `cors-error-explainer`)

| rule | title | confidence |
|---|---|---|
| `cors.missing-allow-origin` | No Access-Control-Allow-Origin header on the response | high |
| `cors.origin-not-allowed` | The origin is not in the allowed list | high |
| `cors.wildcard-with-credentials` | Access-Control-Allow-Origin "*" with a credentialed request | high |
| `cors.multiple-allow-origin` | Access-Control-Allow-Origin sent more than once | high |
| `cors.allow-origin-mismatch` | Access-Control-Allow-Origin does not match the requesting origin | high |
| `cors.invalid-allow-origin` | Access-Control-Allow-Origin has an invalid value | high |
| `cors.allow-credentials-not-true` | Access-Control-Allow-Credentials is not "true" | high |
| `cors.preflight-not-ok` | The preflight (OPTIONS) response is not a 2xx | high |
| `cors.preflight-redirect` | The preflight was redirected | high |
| `cors.header-not-allowed` | A request header is not in Access-Control-Allow-Headers | high |
| `cors.method-not-allowed` | The method is not in Access-Control-Allow-Methods | high |
| `cors.invalid-allow-token` | Invalid token in Access-Control-Allow-Headers / -Methods | high |
| `cors.request-did-not-succeed` | The request never got a response (not a CORS problem) | high |
| `cors.preflight-channel-failed` | The CORS preflight channel failed | high |
| `cors.not-http` | The request URL is not http(s) | high |
| `cors.mixed-content` | Mixed content: an https page calling an http URL | high |
| `cors.vary-origin-missing` | Origin-dependent response without Vary: Origin | high |
| `cors.auth-not-covered-by-wildcard` | Authorization is not covered by Access-Control-Allow-Headers "*" | high |
| `cors.wildcard-lists-with-credentials` | Wildcard allow-lists do not apply to credentialed requests | high |
| `cors.preflight-maybe-unhandled` | A 401/403/404/405 without CORS headers — possibly an unhandled preflight | medium |
| `cors.server-error-behind-cors` | A server error hidden behind the CORS message | high |
| `cors.no-cors-opaque` | mode: 'no-cors' returns an unreadable opaque response | high |
| `cors.no-cors-suggestion` | Chrome's "set the request's mode to 'no-cors'" suggestion | high |
| `cors.safari-generic` | Safari's generic "due to access control checks" line | medium |
| `cors.unrecognised-cors` | A CORS block whose reason was not in the paste | medium |

### esm-cjs (14, module `esm-cjs-explainer`)

| rule | title | confidence |
|---|---|---|
| `esm.require-async-module` | require() of an ES module graph with top-level await | high |
| `esm.require-esm` | ERR_REQUIRE_ESM: require() of an ES module | high |
| `esm.import-outside-module` | Cannot use import statement outside a module | high |
| `esm.cjs-global-in-esm` | A CommonJS global (require, module, __dirname…) used in an ES module | high |
| `esm.ts-in-node-modules` | Type stripping refused for TypeScript under node_modules | high |
| `esm.ts-unsupported-syntax` | TypeScript syntax that type stripping cannot handle | high |
| `esm.unknown-file-extension` | ERR_UNKNOWN_FILE_EXTENSION | high |
| `esm.dir-import` | Directory import is not supported in ES modules | high |
| `esm.module-not-found-extension` | ES module import without a file extension | high |
| `esm.module-not-found-file` | ES module import of a file that does not exist | high |
| `esm.package-not-found` | Cannot find package (ES module resolution) | high |
| `esm.import-assert` | Import assertions (assert { type }) are no longer supported | high |
| `esm.import-attribute-missing` | JSON / non-JS import without an import attribute | high |
| `esm.package-path-not-exported` | Subpath not exported by the package "exports" | high |

### npm-eresolve (3, module `npm-eresolve-explainer`)

| rule | title | confidence |
|---|---|---|
| `npm-eresolve.conflict` | npm ERESOLVE: a dependency range cannot be satisfied | high |
| `npm-eresolve.overriding-peer-dependency` | npm WARN ERESOLVE overriding peer dependency | high |
| `npm-eresolve.unparsed` | npm ERESOLVE, but the report could not be parsed | medium |

### chunk-cache (25, module `chunk-cache-explainer`)

| rule | title | confidence |
|---|---|---|
| `chunk-cache.html-immutable` | HTML document marked immutable | high |
| `chunk-cache.html-browser-max-age` | HTML document cached by the browser (max-age) | high |
| `chunk-cache.html-expires` | HTML document cached by the browser until Expires | high |
| `chunk-cache.html-heuristic-freshness` | HTML document can be reused heuristically (Last-Modified, no freshness) | medium |
| `chunk-cache.html-shared-cacheable` | HTML document storable by a shared cache | high |
| `chunk-cache.html-cf-cache-hit` | Cloudflare served the HTML from its cache | high |
| `chunk-cache.html-cf-cache-eligible` | Cloudflare treats the HTML as cache-eligible | high |
| `chunk-cache.html-nginx-cache-hit` | nginx proxy_cache served the HTML | high |
| `chunk-cache.html-vercel-cache-hit` | Vercel CDN served the HTML from cache | high |
| `chunk-cache.html-netlify-cache-hit` | Netlify Edge served the HTML from cache | high |
| `chunk-cache.html-cache-status-hit` | Cache-Status hit on the HTML document | high |
| `chunk-cache.html-age` | HTML document sat in a proxy cache (Age > 0) | high |
| `chunk-cache.chunk-redirect` | The chunk request is redirected | high |
| `chunk-cache.chunk-missing` | The chunk answers 404/410: the hashed file is gone | high |
| `chunk-cache.chunk-404-cached` | Cloudflare is serving a cached 404 for the chunk | high |
| `chunk-cache.chunk-server-error` | The chunk answers 5xx | high |
| `chunk-cache.chunk-blocked` | The chunk answers a 4xx other than 404/410 | high |
| `chunk-cache.chunk-revalidated` | The chunk answers 304 Not Modified | high |
| `chunk-cache.chunk-html-fallback` | The chunk URL answers 200 with text/html | high |
| `chunk-cache.chunk-wrong-mime` | The chunk has a non-JavaScript MIME type under nosniff | high |
| `chunk-cache.chunk-css-wrong-mime` | The CSS chunk has a Content-Type other than text/css | high |
| `chunk-cache.chunk-not-immutable` | The chunk is not cached as immutable | high |
| `chunk-cache.chunk-not-static-path` | The chunk path is not under /_next/static/ | high |
| `chunk-cache.deployment-id-mismatch` | HTML and chunk carry different deployment ids | high |
| `chunk-cache.service-worker-cache` | A service worker can serve old HTML | medium |

### database-url (27, module `database-url-doctor`)

| rule | title | confidence |
|---|---|---|
| `database-url.placeholder-left` | Template placeholder left in the connection string | high |
| `database-url.password-needs-encoding` | Unencoded characters in the password or user name | high |
| `database-url.dollar-in-password` | The password contains "$" (expanded by Next.js .env) | high |
| `database-url.invalid-port` | The port is not a valid port number | high |
| `database-url.host-invalid` | The host contains a character a host cannot have | high |
| `database-url.supabase-api-host` | Supabase API host used as a database host | high |
| `database-url.pooler-username` | Supabase shared pooler needs user "&lt;role>.&lt;project-ref>" | high |
| `database-url.direct-username` | Supabase direct connection uses plain "postgres" | high |
| `database-url.pooler-port` | Unexpected or missing port on a Supabase host | high |
| `database-url.direct-ipv6` | Supabase direct host is IPv6 unless the IPv4 add-on is enabled | high |
| `database-url.prisma-pgbouncer-missing` | Transaction mode with Prisma without ?pgbouncer=true | high |
| `database-url.prisma-pgbouncer-unneeded` | pgbouncer=true on a session / direct connection | high |
| `database-url.drizzle-prepare-false` | Transaction mode with postgres.js needs { prepare: false } | high |
| `database-url.pg-named-queries` | Transaction mode with pg: avoid named queries | high |
| `database-url.pgbouncer-param-wrong-client` | pgbouncer=true is a Prisma-only flag | high |
| `database-url.migrations-through-transaction-pooler` | Migrations / psql through the transaction pooler (6543) | high |
| `database-url.prisma-migrations-url` | Where Prisma reads the migration URL | high |
| `database-url.sslmode-invalid` | Invalid sslmode value | high |
| `database-url.sslmode-disable-supabase` | SSL disabled on a Supabase connection | high |
| `database-url.sslmode-missing-supabase` | No sslmode on a Supabase connection | high |
| `database-url.prisma7-sslmode` | Prisma 7 reads sslmode as full certificate verification | high |
| `database-url.pg-sslmode-verifies` | node-postgres reads sslmode as full certificate verification | high |
| `database-url.pg-sslmode-no-verify` | sslmode=no-verify turns certificate verification off | high |
| `database-url.missing-database` | No database name in the URL | high |
| `database-url.missing-port` | No port in the URL | high |
| `database-url.localhost` | localhost only works on the machine running the code | high |
| `database-url.missing-user` | No user name in the URL | high |

### next-build (14, module `build-error-decoder`)

| rule | title | confidence |
|---|---|---|
| `next-build.suspense-searchparams` | useSearchParams() needs a &lt;Suspense> boundary | high |
| `next-build.chunk-load-error` | ChunkLoadError: a JavaScript chunk failed to load | high |
| `next-build.dynamic-server-usage` | Dynamic server usage during static rendering | high |
| `next-build.window-undefined` | Browser global (window / document / self) used on the server | high |
| `next-build.module-not-found` | Module not found: Can't resolve | high |
| `next-build.tsconfig-paths` | The "@/" path alias does not resolve | high |
| `next-build.heap-oom` | JavaScript heap out of memory | high |
| `next-build.hydration-mismatch` | Hydration mismatch between server and client | medium |
| `next-build.turbopack-stuck` | Dev server stuck on compiling | medium |
| `next-build.port-in-use` | EADDRINUSE: the port is already in use | high |
| `next-build.env-undefined` | Environment variable undefined | medium |
| `next-build.next-babel` | Cannot find module 'next/babel' | high |
| `next-build.image-hostname` | next/image hostname is not configured | high |
| `next-build.next-lint-removed` | `next lint` is removed / deprecated | medium |

### database-connection (13, module `database-connection-explainer`)

| rule | title | confidence |
|---|---|---|
| `database-connection.econnrefused-ipv6-localhost` | ECONNREFUSED on ::1 only: localhost resolved to the IPv6 loopback | high |
| `database-connection.econnrefused` | ECONNREFUSED: nothing accepted the TCP connection | high |
| `database-connection.etimedout` | connect ETIMEDOUT: the server never answered | high |
| `database-connection.enotfound` | getaddrinfo ENOTFOUND: the host name did not resolve | high |
| `database-connection.eai-again` | getaddrinfo EAI_AGAIN: temporary name-resolution failure | high |
| `database-connection.prisma-p1001` | Prisma P1001: can't reach the database server | high |
| `database-connection.prisma-p1000` | Prisma P1000: authentication failed | high |
| `database-connection.prisma-p1017` | Prisma P1017: the server closed the connection | medium |
| `database-connection.password-auth-failed` | PostgreSQL: password authentication failed for user | high |
| `database-connection.pg-hba-no-entry` | PostgreSQL: no pg_hba.conf entry for host | high |
| `database-connection.too-many-connections` | PostgreSQL: too many clients / connection slots reserved | high |
| `database-connection.tls-self-signed` | Self-signed certificate in the chain (PostgreSQL TLS) | high |
| `database-connection.server-no-ssl` | The server does not support SSL connections | high |
<!-- rule-table:end -->
