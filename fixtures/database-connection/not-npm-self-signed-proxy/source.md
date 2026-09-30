# database-connection / not-npm-self-signed-proxy

**Negative case** — must not be diagnosed as `database-connection`.

**Provenance:** verbatim.

https://github.com/npm/cli/issues/2974 — the same string as `nearMisses.npmSelfSigned` in `test/database-connection-explainer.test.js` (fetched 2026-09-30). npm behind a TLS-intercepting proxy: the same TLS code, not a database.
