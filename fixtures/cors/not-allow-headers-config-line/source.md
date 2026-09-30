# cors / not-allow-headers-config-line

**Negative case** — must not be diagnosed as `cors`.

**Provenance:** synthetic.

Synthetic: a CORS configuration snippet (header names, no browser error) must not be read as a CORS failure. Also checks that the header NAME "Authorization" in a list is not redacted.
