// dev-error-explainers/redact — mask credentials in pasted text BEFORE it is
// diagnosed, logged, posted to an issue or sent anywhere.
//
// Deliberately conservative: it masks values that are credentials by shape or
// by position (a URL password, an Authorization header value, a variable whose
// NAME says it is a secret, a well-known token prefix). It never masks by
// entropy alone, so error codes, versions, hashes, file paths and credential-free
// URLs come through untouched. See docs/CONTRACT.md for what it does NOT catch.
//
// Zero dependencies, no network, pure function.

/** The replacement written in place of every masked value. */
export const REDACTED = '[REDACTED]';

// A value that is already a placeholder is not a secret: leave it alone (and do
// not count it), so redact() is idempotent and documentation templates such as
// `postgresql://postgres:[YOUR-PASSWORD]@…` or `API_KEY=<your-key>` survive.
function isPlaceholder(value) {
  const v = value.trim().replace(/^["']|["']$/g, '');
  if (!v) return true;
  if (v.includes(REDACTED)) return true;
  return /^\[[^\]]*\]$/.test(v) // [YOUR-PASSWORD]
    || /^<[^>]*>$/.test(v) // <token>
    || /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(v) // $VAR, ${VAR}
    || /^\{\{[^}]*\}\}$/.test(v) // {{ secrets.X }}
    || /^(?:\*+|x{3,}|\.{3}|…)$/i.test(v); // *** / xxx / …
}

// 1) Header values: Authorization, Proxy-Authorization, Cookie, Set-Cookie and
//    API-key headers — as `Name: value` lines (curl -v, DevTools), `-H "…"`
//    arguments, or JS / JSON object keys (`"Authorization": "Bearer …"`).
//    The name must be the header NAME (followed by a colon), so CORS wordings
//    such as "Request header field authorization is not allowed" are untouched.
const HEADER_RE = /(?<![A-Za-z0-9_-])(proxy-authorization|authorization|set-cookie|cookie|x-api-key|api-key|apikey)(["']?[ \t]*:[ \t]*)(["']?)([^\r\n"']*)/gi;
const AUTH_SCHEME_RE = /^(Bearer|Basic|Token|Digest|Negotiate|NTLM|Bot|ApiKey)(\s+)(.+)$/i;

// 2) URL userinfo: scheme://user:PASSWORD@host. The rest of the URL (up to
//    whitespace or a quote) is scanned for the "@" that separates userinfo from
//    host, the same way the database-url doctor does it: the LAST "@" followed
//    by a host wins — so an unencoded "@" or "#" inside the password is still
//    covered — unless an earlier "@" is followed by a real host and the later
//    one sits in that host's path or query (`?application_name=me@work`).
const URL_START_RE = /(?<![A-Za-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^\s:@/?#'"<>]*):([^\s'"<>]*)/gi;
const HOST_AFTER_AT_RE = /^(?:[A-Za-z0-9.-]+|\[[^\]\s]*\])(?::[^\s/?#@]*)?(?=[/?#),;]|$)/;

function looksLikeHost(hostspec) {
  return hostspec.includes('.') || hostspec.startsWith('[') || /^localhost(:|$)/i.test(hostspec) || /:\d+$/.test(hostspec);
}

/** Index of the userinfo/host "@" in `rest` (the text after "user:"), or -1. */
function userinfoSeparator(rest) {
  const candidates = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== '@') continue;
    const m = rest.slice(i + 1).match(HOST_AFTER_AT_RE);
    if (m && m[0]) candidates.push({ i, host: m[0] });
  }
  if (!candidates.length) return -1;
  const last = candidates[candidates.length - 1];
  for (const c of candidates.slice(0, -1)) {
    if (!looksLikeHost(c.host)) continue;
    const between = rest.slice(c.i + 1 + c.host.length, last.i);
    if (/[/?]/.test(between)) return c.i;
  }
  return last.i;
}

// 3) Assignments whose NAME says "secret": NAME=value (`NAME: value` is NOT
//    covered — too many false positives in prose). Covers .env lines, shell
//    exports, query strings (?access_token=…) and .npmrc (:_authToken=…).
//    The name is split into words (on _ . - and camelCase) and one WORD must be
//    a secret word, so `keyword=`, `passive=`, `monkey=` are left alone.
const ENV_RE = /(?<![A-Za-z0-9_.-])([A-Za-z_][A-Za-z0-9_.-]*)([ \t]*=[ \t]*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s&;,'"]+)/g;
const SECRET_WORDS = new Set([
  'key', 'token', 'secret', 'password', 'passwd', 'pass', 'pwd', 'credential', 'credentials', 'private', 'auth',
  'apikey', 'authtoken', 'accesstoken', 'secretkey', 'privatekey', 'accesskey', 'passphrase',
]);
// A last word that makes the variable describe a secret rather than hold one
// (API_KEY_ID, PASSWORD_FILE, AUTH_URL, TOKEN_TTL…).
const NOT_SECRET_LAST = new Set([
  'url', 'uri', 'host', 'hostname', 'port', 'id', 'path', 'file', 'dir', 'endpoint', 'name', 'length', 'size',
  'type', 'ttl', 'expiry', 'expires', 'region', 'format', 'header', 'mode', 'version', 'count', 'enabled',
]);

function nameWords(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
}

function isSecretName(name) {
  const words = nameWords(name);
  if (!words.length || !words.some((w) => SECRET_WORDS.has(w))) return false;
  return !NOT_SECRET_LAST.has(words[words.length - 1]);
}

// 4) Bearer tokens anywhere in prose.
const BEARER_RE = /\b(Bearer)(\s+)([A-Za-z0-9._~+/-]{8,}=*)/g;

// 5) JWT-shaped strings: three base64url segments, header starting "eyJ".
const JWT_RE = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g;

// 6) Well-known token prefixes (GitHub, GitLab, npm, Stripe, Slack, AWS, Supabase).
const PREFIX_RES = [
  /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9_-])glpat-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9_])[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /(?<![A-Za-z0-9_-])xox[abpre]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Za-z])/g,
  /(?<![A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]{10,}/g,
];

