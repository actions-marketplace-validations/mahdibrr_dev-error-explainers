// npm-eresolve-explainer — pure logic (no React, no DOM, no network).
//
// Input: an npm ERESOLVE log pasted verbatim. Output: the conflict in plain
// English (who asks for which range, which version is in the tree, and WHY
// that version is outside the range, comparator by comparator) plus ranked
// fixes, each one tied to the npm documentation it is based on.
//
// Every rule below was read from a primary source before it was encoded; the
// URL sits next to the rule and travels with each finding (`source`) so the UI
// can link it. Rules that could not be verified were dropped (pnpm / yarn
// behaviour: their current docs did not give a verifiable, version-stable
// statement, so this tool says nothing about them).

// ---------------------------------------------------------------------------
// Primary sources
// ---------------------------------------------------------------------------

export const SOURCES = {
  // Text layout of the report: "While resolving:", "Found:", "Could not resolve
  // dependency:", "Conflicting peer dependency:", and the "Fix the upstream
  // dependency conflict, or retry this command with [--no-strict-peer-deps,]
  // --force or --legacy-peer-deps" line (the strict flag is only listed when
  // strict-peer-deps is on).
  explainEresolve: 'https://github.com/npm/cli/blob/latest/lib/utils/explain-eresolve.js',
  // Line grammar of nodes and edges: `name@version [dev|optional|peer|...]`,
  // `[type ][bundled ]name@"spec" from <node | the root project>`,
  // `overridden name@"spec" (was "raw")`, "N more (a, b, ...)".
  explainDep: 'https://github.com/npm/cli/blob/latest/lib/utils/explain-dep.js',
  // "could not resolve" (thrown while placing a dep) and the
  // "overriding peer dependency" warning (the install carries on).
  placeDep: 'https://github.com/npm/cli/blob/latest/workspaces/arborist/lib/place-dep.js',
  // "unable to resolve dependency tree" (thrown while loading peers of a node).
  buildIdealTree: 'https://github.com/npm/cli/blob/latest/workspaces/arborist/lib/arborist/build-ideal-tree.js',
  // Range semantics: caret, tilde, x-ranges, hyphen ranges, ||, prerelease rule.
  semver: 'https://github.com/npm/node-semver#ranges',
  // "In npm versions 3 through 6, peerDependencies were not automatically
  // installed ... As of npm v7, peerDependencies are installed by default."
  peerDependencies: 'https://docs.npmjs.com/cli/configuring-npm/package-json#peerdependencies',
  overrides: 'https://docs.npmjs.com/cli/configuring-npm/package-json#overrides',
  // npm v8.3.0 changelog: "feat: @npmcli/arborist@4.1.0 — introduces overrides".
  overridesRelease: 'https://github.com/npm/cli/blob/v8.19.4/CHANGELOG.md#v830-2021-12-09',
  legacyPeerDeps: 'https://docs.npmjs.com/cli/using-npm/config#legacy-peer-deps',
  force: 'https://docs.npmjs.com/cli/using-npm/config#force',
  strictPeerDeps: 'https://docs.npmjs.com/cli/using-npm/config#strict-peer-deps',
  npmView: 'https://docs.npmjs.com/cli/commands/npm-view',
  npmExplain: 'https://docs.npmjs.com/cli/commands/npm-explain',
  npmInstall: 'https://docs.npmjs.com/cli/commands/npm-install',
  npmrc: 'https://docs.npmjs.com/cli/configuring-npm/npmrc',
};

const MAX_INPUT = 200000;

// ---------------------------------------------------------------------------
// Secret masking — the log should not contain secrets, but pastes often drag
// in an .npmrc line or a registry URL with credentials.
// ---------------------------------------------------------------------------

export function maskSecrets(value) {
  return String(value ?? '')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, 'npm_****')
    // GitHub fine-grained PATs (github_pat_…) and classic/app tokens (ghp_, gho_, …).
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_****')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, 'gh*_****')
    // GitLab personal / trigger / deploy tokens.
    .replace(/\bgl(?:pat|ptt|dt)-[A-Za-z0-9_-]{20,}/g, 'glpat-****')
    .replace(/(_authToken\s*=\s*)\S+/gi, '$1****')
    .replace(/(_auth\s*=\s*)\S+/gi, '$1****')
    .replace(/(_password\s*=\s*)\S+/gi, '$1****')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1****')
    // Token-like query parameters in tarball / git URLs.
    .replace(/([?&](?:private_token|access_token|job_token|token|auth|password)=)[^&\s"#]+/gi, '$1****')
    // URL userinfo: user:password@ keeps the user name; a colon-less userinfo
    // is a token used as the user name (git+https://<token>@host) when it is
    // long — short ones such as git@ are plain user names and stay readable.
    .replace(/(\/\/[^/\s:@]+):[^@\s/]+@/g, '$1:****@')
    .replace(/(\/\/)[^/\s:@*]{16,}@/g, '$1****@');
}

function maskDeep(value) {
  if (typeof value === 'string') return maskSecrets(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, x]) => [k, maskDeep(x)]));
  }
  return value;
}

// ---------------------------------------------------------------------------
// Semver — a small, dependency-free subset of node-semver.
// Source: https://github.com/npm/node-semver#ranges (README sections
// "Ranges", "Prerelease Tags", "Advanced Range Syntax", "Range Grammar").
// ---------------------------------------------------------------------------

const VERSION_RE = /^[v=]?\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseVersion(input) {
  const m = String(input ?? '').trim().match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
  };
}

