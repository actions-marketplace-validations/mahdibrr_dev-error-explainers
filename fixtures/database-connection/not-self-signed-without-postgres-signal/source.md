# database-connection / not-self-signed-without-postgres-signal

**Negative case** — must not be diagnosed as `database-connection`.

**Provenance:** verbatim.

https://github.com/brianc/node-postgres/issues/2558 — the same string as `SELF_SIGNED_2558` in `test/database-connection-explainer.test.js` (fetched 2026-09-30). NEGATIVE. The snippet itself carries no Postgres signal (no port, no pg stack frame, no postgres:// URL): a TLS code printed by every Node.js client is not diagnosed without one.
