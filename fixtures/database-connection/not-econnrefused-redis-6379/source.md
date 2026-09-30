# database-connection / not-econnrefused-redis-6379

**Negative case** — must not be diagnosed as `database-connection`.

**Provenance:** verbatim.

https://github.com/redis/ioredis/issues/1036 — the same string as `nearMisses.redis` in `test/database-connection-explainer.test.js` (fetched 2026-09-30). Redis, same Node.js code: without a Postgres signal (port 5432/6543, pg stack frame, postgres:// URL) a generic network code is not diagnosed.