/**
 * Mask credentials in `text`.
 *
 * @param {string} text
 * @returns {{ text: string, redactions: number }} the masked text and the number
 *   of values replaced by `[REDACTED]`. Non-string input → `{ text: '', redactions: 0 }`.
 */
export function redact(text) {
  if (typeof text !== 'string' || !text) return { text: '', redactions: 0 };
  let count = 0;
  let out = text;

  out = out.replace(HEADER_RE, (all, name, sep, quote, value) => {
    const lower = name.toLowerCase();
    if (isPlaceholder(value)) return all;
    if (lower === 'cookie') {
      // Keep cookie names (useful for diagnosis), mask each value.
      let n = 0;
      const masked = value.replace(/([^=;\s]+)=([^;]*)/g, (p, k, v) => {
        if (isPlaceholder(v)) return p;
        n += 1;
        return `${k}=${REDACTED}`;
      });
      if (!n) return all;
      count += n;
      return `${name}${sep}${quote}${masked}`;
    }
    if (lower === 'set-cookie') {
      // Only the first pair is the cookie; the rest are attributes (Path, HttpOnly…).
      const m = value.match(/^([^=;\s]+)=([^;]*)(.*)$/);
      if (!m) return all;
      if (isPlaceholder(m[2])) return all;
      count += 1;
      return `${name}${sep}${quote}${m[1]}=${REDACTED}${m[3]}`;
    }
    const scheme = value.match(AUTH_SCHEME_RE);
    if (scheme && (lower === 'authorization' || lower === 'proxy-authorization')) {
      if (isPlaceholder(scheme[3])) return all;
      count += 1;
      return `${name}${sep}${quote}${scheme[1]}${scheme[2]}${REDACTED}`;
    }
    count += 1;
    return `${name}${sep}${quote}${REDACTED}`;
  });

  out = out.replace(URL_START_RE, (all, scheme, user, rest) => {
    const at = userinfoSeparator(rest);
    if (at < 0) return all;
    const password = rest.slice(0, at);
    if (isPlaceholder(password)) return all;
    // `http://localhost:3000/users/@alice` — a port and a path, not a password.
    if (/^\d{1,5}(?:\/|$)/.test(password)) return all;
    count += 1;
    return `${scheme}${user}:${REDACTED}${rest.slice(at)}`;
  });

  out = out.replace(ENV_RE, (all, name, eq, value) => {
    if (!isSecretName(name)) return all;
    if (isPlaceholder(value)) return all;
    // Flags, not secrets: `xhr.withCredentials = true`, `always-auth=true`.
    // (Numbers are still masked: numeric passwords exist.)
    if (/^["']?(?:true|false|null|undefined)["']?$/i.test(value)) return all;
    const quote = /^["']/.test(value) ? value[0] : '';
    count += 1;
    return `${name}${eq}${quote}${REDACTED}${quote}`;
  });

  out = out.replace(BEARER_RE, (all, word, space, token) => {
    if (isPlaceholder(token)) return all;
    count += 1;
    return `${word}${space}${REDACTED}`;
  });

  out = out.replace(JWT_RE, () => {
    count += 1;
    return REDACTED;
  });

  for (const re of PREFIX_RES) {
    out = out.replace(re, () => {
      count += 1;
      return REDACTED;
    });
  }

  return { text: out, redactions: count };
}
