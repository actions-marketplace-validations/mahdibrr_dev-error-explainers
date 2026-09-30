# database-url / not-mysql-url

**Negative case** — must not be diagnosed as `database-url`.

**Provenance:** synthetic.

From `test/database-url-doctor.test.js` and `test/index.test.js`: a MySQL URL is not a Postgres connection string (its password is still redacted).
