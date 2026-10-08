# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-10-08

No change to the library, the CLI, the Action or the MCP tool.

### Changed

- `server.json`: `websiteUrl` points at the project page, https://www.iloveblogs.blog/open-source,
  instead of `docs/MCP.md` (the MCP setup guide stays linked from the README).
- Issue templates list the seventh module, `database-connection-explainer`.

## [0.2.0] - 2026-09-30

### Breaking

- **`dev-error-explainers --json` now prints the contract result** (`diagnose()`, see
  `docs/CONTRACT.md`) instead of the 0.1.0 report. Scripts parsing 0.1.0's JSON must change:
  - Top level: 0.1.0 `{ tool, version, input: { source, bytes }, recognised, results }` →
    0.2.0 `{ version, matched, redactions, results }`. **`version` changes meaning**: it was the
    package version (`"0.1.0"`), it is now the contract version (`"0.1"`); use `--version` for
    the package. `recognised` → `matched`. `tool` and `input` are gone; `redactions` is new.
  - `results`: 0.1.0 had one entry per module
    (`{ module, label, verdict, notes, findings[], snippet, corrected, extra }`); 0.2.0 has one
    flat `Diagnosis` per finding (`{ rule, family, title, severity, confidence, cause, why?,
    fixes, evidence, module }`), sorted by severity, then family, then module order. A module
    can therefore appear several times.
  - Finding ids: the native `id` (`require-esm`, `eresolve-conflict-1`) → a stable, prefixed
    `rule` (`esm.require-esm`, `npm-eresolve.conflict`).
  - `source` / `sources` (URL strings) → `evidence: [{ url, label }]`. The build decoder's
    echoed `evidence` line (`"line 14: …"`) is no longer in the JSON (the human output still
    prints it).
  - The CORS server snippet (`snippet`) and the corrected connection string (`corrected`) are
    now fixes (`Server fix (<stack>)`, `Corrected connection string (password masked)`).
  - `verdict`, `notes` and `extra` are gone. Fix objects no longer carry `null` members
    (`{ title, detail?, code? }`).
  - The input is now passed through `redact()` before it is analysed. The one exception, as
    documented in `docs/CONTRACT.md`: the DATABASE_URL doctor reads the raw `postgres://` line,
    and its result never contains the password.

### Added

- `database-connection-explainer` (7th module, root export `explainDatabaseConnection`):
  "can't connect to the database" errors from Node.js apps on PostgreSQL — 13 rules
  (`ECONNREFUSED` incl. `::1`-only, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, Prisma
  `P1000`/`P1001`/`P1017`, `password authentication failed`, `no pg_hba.conf entry`, too many
  connections, self-signed certificate, server without SSL), each checked against a primary
  source (`docs/rules/database-connection.md`). Generic network/TLS codes are only diagnosed
  next to a Postgres signal. Wired into `detect()`, the contract, the CLI
  (`--only database-connection`), the Action and the MCP server.
- **Contract** (`dev-error-explainers/contract`; root exports `diagnose`, `CONTRACT_RULES`,
  `FAMILIES`, `CONTRACT_VERSION`): one normalised result for every module, stable rule ids
  with a static confidence, "unknown = `matched: false`, never a guess", drift tests against
  every module. `diagnoseHeaders({ htmlHeaders, chunkHeaders })` for the two-dump chunk-cache
  case. Rule table generated into `docs/CONTRACT.md`.
- **`redact(text)`** (`dev-error-explainers/redact`, root export): conservative credential
  masking (URL passwords, auth/cookie/API-key headers, secret-named assignments, bearer
  tokens, JWTs, well-known token prefixes); its limits are documented.
- **Fixtures corpus** (`fixtures/`, in the repository, not in the npm package): 74 real or
  labelled-synthetic cases, at least 5 positive and 2 negative per family, each with its source.
- **GitHub Action** (`action.yml`, runtime `node24`): explains a failed CI step's log in the job
  summary, with file/line annotations when the log names a file in the checkout
  (`docs/ACTION.md`).
- **MCP server** (`dev-error-explainers-mcp` binary, or `dev-error-explainers mcp`): one tool,
  `explain_error`, over stdio, zero dependencies (`docs/MCP.md`, `server.json` for the MCP
  Registry, `mcpName` in `package.json`).
- **Claude Code plugin** (in the repository, not in the npm package): `.claude-plugin/`
  marketplace + plugin bundling the MCP server and the `explain-dev-error` skill.

### Changed

- The CLI, the GitHub Action and the MCP server share one normaliser, `src/contract.js`
  (display helpers in `src/format.js`); the Action no longer carries its own copy and the MCP
  server no longer falls back to spawning the CLI.
- CLI human output: the rule id is printed after the severity, extra sources are listed as
  "See also", the CORS server snippet and the corrected connection string appear as the last
  fix of their finding, and the chunk-cache `Verdict:` line, ESM `Note:` lines and the CORS
  snippet's notes are no longer printed (the contract shape does not carry them). Otherwise unchanged.
- `--only` also accepts `next-build`.

## [0.1.0] - 2026-09-30

First npm release.

### Added

- Six pure, offline, zero-dependency explainers, each importable on its own:
  - `cors-error-explainer` — browser "blocked by CORS policy" errors and response headers.
  - `esm-cjs-explainer` — `ERR_REQUIRE_ESM` and the other ESM/CommonJS interop errors, Node.js-version aware.
  - `npm-eresolve-explainer` — `npm ERR! ERESOLVE` peer-dependency conflicts.
  - `chunk-cache-explainer` — `ChunkLoadError` after a deploy, from `curl -I` headers.
  - `database-url-doctor` — Postgres / Supabase connection strings, with a corrected URL per client.
  - `build-error-decoder` — failing `next build` / `next dev` output.
- Package root entry (`dev-error-explainers`) re-exporting each main function under a
  distinct name (`diagnoseCors`, `explainEsmCjs`, `analyseEresolveLog`,
  `diagnoseChunkCache`, `diagnoseDatabaseUrl`, `decodeBuildError`).
- `detect(text)`: the list of modules whose own recogniser matches a pasted text.
- Release workflow publishing to npm with Trusted Publishing (OIDC) and provenance.

[0.2.1]: https://github.com/mahdibrr/dev-error-explainers/releases/tag/v0.2.1
[0.2.0]: https://github.com/mahdibrr/dev-error-explainers/releases/tag/v0.2.0
[0.1.0]: https://github.com/mahdibrr/dev-error-explainers/releases/tag/v0.1.0
