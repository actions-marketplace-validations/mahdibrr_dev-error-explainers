# database-connection / node17-econnrefused-ipv6-localhost

**Provenance:** verbatim.

https://github.com/brianc/node-postgres/issues/2643 — the same string as `NODE17_V6` in `test/database-connection-explainer.test.js` (fetched 2026-09-30). Node.js 17.0.1, `localhost` resolved to `::1` only.
