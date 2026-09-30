# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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

[0.1.0]: https://github.com/mahdibrr/dev-error-explainers/releases/tag/v0.1.0
