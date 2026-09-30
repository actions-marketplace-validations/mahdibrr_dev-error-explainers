# database-url / not-prisma-p1001-no-url

**Negative case** — must not be diagnosed as `database-url`.

**Provenance:** synthetic.

Synthetic (Prisma P1001 wording): a connection ERROR without a connection string is not for the URL doctor.

Since 0.2.0 the `database-connection` family recognises the P1001 message itself, so the paste is matched — but never by `database-url`.