export function formatVersion(v) {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`;
}

// SemVer 2.0.0 precedence: numeric identifiers compare numerically and sort
// below alphanumeric ones; a version without prerelease outranks one with; a
// shorter identifier list sorts lower when all preceding ones are equal.
function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; ; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = typeof x === 'number';
    const yn = typeof y === 'number';
    if (xn && !yn) return -1;
    if (!xn && yn) return 1;
    return x < y ? -1 : 1;
  }
}

export function compareVersions(a, b) {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch) || comparePre(a.prerelease, b.prerelease);
}

const XR = '(?:x|X|\\*|0|[1-9]\\d*)';
const PARTIAL_RE = new RegExp(`^[v=]?\\s*(${XR})(?:\\.(${XR})(?:\\.(${XR})(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?(?:\\+[0-9A-Za-z-.]+)?)?)?$`);

function parsePartial(text) {
  const m = String(text).match(PARTIAL_RE);
  if (!m) return null;
  const num = (s) => (s === undefined || /^[xX*]$/.test(s) ? null : Number(s));
  const M = num(m[1]);
  const mi = M === null ? null : num(m[2]);
  const p = mi === null ? null : num(m[3]);
  const pre = p !== null && m[4] ? m[4] : '';
  return { M, m: mi, p, pre };
}

const v = (M, m, p, pre = '') => parseVersion(`${M}.${m}.${p}${pre ? `-${pre}` : ''}`);
const cmp = (op, version) => ({ op, version, text: `${op}${formatVersion(version)}` });
const ANY = { any: true, text: '*' };
const NONE = () => cmp('<', v(0, 0, 0, '0'));

// Desugar one token into primitive comparators, as node-semver does.
function desugar(op, part) {
  const { M, m, p, pre } = part;
  if (op === '^') {
    if (M === null) return [ANY];
    if (m === null) return [cmp('>=', v(M, 0, 0)), cmp('<', v(M + 1, 0, 0, '0'))];
    if (p === null) {
      return M === 0
        ? [cmp('>=', v(0, m, 0)), cmp('<', v(0, m + 1, 0, '0'))]
        : [cmp('>=', v(M, m, 0)), cmp('<', v(M + 1, 0, 0, '0'))];
    }
    const lo = cmp('>=', v(M, m, p, pre));
    if (M !== 0) return [lo, cmp('<', v(M + 1, 0, 0, '0'))];
    if (m !== 0) return [lo, cmp('<', v(0, m + 1, 0, '0'))];
    return [lo, cmp('<', v(0, 0, p + 1, '0'))];
  }
  if (op === '~' || op === '~>') {
    if (M === null) return [ANY];
    if (m === null) return [cmp('>=', v(M, 0, 0)), cmp('<', v(M + 1, 0, 0, '0'))];
    if (p === null) return [cmp('>=', v(M, m, 0)), cmp('<', v(M, m + 1, 0, '0'))];
    return [cmp('>=', v(M, m, p, pre)), cmp('<', v(M, m + 1, 0, '0'))];
  }
  if (op === '' || op === '=') {
    if (M === null) return [ANY];
    if (m === null) return [cmp('>=', v(M, 0, 0)), cmp('<', v(M + 1, 0, 0, '0'))];
    if (p === null) return [cmp('>=', v(M, m, 0)), cmp('<', v(M, m + 1, 0, '0'))];
    return [cmp('=', v(M, m, p, pre))];
  }
  // Primitive comparators with partial versions (README: ">1 is equivalent to
  // >=2.0.0"; node-semver replaceXRange: "<1.2" => "<1.2.0-0", "<=1.2" => "<1.3.0-0").
  if (M === null) return op === '<' || op === '>' ? [NONE()] : [ANY];
  if (m === null || p === null) {
    const mm = m === null ? 0 : m;
    if (op === '>') return [m === null ? cmp('>=', v(M + 1, 0, 0)) : cmp('>=', v(M, mm + 1, 0))];
    if (op === '<=') return [m === null ? cmp('<', v(M + 1, 0, 0, '0')) : cmp('<', v(M, mm + 1, 0, '0'))];
    if (op === '<') return [cmp('<', v(M, mm, 0, '0'))];
    return [cmp('>=', v(M, mm, 0))];
  }
  return [cmp(op, v(M, m, p, pre))];
}

function hyphen(a, b) {
  const lo = parsePartial(a);
  const hi = parsePartial(b);
  if (!lo || !hi) return null;
  const out = [];
  if (lo.M !== null) out.push(cmp('>=', v(lo.M, lo.m ?? 0, lo.p ?? 0, lo.pre)));
  if (hi.M !== null) {
    if (hi.m === null) out.push(cmp('<', v(hi.M + 1, 0, 0, '0')));
    else if (hi.p === null) out.push(cmp('<', v(hi.M, hi.m + 1, 0, '0')));
    else out.push(cmp('<=', v(hi.M, hi.m, hi.p, hi.pre)));
  }
  return out.length ? out : [ANY];
}

const NON_SEMVER_RE = /^(npm:|file:|link:|workspace:|git\+|git:|github:|gitlab:|bitbucket:|https?:|[\w.-]+\/[\w.-]+(#.*)?$)/i;

/**
 * Parse a range into comparator sets. Returns { valid: false, reason } for
 * specs that are not semver ranges (dist-tags like "latest", aliases, URLs).
 */
export function parseRange(input) {
  const raw = String(input ?? '').trim();
  if (NON_SEMVER_RE.test(raw)) return { valid: false, raw, reason: 'not-a-range' };
  const sets = [];
  for (const piece of raw.split(/\s*\|\|\s*/)) {
    const text = piece.trim();
    const hy = text.match(/^(\S+)\s+-\s+(\S+)$/);
    if (hy) {
      const cs = hyphen(hy[1], hy[2]);
      if (!cs) return { valid: false, raw, reason: 'not-a-range' };
      sets.push({ text, comparators: cs });
      continue;
    }
    const tokens = text.replace(/(<=|>=|<|>|=|\^|~>|~)\s+/g, '$1').split(/\s+/).filter(Boolean);
    if (!tokens.length) { sets.push({ text: text || '*', comparators: [ANY] }); continue; }
    const cs = [];
    for (const tok of tokens) {
      const t = tok.match(/^(<=|>=|<|>|=|\^|~>|~)?(.*)$/);
      const part = parsePartial(t[2]);
      if (!part) return { valid: false, raw, reason: 'not-a-range' };
      cs.push(...desugar(t[1] || '', part));
    }
    sets.push({ text, comparators: cs });
  }
  return { valid: true, raw, sets };
}

function testComparator(c, version) {
  if (c.any) return true;
  const d = compareVersions(version, c.version);
  switch (c.op) {
    case '<': return d < 0;
    case '<=': return d <= 0;
    case '>': return d > 0;
    case '>=': return d >= 0;
    default: return d === 0;
  }
}

/**
 * Does `version` satisfy `range`? Returns a structured explanation:
 * { valid, satisfied, version, sets: [{ text, desugared, failed: [text], prereleaseBlocked }] }.
 * Prerelease rule (README "Prerelease Tags"): a prerelease version only
 * matches a comparator set in which some comparator carries a prerelease tag
 * on the same [major, minor, patch] tuple.
 */
export function explainSatisfies(versionText, rangeText) {
  const version = parseVersion(versionText);
  const range = parseRange(rangeText);
  if (!version) return { valid: false, reason: 'bad-version', version: String(versionText ?? '') };
  if (!range.valid) return { valid: false, reason: range.reason, range: range.raw };
  const sets = range.sets.map((set) => {
    const failedCs = set.comparators.filter((c) => !testComparator(c, version));
    const failed = failedCs.map((c) => c.text);
    let prereleaseBlocked = false;
    if (!failed.length && version.prerelease.length) {
      prereleaseBlocked = !set.comparators.some((c) => !c.any && c.version.prerelease.length
        && c.version.major === version.major && c.version.minor === version.minor && c.version.patch === version.patch);
    }
    // Which side of this alternative the version sits on: failing a lower
    // bound (>=, >) means it is too old, failing an upper bound (<, <=) too new.
    const sides = new Set(failedCs.map((c) => {
      if (c.op === '>=' || c.op === '>') return 'below';
      if (c.op === '<' || c.op === '<=') return 'above';
      return compareVersions(version, c.version) < 0 ? 'below' : 'above';
    }));
    const direction = prereleaseBlocked ? 'prerelease' : sides.size === 1 ? [...sides][0] : sides.size ? 'mixed' : null;
    return {
      text: set.text,
      desugared: set.comparators.map((c) => c.text).join(' '),
      failed,
      prereleaseBlocked,
      direction,
      ok: !failed.length && !prereleaseBlocked,
    };
  });
  const satisfied = sets.some((s) => s.ok);
  // Overall direction: only when every alternative agrees. "^16 || ^18" with
  // 17.x installed is too new for one and too old for the other: no direction.
  const dirs = new Set(sets.map((s) => s.direction));
  const direction = satisfied ? null : dirs.size === 1 && (dirs.has('below') || dirs.has('above')) ? [...dirs][0] : null;
  return { valid: true, satisfied, direction, version: formatVersion(version), range: range.raw, sets };
}

/**
 * Can one release version satisfy both ranges? Returns a witness version
 * string, null when no release version can (the ranges are disjoint), or
 * undefined when either spec is not a semver range. Exact for release
 * versions: the lowest point of an intersection of intervals is one of the
 * lower bounds involved (or 0.0.0), so testing those candidates is enough.
 */
export function rangesIntersect(aText, bText) {
  const a = parseRange(aText);
  const b = parseRange(bText);
  if (!a.valid || !b.valid) return undefined;
  const candidates = new Set(['0.0.0']);
  for (const r of [a, b]) {
    for (const set of r.sets) {
      for (const c of set.comparators) {
        if (c.any) continue;
        const rel = { ...c.version, prerelease: [] };
        if (c.op === '>=' || c.op === '=') { candidates.add(formatVersion(c.version)); candidates.add(formatVersion(rel)); }
        if (c.op === '>') { candidates.add(formatVersion({ ...rel, patch: rel.patch + 1 })); candidates.add(formatVersion(rel)); }
      }
    }
  }
  for (const cand of candidates) {
    if (satisfies(cand, aText) && satisfies(cand, bText)) return cand;
  }
  return null;
}

export function satisfies(versionText, rangeText) {
  const r = explainSatisfies(versionText, rangeText);
  return r.valid ? r.satisfied : null;
}

// ---------------------------------------------------------------------------
// Log normalisation
// ---------------------------------------------------------------------------

// Line prefixes. Older npm logged through npmlog, whose error level is
// labelled "ERR!" (https://github.com/npm/cli/blob/v8.19.4/node_modules/npmlog/lib/log.js:
// log.addLevel('error', 5000, ..., 'ERR!')). Current npm prints the heading
// "npm" followed by the level name, i.e. "npm error" / "npm warn"
// (https://github.com/npm/cli/blob/latest/lib/utils/display.js, #writeLog).
// No release note names the version that switched, so none is claimed here.
// npm-debug.log files prefix lines with a counter and the level instead
// ("41 error While resolving: ...", Stack Overflow q/64936044).
const PREFIX_RE = /npm\s+(?:ERR!|error|WARN|warn)(?=[ \t]|\n|$)/g;
const PREFIX_AT_START_RE = /^npm\s+(?:ERR!|error|WARN|warn)(?=[ \t]|$)/;

// CI and hosting build logs put a timestamp or step marker in front of every
// line: GitHub Actions "2024-11-20T10:15:00.1234567Z ", Vercel "[10:15:00.123] ",
// Docker BuildKit "#8 1.234 ", Netlify "3:42:10 PM: ". Such a lead-in has digits and punctuation but no
// words, so it is dropped when an npm prefix follows it on the same line.
const LINE_PREFIX_RE = /npm[ \t]+(?:ERR!|error|WARN|warn)(?=[ \t]|$)/;
const CI_LEAD_RE = /^[\d\s:.,TZ+\-[\]#()/]*\d[\d\s:.,TZ+\-[\]#()/]*$/;
const MAX_LINE = 4000;

function stripCiLead(line) {
  const m = line.length <= MAX_LINE ? line.match(LINE_PREFIX_RE) : null;
  if (!m || m.index === 0 || m.index > 64) return line;
  // Netlify deploy logs use a 12-hour clock: "3:42:10 PM: ".
  const lead = line.slice(0, m.index).replace(/\b[AP]M\b/g, '');
  return CI_LEAD_RE.test(lead) ? line.slice(m.index) : line;
}

function normalise(input) {
  const s = String(input ?? '').slice(0, MAX_INPUT)
    // Colour codes. The bracket-only form is what remains when the escape byte
    // is lost, as in npm's own tap snapshots of coloured output
    // (https://github.com/npm/cli/blob/latest/tap-snapshots/test/lib/utils/explain-eresolve.js.test.cjs).
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\[(?:\d{1,3};)*\d{1,3}m/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map(stripCiLead).join('\n')
    .replace(/^\d+\s+(error|warn)(?=[ \t]|$)/gm, 'npm $1');
  const matches = s.match(PREFIX_RE);
  if (!matches) return s.split('\n');
  const rawLines = s.split('\n');
  const atStart = rawLines.filter((l) => PREFIX_AT_START_RE.test(l)).length;
  if (atStart >= matches.length * 0.8) {
    // A normal log: one prefix per line. Lines without a prefix (the shell
    // command, prose around the paste) are not part of npm's report.
    return rawLines
      .filter((l) => PREFIX_AT_START_RE.test(l))
      .map((l) => l.replace(PREFIX_AT_START_RE, '').replace(/^[ \t]/, '').trimEnd());
  }
  // A log that lost its line breaks when pasted (Stack Overflow q/72731227):
  // split on every prefix instead.
  const parts = s.split(PREFIX_RE);
  const lines = [];
  parts.slice(1).forEach((rec) => {
    const body = rec.replace(/^[ \t]/, '');
    // Inside a record, hard newlines are wrapping artefacts; the text after a
    // blank line is prose that followed the log, which we drop.
    const [head] = body.split(/\n\s*\n/);
    lines.push(head.replace(/\n/g, ' ').trimEnd());
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Line grammar (explain-dep.js)
// ---------------------------------------------------------------------------

const NAME = '(?:@[^@\\s"/]+/)?[^@\\s"]+';
const NODE_RE = new RegExp(`^(${NAME})@(\\S+)((?:\\s+(?:extraneous|dev|optional|peer|bundled|overridden))*)\\s*$`);
const EDGE_RE = new RegExp(
  `^(?:(peerOptional|peer|dev|optional|workspace)\\s+)?(?:(bundled)\\s+)?(?:(overridden)\\s+)?(${NAME})@"([^"]*)"(?:\\s+\\(was "([^"]*)"\\))?\\s+from\\s+(.+)$`,
); // matched against a trimmed line: a lazy tail + \s*$ is quadratic on long whitespace runs

function parseNode(text) {
  // npm 7 debug logs quote node ids: "example"@"1.0.0" (Stack Overflow q/64936044).
  const m = String(text).trim().replace(/"/g, '').match(NODE_RE);
  if (!m) return null;
  return { name: m[1], version: m[2], flags: m[3].trim().split(/\s+/).filter(Boolean) };
}

function parseEdge(text) {
  const m = String(text).trim().match(EDGE_RE);
  if (!m) return null;
  const fromText = m[7];
  const from = /^the root project$/.test(fromText) ? { root: true } : parseNode(fromText.split(/\s+/)[0]);
  if (!from) return null;
  return {
    type: m[1] || 'prod',
    bundled: Boolean(m[2]),
    overridden: Boolean(m[3]),
    name: m[4],
    spec: m[5],
    was: m[6] ?? null,
    from,
  };
}

const HEADER_RE = /^ERESOLVE\s+(unable to resolve dependency tree|could not resolve|overriding peer dependency)/;

function newBlock() {
  return { header: null, root: null, found: null, edge: null, edgeChain: [], conflict: null, fixText: '', section: null };
}

function parseBlocks(lines) {
  const blocks = [];
  let code = null;
  let b = newBlock();
  const started = (x) => x.header || x.root || x.found || x.edge;
  const push = () => { if (started(b)) blocks.push(b); b = newBlock(); };

  for (const rawLine of lines) {
    // A real report line is short; a huge one is noise, and skipping it keeps
    // the regexes below linear in practice.
    if (rawLine.length > MAX_LINE) continue;
    const indent = rawLine.match(/^\s*/)[0].length;
    const line = rawLine.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^code\s+(\S+)/))) { code = code || m[1]; continue; }
    if ((m = line.match(HEADER_RE))) { push(); b.header = m[1]; b.section = null; continue; }
    if ((m = line.match(/^While resolving:\s*(\S+)/))) {
      if (b.root || b.found) push();
      b.root = parseNode(m[1]) || { name: m[1], version: '' };
      continue;
    }
    if ((m = line.match(/^Found:\s*(.+)$/))) {
      if (b.found) push();
      const node = parseNode(m[1]);
      b.found = node ? { ...node, dependents: [] } : null;
      b.section = 'found';
      continue;
    }
    if ((m = line.match(/^Could not resolve dependency:\s*(.*)$/))) {
      b.section = 'edge';
      if (m[1]) { const e = parseEdge(m[1]); if (e) b.edge = { ...e, indent: 0 }; }
      continue;
    }
    if ((m = line.match(/^Conflicting peer dependency:\s*(.+)$/))) {
      const node = parseNode(m[1]);
      b.conflict = node ? { ...node, dependents: [] } : null;
      b.section = 'conflict';
      continue;
    }
    if (/^Fix the upstream dependency conflict/.test(line)) { b.section = 'fix'; b.fixText = line; continue; }
    if (b.section === 'fix') { if (!/^(See |A complete log|For a full report)/.test(line)) b.fixText += ` ${line}`; continue; }
    const edge = parseEdge(line);
    if (!edge) continue; // locations, "N more (...)", report paths: never echoed
    const entry = { ...edge, indent };
    if (b.section === 'found' && b.found) b.found.dependents.push(entry);
    else if (b.section === 'edge') { if (!b.edge) b.edge = entry; else b.edgeChain.push(entry); }
    else if (b.section === 'conflict' && b.conflict) b.conflict.dependents.push(entry);
  }
  push();
  return { code, blocks };
}

// Walk up from the edge at `index` through deeper-indented dependents to find
// the chain of packages that pulled the declarer in, ending at the root.
function ancestry(edges, index) {
  const start = edges[index];
  const chain = [];
  let wanted = start.from;
  let lastIndent = start.indent;
  for (let j = index + 1; j < edges.length && !wanted.root; j++) {
    const e = edges[j];
    if (e.indent <= start.indent) break;
    if (e.indent > lastIndent && e.name === wanted.name) {
      chain.push(e);
      wanted = e.from;
      lastIndent = e.indent;
    }
  }
  return { chain, reachedRoot: Boolean(wanted.root) };
}

const id = (n) => (n ? (n.root ? 'the root project' : `${n.name}@${n.version}`) : '');
const isPeer = (e) => e.type === 'peer' || e.type === 'peerOptional';

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyseBlock(b) {
  const warning = b.header === 'overriding peer dependency';
  // Choose the broken requirement. Preference order (see README of this file):
  // 1. a first-level peer edge of the "Conflicting peer dependency" node —
  //    that is the range npm tried and failed to honour;
  // 2. the "Could not resolve dependency" edge itself.
  let target = null;
  let lists = null;
  if (b.conflict && b.conflict.dependents.length) {
    // The first dependent naming the conflicting package is the first-level
    // one in a normal log (and survives logs whose indentation was mangled).
    const idx = b.conflict.dependents.findIndex((e) => e.name === b.conflict.name);
    if (idx >= 0) { target = b.conflict.dependents[idx]; lists = { edges: b.conflict.dependents, idx }; }
  }
  const fromConflict = Boolean(target);
  if (!target && b.edge) {
    target = b.edge;
    lists = { edges: [b.edge, ...b.edgeChain], idx: 0 };
  }
  if (!target) return null;
  // explain-eresolve.js prints peerConflict.peer: the node npm TRIED to place,
  // not an installed one. When it names another package than the unresolved
  // edge, the edge's declarer is where a compatible release has to be found:
  // "peer react-dom@^17 from react-beautiful-dnd" → npm picked react-dom@17,
  // which needs react@17. The package to look at is react-beautiful-dnd.
  const viaEdge = fromConflict && b.edge && !b.edge.from.root && b.conflict.name !== b.edge.name
    ? { name: b.edge.from.name, version: b.edge.from.version, peerName: b.edge.name, peerSpec: b.edge.spec }
    : null;

  const { chain, reachedRoot } = ancestry(lists.edges, lists.idx);
  const declarer = target.from;
  const direct = chain.length ? chain[chain.length - 1] : null;
  const installed = b.found && b.found.name === target.name ? b.found.version : null;
  const verdict = installed ? explainSatisfies(installed, target.spec) : null;
  const foundBy = b.found
    ? b.found.dependents.filter((e) => e.indent === Math.min(...b.found.dependents.map((d) => d.indent)))
    : [];
  const rootWantsTarget = [...foundBy, ...(b.conflict ? b.conflict.dependents : []), ...(b.edge ? [b.edge] : []), ...b.edgeChain]
    .find((e) => e.name === target.name && e.from.root && !isPeer(e));
  const strictPeerDeps = /--no-strict-peer-deps/.test(b.fixText);

  return {
    kind: warning ? 'warning' : 'error',
    header: b.header,
    root: b.root,
    found: b.found ? { name: b.found.name, version: b.found.version } : null,
    foundRequiredBy: foundBy.map((e) => ({ from: id(e.from), spec: e.spec, type: e.type, fromRoot: Boolean(e.from.root) })),
    fromConflict,
    viaEdge,
    conflictingPeer: b.conflict ? { name: b.conflict.name, version: b.conflict.version } : null,
    unresolvedEdge: b.edge ? { name: b.edge.name, spec: b.edge.spec, type: b.edge.type, from: id(b.edge.from) } : null,
    target: { name: target.name, range: target.spec, type: target.type, declaredBy: declarer.root ? { root: true } : { name: declarer.name, version: declarer.version } },
    installed,
    verdict,
    chain: chain.map((e) => ({ name: e.name, spec: e.spec, type: e.type, from: id(e.from) })),
    reachedRoot,
    directDependency: direct && direct.from.root ? { name: direct.name, spec: direct.spec, type: direct.type } : null,
    targetIsDirect: Boolean(rootWantsTarget),
    targetRootSpec: rootWantsTarget ? rootWantsTarget.spec : null,
    targetRootType: rootWantsTarget ? rootWantsTarget.type : null,
    strictPeerDeps,
  };
}

function describeVerdict(c) {
  const { verdict, installed, target } = c;
  if (!installed) {
    const r = parseRange(target.range);
    const accepts = r.valid ? `"${target.range}" means ${r.sets.map((s) => s.comparators.map((x) => x.text).join(' ')).join(' || ')}. ` : '';
    return `${accepts}The log does not show which ${target.name} version is already in your tree, so the range cannot be checked here — run \`npm explain ${target.name}\` to see it.`;
  }
  if (!verdict.valid) {
    return verdict.reason === 'bad-version'
      ? `"${installed}" is not a semver version, so it cannot be checked against the range.`
      : `"${target.range}" is not a semver range (a dist-tag, alias, URL or path), so it cannot be checked numerically.`;
  }
  if (verdict.satisfied) {
    return `By semver rules ${installed} does satisfy "${target.range}" — the conflict comes from another requirement in the log, so read the "Found" dependents below.`;
  }
  const parts = verdict.sets.map((s) => {
    if (s.prereleaseBlocked) {
      return `"${s.text}" (${s.desugared}): ${installed} is a prerelease, and a range only admits prereleases of a major.minor.patch it names itself`;
    }
    return `"${s.text}" means ${s.desugared}; ${installed} fails ${s.failed.join(' and ')}`;
  });
  return `${installed} is outside every alternative of the range. ${parts.join('. ')}.`;
}

// For every other package in the log that already depends on N (the "Found"
// dependents), can one version satisfy both its range and R? A peer that
// excludes every version of R makes `npm install N@"R"` fail again; a plain
// dependency that excludes it just gets its own nested copy.
function alignImpact(c) {
  const out = { breaks: [], nested: [], unknown: [], fine: [] };
  for (const d of c.foundRequiredBy) {
    if (d.fromRoot) continue;
    const w = rangesIntersect(c.target.range, d.spec);
    if (w === undefined) out.unknown.push(d);
    else if (w === null) (d.type === 'peer' || d.type === 'peerOptional' ? out.breaks : out.nested).push(d);
    else out.fine.push(d);
  }
  return out;
}

const listDeps = (N, ds) => ds.map((d) => `${d.from} (${d.type === 'prod' ? '' : `${d.type} `}${N}@"${d.spec}")`).join(', ');

function buildFixes(c) {
  const N = c.target.name;
  const R = c.target.range;
  const P = c.target.declaredBy;
  const at = c.installed ? `@${c.installed}` : '';
  // 'below': the installed version is too old for the range, 'above': too new,
  // null: unknown or mixed. It decides which way every fix points.
  const dir = c.verdict && c.verdict.valid ? c.verdict.direction : null;

  // S: the package whose releases have to be searched. Normally the declarer
  // of the peer range; when npm's "Conflicting peer dependency" is a candidate
  // it tried to place for another package's peer, that other package.
  const S = c.viaEdge ? { name: c.viaEdge.name, version: c.viaEdge.version } : (P.root ? null : P);
  let dependentFix = null;
  if (S) {
    const up = c.directDependency && c.directDependency.name !== S.name ? c.directDependency : null;
    const olderRange = dir === 'below' && parseVersion(S.version) ? `${S.name}@"<${S.version}"` : null;
    const commands = [olderRange ? `npm view ${olderRange} peerDependencies` : `npm view ${S.name} peerDependencies`, `npm view ${S.name} versions`];
    if (up) commands.push(`npm explain ${S.name}`, `npm view ${up.name} versions`);
    if (!c.reachedRoot && !up) commands.push(`npm explain ${S.name}`);
    const subject = up ? `${up.name} (it pulls in ${S.name})` : S.name;
    const accepts = c.viaEdge
      ? `whose ${c.viaEdge.peerName} peer range works with ${N}${at}`
      : `whose peer range accepts ${N}${at}`;
    const tried = c.viaEdge
      ? `${S.name} asks for ${c.viaEdge.peerName}@"${c.viaEdge.peerSpec}"; npm picked ${P.name}@${P.version} for it, and that version needs ${N}@"${R}". `
      : '';
    if (dir === 'below') {
      dependentFix = {
        id: 'older-dependent',
        title: `Use an older ${subject} ${accepts}`,
        body: `${tried}${N}${at} is older than "${R}" allows. Newer releases of ${S.name} usually need an even newer ${N}, so look backwards: `
          + (olderRange
            ? `\`npm view ${olderRange} peerDependencies\` prints the peer ranges of every earlier release. `
            : `\`npm view ${S.name}@<version> peerDependencies\` prints the peer ranges of an earlier release. `)
          + 'There may be none that fits — the output decides, not a guess.',
        commands,
        tradeoff: `You stay on an older ${S.name} and miss its later fixes. If nothing else holds ${N} back, moving ${N} up is usually the better fix.`,
        source: SOURCES.npmView,
      };
    } else {
      dependentFix = {
        id: 'upgrade',
        title: dir === 'above' ? `Upgrade ${subject} to a release ${accepts}` : `Move ${subject} to a release ${accepts}`,
        body: `${tried}\`npm view ${S.name} peerDependencies\` prints the peer ranges of the version tagged "latest"; append @<version>${parseVersion(S.version) ? ` (or a range such as @"<${S.version}")` : ''} to inspect others. `
          + 'There may be no compatible release yet — the output decides, not a guess.',
        commands,
        tradeoff: dir === 'above'
          ? 'Usually the cleanest outcome, but a newer major may bring its own breaking changes: read its changelog before bumping.'
          : `A different release of ${S.name} may bring its own breaking changes: read its changelog before switching.`,
        source: SOURCES.npmView,
      };
    }
  }

  let alignFix = null;
  let alignBreaks = false;
  if (c.targetIsDirect && c.verdict && c.verdict.valid && !c.verdict.satisfied && c.kind === 'error') {
    const impact = alignImpact(c);
    alignBreaks = impact.breaks.length > 0;
    const flag = c.targetRootType === 'dev' ? ' --save-dev' : c.targetRootType === 'optional' ? ' --save-optional' : '';
    const base = dir === 'below'
      ? `${N} moves up from ${c.installed}: read its changelog for breaking changes.`
      : dir === 'above'
        ? `You give up ${N}@${c.installed} and whatever you upgraded it for.`
        : `You give up ${N}@${c.installed}.`;
    const notes = [base];
    if (impact.breaks.length) {
      notes.push(`It will fail again as it stands — will break: ${listDeps(N, impact.breaks)}. No ${N} version satisfies both ranges, so ${impact.breaks.length > 1 ? 'those packages' : 'that package'} must move too.`);
    }
    if (impact.nested.length) notes.push(`${listDeps(N, impact.nested)} excludes "${R}", so npm would install a second, nested copy of ${N} for it.`);
    if (impact.fine.length) notes.push(`Also fine with "${R}": ${listDeps(N, impact.fine)}.`);
    if (impact.unknown.length) notes.push(`Not checked (not a semver range): ${listDeps(N, impact.unknown)}.`);
    alignFix = {
      id: 'align',
      title: alignBreaks
        ? `Only together with other upgrades: install ${N} inside "${R}"`
        : dir === 'below' ? `Upgrade ${N} to a version inside "${R}"`
          : dir === 'above' ? `Move ${N} back to a version inside "${R}"`
            : `Install a ${N} version inside "${R}"`,
      body: `Your package.json asks for ${N}@"${c.targetRootSpec}". Installing within the range ${P.root ? 'you declared' : `${P.name} declares`} satisfies it.`,
      commands: [`npm install${flag} ${N}@"${R}"`],
      tradeoff: notes.join(' '),
      source: SOURCES.npmInstall,
    };
  }

  let overridesFix = null;
  if (!P.root && (c.targetIsDirect || c.installed)) {
    const value = c.targetIsDirect ? `$${N}` : c.installed;
    const snippet = JSON.stringify({ overrides: { [P.name]: { [N]: value } } }, null, 2);
    const common = 'Overrides are only read from the root package.json and need npm 8.3.0 or newer.';
    overridesFix = {
      id: 'overrides',
      title: `Pin ${N} under ${P.name} with "overrides"`,
      body: c.targetIsDirect
        ? `This tells npm which ${N} to resolve wherever ${P.name} depends on it. "$${N}" is npm's reference form for a package you depend on directly: it reuses the spec from your own dependencies, so the override follows your package.json when you bump ${N}.`
        : `This tells npm to resolve ${N}@${c.installed} wherever ${P.name} depends on it.`,
      snippet,
      tradeoff: dir === 'below'
        ? `Warning: ${c.installed} is BELOW the lowest ${N} version ${P.name}@${P.version} declares ("${R}"). It most likely calls ${N} APIs that ${c.installed} does not have, so expect runtime errors — prefer the fixes above. ${common}`
        : `${P.name} will run with a ${N} version outside the range its authors declared — test the features that touch it. ${common}`,
      source: SOURCES.overrides,
      extraSource: SOURCES.overridesRelease,
    };
  }

  // Order: the fix that moves in the right direction without breaking anything
  // else comes first. Installed too old and nothing blocks the upgrade → move
  // the peer up; otherwise search the dependent's releases first.
  const main = dir === 'below' && alignFix && !alignBreaks
    ? [alignFix, dependentFix]
    : [dependentFix, alignFix];
  const fixes = main.filter(Boolean).map((f, i) => ({ ...f, rank: i === 0 ? 'best' : 'alternative' }));
  if (overridesFix) fixes.push({ ...overridesFix, rank: 'workaround' });

  if (c.kind === 'error') {
    if (c.strictPeerDeps) {
      fixes.push({
        id: 'no-strict-peer-deps',
        rank: 'config',
        title: 'Turn strict-peer-deps back off',
        body: 'The log lists --no-strict-peer-deps, which npm only does when strict-peer-deps is on (command line, env or an .npmrc). With it off — the default — npm resolves peer conflicts deep in the graph using the nearest non-peer spec and prints a warning instead of failing.',
        commands: ['npm install --no-strict-peer-deps'],
        tradeoff: 'Conflicts involving your root project still fail; only the deep ones become warnings.',
        source: SOURCES.strictPeerDeps,
      });
    }
    fixes.push({
      id: 'legacy-peer-deps',
      rank: 'last-resort',
      title: 'Last resort: --legacy-peer-deps',
      body: 'npm then ignores peerDependencies completely when building the tree, as npm versions 3 to 6 did. To make every install (CI included) behave the same, put it in the project .npmrc.',
      commands: ['npm install --legacy-peer-deps', '# project .npmrc\nlegacy-peer-deps=true'],
      tradeoff: `It is not limited to ${N}: every peer dependency in the tree stops being enforced, and missing peers are no longer installed for you. npm's docs say it is not recommended.`,
      source: SOURCES.legacyPeerDeps,
      extraSource: SOURCES.npmrc,
    });
    fixes.push({
      id: 'force',
      rank: 'avoid',
      title: 'Avoid: --force',
      body: 'It does allow conflicting peerDependencies in the root project, but it also switches off unrelated safety checks (for example engines checks for your Node and npm versions).',
      commands: ['npm install --force'],
      tradeoff: 'npm\'s docs: "If you don\'t have a clear idea of what you want to do, it is strongly recommended that you do not use this option!"',
      source: SOURCES.force,
    });
  }
  return fixes;
}

function buildFindings(c) {
  const f = [];
  const N = c.target.name;
  const who = c.target.declaredBy.root ? 'your root project' : `${c.target.declaredBy.name}@${c.target.declaredBy.version}`;
  const kindWord = c.target.type === 'peerOptional' ? 'an optional peer dependency' : isPeer(c.target) ? 'a peer dependency' : 'a dependency';

  f.push({
    id: 'conflict',
    severity: c.kind === 'error' ? 'critical' : 'info',
    title: c.kind === 'error'
      ? `${who} wants ${N}@"${c.target.range}"${c.installed ? ` — your tree has ${c.installed}` : ''}`
      : `Warning only: npm installed ${N}${c.installed ? `@${c.installed}` : ''} outside ${who}'s range "${c.target.range}"`,
    body: `${who} declares ${kindWord} on ${N}@"${c.target.range}". `
      + (c.kind === 'error'
        ? 'Since npm v7 peer dependencies are installed by default. When one cannot be placed inside its range, npm either stops, as here, or — for a conflict deep in the graph, and only while strict-peer-deps is off — overrides it and prints a warning.'
        : 'npm printed "overriding peer dependency": it resolved the conflict with the nearest non-peer spec and carried on. The install finished; the package may still misbehave at runtime.'),
    source: c.kind === 'error' ? SOURCES.peerDependencies : SOURCES.strictPeerDeps,
  });

  f.push({
    id: 'range',
    severity: 'info',
    title: c.installed ? `Why ${N}@${c.installed} does not fit "${c.target.range}"` : `What "${c.target.range}" accepts`,
    body: describeVerdict(c),
    source: SOURCES.semver,
  });

  if (c.chain.length || c.foundRequiredBy.length || c.viaEdge) {
    const lines = [];
    if (c.chain.length) {
      const path = [...c.chain].reverse().map((e) => `${e.name}@"${e.spec}"${e.type === 'prod' ? '' : ` (${e.type})`}`);
      const head = c.reachedRoot ? 'the root project' : `${c.chain[c.chain.length - 1].from} (npm cut the chain short here)`;
      // When the conflicting peer is a candidate for another package's peer
      // (viaEdge), the declarer is a version npm tried to place, not one in
      // your tree; otherwise stay neutral — it may or may not be installed yet.
      lines.push(c.viaEdge
        ? `npm tried to install ${who} via: ${[head, ...path].join(' → ')}.`
        : `${who} is required via: ${[head, ...path].join(' → ')}.`);
    }
    if (c.viaEdge) {
      lines.push(`${who} is not in your tree yet: it is the version npm picked for ${c.viaEdge.name}@${c.viaEdge.version}'s peer ${c.viaEdge.peerName}@"${c.viaEdge.peerSpec}", and it needs ${N}@"${c.target.range}". So the package to check is ${c.viaEdge.name}.`);
    }
    if (c.foundRequiredBy.length && c.found) {
      lines.push(`${c.found.name}@${c.found.version} is there because: ${c.foundRequiredBy.map((d) => `${d.from} asks for ${d.type === 'prod' ? '' : `${d.type} `}"${d.spec}"`).join('; ')}.`);
    }
    f.push({ id: 'chain', severity: 'info', title: 'Who pulled what in', body: lines.join(' '), source: SOURCES.explainDep });
  }

  if (c.root && /^undefined@undefined$/.test(`${c.root.name}@${c.root.version}`)) {
    f.push({
      id: 'no-root-name',
      severity: 'info',
      title: 'npm printed "While resolving: undefined@undefined"',
      body: 'npm could not name the package it was resolving for (no name/version to print), so the root project in this log is anonymous. The conflict analysis above still applies.',
      source: SOURCES.explainEresolve,
    });
  }
  return f;
}

/**
 * Main entry point.
 * @param {string} input raw npm output
 * @returns {{ detected: boolean, code: string|null, reason?: string, conflicts: object[] }}
 */
export function analyseEresolveLog(input) {
  const text = String(input ?? '');
  if (!text.trim()) return { detected: false, code: null, reason: 'empty', conflicts: [] };
  const { code, blocks } = parseBlocks(normalise(text));
  const conflicts = blocks
    .map(analyseBlock)
    .filter(Boolean)
    .map((c) => {
      return maskDeep({ ...c, findings: buildFindings(c), fixes: buildFixes(c) });
    });
  const detected = conflicts.length > 0 || /\bERESOLVE\b/.test(text);
  let reason;
  if (!conflicts.length) reason = code && code !== 'ERESOLVE' ? 'other-code' : detected ? 'unparsed' : 'no-eresolve';
  return { detected, code: code ? maskSecrets(code) : null, reason, conflicts };
}

// A real React 19 log: facebook/react issue #31701 (create-react-app template
// installing @testing-library/react@13 next to react@19), report paths removed.
export const EXAMPLE_LOG = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: module_loginweb_reactjs@0.1.0
npm error Found: react@19.0.0
npm error node_modules/react
npm error   react@"^19.0.0" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react@"^18.0.0" from @testing-library/react@13.4.0
npm error node_modules/@testing-library/react
npm error   @testing-library/react@"^13.0.0" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.`;
