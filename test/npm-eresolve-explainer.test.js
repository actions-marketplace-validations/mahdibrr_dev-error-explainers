/**
 * npm ERESOLVE explainer — fixtures are real logs, except two assembled ones
 * (REACT17_DOM18, RBD_CANDIDATE) whose peer ranges were checked with npm view:
 *  - Stack Overflow q/64573177 (Angular, "unable to resolve dependency tree")
 *  - Stack Overflow q/71517176 (redux-form, "could not resolve" + Conflicting peer)
 *  - Stack Overflow q/78412358 (drizzle-orm, peerOptional chain, bare "npm ERR!" lines)
 *  - Stack Overflow q/72731227 (react-native, undefined@undefined, collapsed paste)
 *  - Stack Overflow q/74286616 (Storybook, "npm WARN ERESOLVE overriding peer dependency")
 *  - npm/cli tap snapshot test/lib/utils/explain-eresolve.js (cycleNested, eslint-plugin case)
 * Semver cases follow https://github.com/npm/node-semver#ranges.
 */
import { describe, it, expect } from '@jest/globals';
import {
  analyseEresolveLog,
  explainSatisfies,
  satisfies,
  parseRange,
  compareVersions,
  parseVersion,
  maskSecrets,
  rangesIntersect,
  EXAMPLE_LOG,
  SOURCES,
} from '../src/npm-eresolve-explainer.js';

// Fake credentials for the masking tests, assembled at runtime so that no
// token-shaped literal exists in the source (secret scanners flag them).
const FAKE_GLPAT_A = ['glpat', 'Ab12Cd34Ef56Gh78Ij90'].join('-');
const FAKE_GLPAT_B = ['glpat', 'Zz12Cd34Ef56Gh78Ij90'].join('-');
const FAKE_NPM_LONG = ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_');
const FAKE_NPM = ['npm', 'abcdefghijklmnopqrstuvwxyz0123'].join('_');

const ANGULAR = `npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR!
npm ERR! While resolving: gf-kautomata-pipeline-ui@0.0.0
npm ERR! Found: @angular/core@9.1.12
npm ERR! node_modules/@angular/core
npm ERR!   @angular/core@"^9.1.4" from the root project
npm ERR!
npm ERR! Could not resolve dependency:
npm ERR! peer @angular/core@"7.2.16" from @angular/http@7.2.16
npm ERR! node_modules/@angular/http
npm ERR!   @angular/http@"^7.2.11" from the root project
npm ERR!
npm ERR! Fix the upstream dependency conflict, or retry
npm ERR! this command with --force, or --legacy-peer-deps
npm ERR! to accept an incorrect (and potentially broken) dependency resolution.`;

const REDUX_FORM = `> npm install
npm ERR! code ERESOLVE
npm ERR! ERESOLVE could not resolve
npm ERR!
npm ERR! While resolving: ecommerce-app@0.1.0
npm ERR! Found: react@17.0.2
npm ERR! node_modules/react
npm ERR!   react@"latest" from the root project
npm ERR!   peer react@"^16.8.0 || ^17.0.0" from @material-ui/core@4.11.4
npm ERR!   node_modules/@material-ui/core
npm ERR!     @material-ui/core@"latest" from the root project
npm ERR!     peer @material-ui/core@"^4.0.0" from @material-ui/icons@4.11.2
npm ERR!     node_modules/@material-ui/icons
npm ERR!       @material-ui/icons@"latest" from the root project
npm ERR!     1 more (@material-ui/lab)
npm ERR!   10 more (react-dom, @material-ui/icons, @material-ui/lab, ...)
npm ERR!
npm ERR! Could not resolve dependency:
npm ERR! redux-form@"^8.3.6" from the root project
npm ERR!
npm ERR! Conflicting peer dependency: react@16.14.0
npm ERR! node_modules/react
npm ERR!   peer react@"^16.4.2" from redux-form@8.3.7
npm ERR!   node_modules/redux-form
npm ERR!     redux-form@"^8.3.6" from the root project
npm ERR!
npm ERR! Fix the upstream dependency conflict, or retry
npm ERR! this command with --force, or --legacy-peer-deps
npm ERR! to accept an incorrect (and potentially broken) dependency resolution.
npm ERR!
npm ERR! See /Users/gergo/.npm/eresolve-report.txt for a full report.`;

const DRIZZLE = `npm ERR! code ERESOLVE
npm ERR! ERESOLVE could not resolve
npm ERR!
npm ERR! While resolving: full-stack-todo@0.1.0
npm ERR! Found: react@18.3.1
npm ERR! node_modules/react
npm ERR!   peer react@"^18.2.0" from next@14.2.3
npm ERR!   node_modules/next
npm ERR!     next@"14.2.3" from the root project
npm ERR!   peer react@"^18.3.1" from react-dom@18.3.1
npm ERR!   node_modules/react-dom
npm ERR!     peer react-dom@"^18.2.0" from next@14.2.3
npm ERR!     node_modules/next
npm ERR!       next@"14.2.3" from the root project
npm ERR!     react-dom@"^18" from the root project
npm ERR!   2 more (styled-jsx, the root project)
npm ERR!
npm ERR! Could not resolve dependency:
npm ERR! drizzle-orm@"" from the root project
npm ERR!
npm ERR! Conflicting peer dependency: react@18.2.0
npm ERR! node_modules/react
npm ERR!   peer react@"18.2.0" from react-native@0.74.0
npm ERR!   node_modules/react-native
npm ERR!     peer react-native@"" from @op-engineering/op-sqlite@5.0.5
npm ERR!     node_modules/@op-engineering/op-sqlite
npm ERR!       peerOptional @op-engineering/op-sqlite@">=2" from drizzle-orm@0.30.9
npm ERR!       node_modules/drizzle-orm
npm ERR!         drizzle-orm@"*" from the root project
npm ERR!
npm ERR! Fix the upstream dependency conflict, or retry
npm ERR! this command with --force or --legacy-peer-deps
npm ERR! to accept an incorrect (and potentially broken) dependency resolution.`;

// Stack Overflow q/72731227 — pasted with its line breaks lost and re-wrapped.
const COLLAPSED = `npm ERR! code ERESOLVE npm ERR! ERESOLVE could not resolve npm ERR!
npm ERR! While resolving: undefined@undefined npm ERR! Found:
react-native@0.68.2 npm ERR! node_modules/react-native npm ERR!   peer
react-native@"*" from @react-native-community/cli@7.0.3 npm ERR!
node_modules/@react-native-community/cli npm ERR!
@react-native-community/cli@"^7.0.3" from react-native@0.68.2 npm ERR!
react-native@"0.69.0" from the root project npm ERR! npm ERR! Could
not resolve dependency: npm ERR! react-native@"0.69.0" from the root
project npm ERR! npm ERR! Conflicting peer dependency: react@18.0.0
npm ERR! node_modules/react npm ERR!   peer react@"18.0.0" from
react-native@0.69.0 npm ERR!   node_modules/react-native npm ERR!
react-native@"0.69.0" from the root project npm ERR! npm ERR! Fix the
upstream dependency conflict, or retry npm ERR! this command with
--force, or --legacy-peer-deps npm ERR! to accept an incorrect (and potentially broken) dependency resolution. npm ERR! npm ERR! See
C:\\Users\\SOMEONE\\AppData\\Local\\npm-cache\\eresolve-report.txt for
a full report.`;

const STORYBOOK_WARN = `npm WARN ERESOLVE overriding peer dependency
npm WARN While resolving: react-inspector@5.1.1
npm WARN Found: react@18.2.0
npm WARN node_modules/react
npm WARN   react@"^18.2.0" from the root project
npm WARN   53 more (@design-systems/utils, ...)
npm WARN
npm WARN Could not resolve dependency:
npm WARN peer react@"^16.8.4 || ^17.0.0" from react-inspector@5.1.1
npm WARN node_modules/@storybook/addon-actions/node_modules/react-inspector
npm WARN   react-inspector@"^5.1.0" from @storybook/addon-actions@6.5.13
npm WARN   node_modules/@storybook/addon-actions
npm WARN
npm WARN Conflicting peer dependency: react@17.0.2
npm WARN node_modules/react
npm WARN   peer react@"^16.8.4 || ^17.0.0" from react-inspector@5.1.1
npm WARN   node_modules/@storybook/addon-actions/node_modules/react-inspector
npm WARN     react-inspector@"^5.1.0" from @storybook/addon-actions@6.5.13
npm WARN     node_modules/@storybook/addon-actions
npm WARN ERESOLVE overriding peer dependency
npm WARN While resolving: @mdx-js/react@1.6.22
npm WARN Found: react@18.2.0
npm WARN node_modules/react
npm WARN   react@"^18.2.0" from the root project
npm WARN
npm WARN Could not resolve dependency:
npm WARN peer react@"^16.13.1 || ^17.0.0" from @mdx-js/react@1.6.22
npm WARN node_modules/@storybook/addon-docs/node_modules/@mdx-js/react
npm WARN   @mdx-js/react@"^1.6.22" from @storybook/addon-docs@6.5.13`;

// npm/cli tap snapshot "cycleNested > report from color" (strict-peer-deps on).
const CYCLE_NESTED = `# npm resolution error report

Found: @isaacs/peer-dep-cycle-c@2.0.0
node_modules/@isaacs/peer-dep-cycle-c
  @isaacs/peer-dep-cycle-c@"2.x" from the root project

Could not resolve dependency:
peer @isaacs/peer-dep-cycle-b@"1" from @isaacs/peer-dep-cycle-a@1.0.0
node_modules/@isaacs/peer-dep-cycle-a
  @isaacs/peer-dep-cycle-a@"1.x" from the root project

Conflicting peer dependency: @isaacs/peer-dep-cycle-c@1.0.0
node_modules/@isaacs/peer-dep-cycle-c
  peer @isaacs/peer-dep-cycle-c@"1" from @isaacs/peer-dep-cycle-b@1.0.0
  node_modules/@isaacs/peer-dep-cycle-b
    peer @isaacs/peer-dep-cycle-b@"1" from @isaacs/peer-dep-cycle-a@1.0.0
    node_modules/@isaacs/peer-dep-cycle-a
      @isaacs/peer-dep-cycle-a@"1.x" from the root project

Fix the upstream dependency conflict, or retry this command with --no-strict-peer-deps, --force, or --legacy-peer-deps to accept an incorrect (and potentially broken) dependency resolution.`;

const ETARGET = `npm ERR! code ETARGET
npm ERR! notarget No matching version found for @angular/http@^9.1.4.
npm ERR! notarget In most cases you or one of your dependencies are requesting
npm ERR! notarget a package version that does not exist.`;

const fixIds = (c) => c.fixes.map((f) => f.id);

describe('semver subset (node-semver README)', () => {
  it('desugars caret, tilde, x-range, hyphen and partial primitives', () => {
    const d = (r) => parseRange(r).sets.map((s) => s.comparators.map((c) => c.text).join(' '));
    expect(d('^1.2.3')).toEqual(['>=1.2.3 <2.0.0-0']);
    expect(d('^0.2.3')).toEqual(['>=0.2.3 <0.3.0-0']);
    expect(d('^0.0.3')).toEqual(['>=0.0.3 <0.0.4-0']);
    expect(d('^0.0')).toEqual(['>=0.0.0 <0.1.0-0']);
    expect(d('~1.2')).toEqual(['>=1.2.0 <1.3.0-0']);
    expect(d('1.x')).toEqual(['>=1.0.0 <2.0.0-0']);
    expect(d('1.2.3 - 2.3')).toEqual(['>=1.2.3 <2.4.0-0']);
    expect(d('1.2 - 2.3.4')).toEqual(['>=1.2.0 <=2.3.4']);
    expect(d('>1')).toEqual(['>=2.0.0']);
    expect(d('<=1.2')).toEqual(['<1.3.0-0']);
    expect(d('<1.2')).toEqual(['<1.2.0-0']);
    expect(d('>= 16.8.0')).toEqual(['>=16.8.0']);
  });

  it('matches the README examples for || and comparator sets', () => {
    expect(satisfies('1.2.7', '1.2.7 || >=1.2.9 <2.0.0')).toBe(true);
    expect(satisfies('1.4.6', '1.2.7 || >=1.2.9 <2.0.0')).toBe(true);
    expect(satisfies('1.2.8', '1.2.7 || >=1.2.9 <2.0.0')).toBe(false);
    expect(satisfies('2.0.0', '1.2.7 || >=1.2.9 <2.0.0')).toBe(false);
    expect(satisfies('v18.2.0', '=18.2.0')).toBe(true);
    expect(satisfies('5.0.0', '')).toBe(true);
  });

  it('applies the prerelease rule separately from "above the range"', () => {
    expect(satisfies('1.2.3-alpha.7', '>1.2.3-alpha.3')).toBe(true);
    expect(satisfies('3.4.5-alpha.9', '>1.2.3-alpha.3')).toBe(false);
    const canary = explainSatisfies('18.3.0-canary.1', '^18.0.0');
    expect(canary.satisfied).toBe(false);
    expect(canary.sets[0].prereleaseBlocked).toBe(true);
    expect(canary.sets[0].failed).toEqual([]);
    const rc = explainSatisfies('19.0.0-rc.1', '^18.0.0');
    expect(rc.sets[0].failed).toEqual(['<19.0.0-0']);
    expect(rc.sets[0].prereleaseBlocked).toBe(false);
  });

  it('orders prerelease identifiers per SemVer 2.0.0', () => {
    const c = (a, b) => Math.sign(compareVersions(parseVersion(a), parseVersion(b)));
    expect(c('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(c('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    expect(c('1.0.0-beta.2', '1.0.0-beta.11')).toBe(-1);
    expect(c('1.0.0-rc.1', '1.0.0')).toBe(-1);
  });

  it('refuses to judge specs that are not semver ranges', () => {
    for (const spec of ['latest', 'npm:@scope/fork@1.0.0', 'file:../lib', 'github:user/repo#main', 'workspace:*']) {
      expect(satisfies('1.0.0', spec)).toBeNull();
    }
  });
});

describe('analyseEresolveLog — real logs', () => {
  it('explains the built-in React 19 example (facebook/react#31701, "npm error" prefix)', () => {
    const r = analyseEresolveLog(EXAMPLE_LOG);
    expect(r.detected).toBe(true);
    expect(r.code).toBe('ERESOLVE');
    const [c] = r.conflicts;
    expect(c.kind).toBe('error');
    expect(c.root).toMatchObject({ name: 'module_loginweb_reactjs', version: '0.1.0' });
    expect(c.target).toMatchObject({ name: 'react', range: '^18.0.0', declaredBy: { name: '@testing-library/react', version: '13.4.0' } });
    expect(c.installed).toBe('19.0.0');
    expect(c.verdict.satisfied).toBe(false);
    expect(c.verdict.sets[0].failed).toEqual(['<19.0.0-0']);
    expect(fixIds(c)).toEqual(['upgrade', 'align', 'overrides', 'legacy-peer-deps', 'force']);
    const ov = c.fixes.find((f) => f.id === 'overrides');
    expect(JSON.parse(ov.snippet)).toEqual({ overrides: { '@testing-library/react': { react: '$react' } } });
    expect(ov.body).not.toMatch(/EOVERRIDE/);
    expect(c.fixes[0].commands).toEqual(['npm view @testing-library/react peerDependencies', 'npm view @testing-library/react versions']);
  });

  it('checks a multi-alternative range: React 19 vs ^16.8.0 || ^17.0.0 || ^18.0.0', () => {
    const log = EXAMPLE_LOG.replace('peer react@"^18.0.0"', 'peer react@"^16.8.0 || ^17.0.0 || ^18.0.0"');
    const [c] = analyseEresolveLog(log).conflicts;
    expect(c.verdict.sets.map((s) => s.failed[0])).toEqual(['<17.0.0-0', '<18.0.0-0', '<19.0.0-0']);
  });

  it('reads npm-debug.log lines and quoted ids (SO q/64936044)', () => {
    const debugLog = `38 error code ERESOLVE
39 error ERESOLVE unable to resolve dependency tree
40 error
41 error While resolving: "example"@"1.0.0"
41 error Found: mapbox-gl@"1.13.0"
41 error node_modules/mapbox-gl
41 error   mapbox-gl@"^1.13.0" from the root project
41 error
41 error Could not resolve dependency:
41 error peer mapbox-gl@"^0.53.0" from vue-mapbox@"0.4.1"
41 error node_modules/vue-mapbox
41 error   vue-mapbox@"*" from the root project
41 error
41 error Fix the upstream dependency conflict, or retry
41 error this command with --force, or --legacy-peer-deps
41 error to accept an incorrect (and potentially broken) dependency resolution.
41 error
41 error See /Users/user/.npm/eresolve-report.txt for a full report.
42 verbose exit 1`;
    const [c] = analyseEresolveLog(debugLog).conflicts;
    expect(c.root).toMatchObject({ name: 'example', version: '1.0.0' });
    expect(c.installed).toBe('1.13.0');
    expect(c.target).toMatchObject({ name: 'mapbox-gl', range: '^0.53.0', declaredBy: { name: 'vue-mapbox', version: '0.4.1' } });
    expect(c.verdict.sets[0].failed).toEqual(['<0.54.0-0']);
  });

  it('ignores prose around a normal paste (SO q/66239691 shape)', () => {
    const log = `Just ran into this error:
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
npm ERR!
npm ERR! While resolving: nexttwin@0.1.0
npm ERR! Found: react@17.0.1
npm ERR! node_modules/react
npm ERR!   react@"17.0.1" from the root project
npm ERR!
npm ERR! Could not resolve dependency:
npm ERR! peer react@"^16.8.0" from react-hook-mousetrap@2.0.4
npm ERR! node_modules/react-hook-mousetrap
npm ERR!   react-hook-mousetrap@"*" from the root project
npm ERR!
The module I am trying to install seems to have a different peer dependency from the root project`;
    const [c] = analyseEresolveLog(log).conflicts;
    expect(c.target.declaredBy.name).toBe('react-hook-mousetrap');
    expect(c.directDependency).toMatchObject({ name: 'react-hook-mousetrap', spec: '*' });
    expect(c.verdict.sets[0].failed).toEqual(['<17.0.0-0']);
  });

  it('parses SO q/64573177 (npm ERR!, exact peer version, scoped names)', () => {
    const [c] = analyseEresolveLog(ANGULAR).conflicts;
    expect(c.header).toBe('unable to resolve dependency tree');
    expect(c.target).toMatchObject({ name: '@angular/core', range: '7.2.16', type: 'peer' });
    expect(c.target.declaredBy).toEqual({ name: '@angular/http', version: '7.2.16' });
    expect(c.installed).toBe('9.1.12');
    expect(c.verdict.sets[0].failed).toEqual(['=7.2.16']);
    expect(c.targetRootSpec).toBe('^9.1.4');
    expect(c.directDependency).toMatchObject({ name: '@angular/http', spec: '^7.2.11' });
  });

  it('uses the Conflicting peer node when the unresolved edge is a plain dependency (SO q/71517176)', () => {
    const [c] = analyseEresolveLog(REDUX_FORM).conflicts;
    expect(c.header).toBe('could not resolve');
    expect(c.unresolvedEdge).toMatchObject({ name: 'redux-form', spec: '^8.3.6', type: 'prod' });
    expect(c.target).toMatchObject({ name: 'react', range: '^16.4.2', declaredBy: { name: 'redux-form', version: '8.3.7' } });
    expect(c.installed).toBe('17.0.2');
    expect(c.verdict.satisfied).toBe(false);
    expect(c.foundRequiredBy.map((d) => d.from)).toEqual(['the root project', '@material-ui/core@4.11.4']);
    const align = c.fixes.find((f) => f.id === 'align');
    expect(align.commands).toEqual(['npm install react@"^16.4.2"']);
    expect(align.tradeoff).toContain('@material-ui/core@4.11.4');
  });

  it('walks a peerOptional chain up to the direct dependency (SO q/78412358)', () => {
    const [c] = analyseEresolveLog(DRIZZLE).conflicts;
    expect(c.target).toMatchObject({ name: 'react', range: '18.2.0', declaredBy: { name: 'react-native', version: '0.74.0' } });
    expect(c.installed).toBe('18.3.1');
    expect(c.verdict.satisfied).toBe(false);
    expect(c.chain.map((e) => e.name)).toEqual(['react-native', '@op-engineering/op-sqlite', 'drizzle-orm']);
    expect(c.reachedRoot).toBe(true);
    expect(c.directDependency.name).toBe('drizzle-orm');
    expect(c.fixes[0].title).toContain('drizzle-orm');
    expect(c.fixes[0].commands).toContain('npm explain react-native');
    // react is only a peer of other packages here, never a root dependency
    expect(c.targetIsDirect).toBe(false);
    expect(fixIds(c)).not.toContain('align');
    expect(JSON.parse(c.fixes.find((f) => f.id === 'overrides').snippet))
      .toEqual({ overrides: { 'react-native': { react: '18.3.1' } } });
  });

  it('survives a collapsed paste and does not invent the installed react version (SO q/72731227)', () => {
    const r = analyseEresolveLog(COLLAPSED);
    expect(r.conflicts).toHaveLength(1);
    const [c] = r.conflicts;
    expect(c.root).toMatchObject({ name: 'undefined', version: 'undefined' });
    expect(c.target).toMatchObject({ name: 'react', range: '18.0.0', declaredBy: { name: 'react-native', version: '0.69.0' } });
    expect(c.found.name).toBe('react-native');
    expect(c.installed).toBeNull();
    expect(c.verdict).toBeNull();
    expect(c.findings.find((f) => f.id === 'range').body).toContain('does not show');
    expect(c.findings.map((f) => f.id)).toContain('no-root-name');
    // report paths (which carry the user name) are never echoed
    expect(JSON.stringify(r)).not.toContain('SOMEONE');
  });

  it('treats "npm WARN ERESOLVE overriding peer dependency" blocks as warnings (SO q/74286616)', () => {
    const r = analyseEresolveLog(STORYBOOK_WARN);
    expect(r.conflicts).toHaveLength(2);
    expect(r.conflicts.every((c) => c.kind === 'warning')).toBe(true);
    const [a, b] = r.conflicts;
    expect(a.target).toMatchObject({ name: 'react', range: '^16.8.4 || ^17.0.0', declaredBy: { name: 'react-inspector' } });
    expect(a.directDependency).toBeNull();
    expect(a.chain.map((e) => e.name)).toEqual(['react-inspector']);
    expect(a.reachedRoot).toBe(false);
    expect(b.target.declaredBy.name).toBe('@mdx-js/react');
    expect(fixIds(a)).not.toContain('legacy-peer-deps');
    expect(fixIds(a)).not.toContain('force');
    expect(a.findings[0].severity).toBe('info');
    expect(a.findings[0].source).toBe(SOURCES.strictPeerDeps);
  });

  it('offers --no-strict-peer-deps only when npm listed it (npm/cli snapshot cycleNested)', () => {
    const [c] = analyseEresolveLog(CYCLE_NESTED).conflicts;
    expect(c.strictPeerDeps).toBe(true);
    expect(c.target).toMatchObject({ name: '@isaacs/peer-dep-cycle-c', range: '1' });
    expect(c.installed).toBe('2.0.0');
    expect(c.verdict.sets[0].failed).toEqual(['<2.0.0-0']);
    expect(fixIds(c)).toContain('no-strict-peer-deps');
    expect(fixIds(analyseEresolveLog(ANGULAR).conflicts[0])).not.toContain('no-strict-peer-deps');
  });

  it('strips ANSI colour codes (real and bracket-only residue) and CRLF', () => {
    const coloured = 'npm error code ERESOLVE\n'
      + 'npm error Found: react@19.0.0\x1b[2m\x1b[22m\n'
      + 'npm error \x1b[2mnode_modules/react\x1b[22m\n'
      + 'npm error   react@"^19.0.0" from the root project\n'
      + 'npm error Could not resolve dependency:\n'
      + 'npm error [95mpeer[39m react@"^18.0.0" from some-lib@2.3.1[2m[22m\n';
    const [c] = analyseEresolveLog(coloured.replace(/\n/g, '\r\n')).conflicts;
    expect(c.installed).toBe('19.0.0');
    expect(c.target).toMatchObject({ name: 'react', range: '^18.0.0', type: 'peer' });
  });

  it('every finding and fix carries a primary-source URL', () => {
    for (const log of [EXAMPLE_LOG, REDUX_FORM, DRIZZLE, STORYBOOK_WARN, CYCLE_NESTED]) {
      for (const c of analyseEresolveLog(log).conflicts) {
        for (const x of [...c.findings, ...c.fixes]) {
          expect(Object.values(SOURCES)).toContain(x.source);
        }
      }
    }
  });
});

describe('analyseEresolveLog — negatives and garbage', () => {
  it('does not trigger on another npm error (ETARGET, same SO question)', () => {
    const r = analyseEresolveLog(ETARGET);
    expect(r.conflicts).toEqual([]);
    expect(r.detected).toBe(false);
    expect(r.reason).toBe('other-code');
    expect(r.code).toBe('ETARGET');
  });

  it('handles empty, whitespace, garbage and non-string input', () => {
    expect(analyseEresolveLog('')).toMatchObject({ detected: false, reason: 'empty', conflicts: [] });
    expect(analyseEresolveLog('   \n\t')).toMatchObject({ reason: 'empty' });
    expect(analyseEresolveLog(undefined).conflicts).toEqual([]);
    expect(analyseEresolveLog('lorem ipsum @@@ "" from from from').reason).toBe('no-eresolve');
    expect(analyseEresolveLog('npm error code ERESOLVE\nnpm error something odd').reason).toBe('unparsed');
    expect(() => analyseEresolveLog('x'.repeat(500000))).not.toThrow();
  });

  it('masks tokens and credentials that ride along in a paste', () => {
    expect(maskSecrets(`//registry.npmjs.org/:_authToken=${FAKE_NPM_LONG}`))
      .not.toMatch(/abcdefghijklmnop/);
    expect(maskSecrets('https://bob:hunter2@registry.example.com/')).toBe('https://bob:****@registry.example.com/');
    const log = `${EXAMPLE_LOG.replace('some-lib@2.3.1', 'some-lib@2.3.1')}\nnpm error //r.example/:_authToken=${FAKE_NPM}`;
    expect(JSON.stringify(analyseEresolveLog(log))).not.toMatch(/abcdefghijklmnop/);
  });
});

// npm/cli tap snapshot "eslint-plugin case > report from color": the installed
// eslint is BELOW the peer range, and another peer excludes the whole range.
const ESLINT_PLUGIN = `While resolving: eslint-plugin-react@7.24.0
Found: eslint@6.8.0
node_modules/eslint
  dev eslint@"^3 || ^4 || ^5 || ^6 || ^7" from the root project
  peer eslint@"^5.0.0 || ^6.0.0" from @typescript-eslint/parser@2.34.0
  node_modules/@typescript-eslint/parser
    dev @typescript-eslint/parser@"^2.34.0" from the root project
  peer eslint@"^5.16.0 || ^6.8.0 || ^7.2.0" from eslint-config-airbnb-base@14.2.1
  node_modules/eslint-config-airbnb-base
    dev eslint-config-airbnb-base@"^14.2.1" from the root project
  peer eslint@"^2 || ^3 || ^4 || ^5 || ^6 || ^7.2.0" from eslint-plugin-import@2.23.4
  node_modules/eslint-plugin-import
    dev eslint-plugin-import@"^2.23.4" from the root project
    peer eslint-plugin-import@"^2.22.1" from eslint-config-airbnb-base@14.2.1
    node_modules/eslint-config-airbnb-base
      dev eslint-config-airbnb-base@"^14.2.1" from the root project

Could not resolve dependency:
dev eslint-plugin-eslint-plugin@"^3.1.0" from the root project

Conflicting peer dependency: eslint@7.31.0
node_modules/eslint
  peer eslint@"^7.0.0" from eslint-plugin-eslint-plugin@3.5.1
  node_modules/eslint-plugin-eslint-plugin
    dev eslint-plugin-eslint-plugin@"^3.1.0" from the root project

Fix the upstream dependency conflict, or retry this command with --force or --legacy-peer-deps to accept an incorrect (and potentially broken) dependency resolution.`;

// `npm i react-dom@18` in a React 17 project: installed react is BELOW the peer range.
// Assembled from the shape in the adversarial review; peer ranges verified with
// `npm view react-dom@18.3.1 peerDependencies` -> { react: "^18.3.1" }.
const REACT17_DOM18 = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: app@1.0.0
npm error Found: react@17.0.2
npm error node_modules/react
npm error   react@"^17.0.2" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react@"^18.3.1" from react-dom@18.3.1
npm error node_modules/react-dom
npm error   react-dom@"^18.3.1" from the root project`;

// The conflicting peer is a candidate npm tried to place for ANOTHER package's
// peer. Assembled log (explain-eresolve.js prints peerConflict.peer, the node
// npm tried to place); ranges verified with `npm view react-beautiful-dnd@13.1.0
// peerDependencies` -> react-dom "^16.8.5 || ^17.0.0" and `npm view
// react-dom@17.0.2 peerDependencies` -> react "17.0.2".
const RBD_CANDIDATE = `npm error code ERESOLVE
npm error ERESOLVE could not resolve
npm error
npm error While resolving: react-beautiful-dnd@13.1.0
npm error Found: react@18.2.0
npm error node_modules/react
npm error   react@"^18.2.0" from the root project
npm error
npm error Could not resolve dependency:
npm error peer react-dom@"^16.8.5 || ^17.0.0" from react-beautiful-dnd@13.1.0
npm error node_modules/react-beautiful-dnd
npm error   react-beautiful-dnd@"^13.1.0" from the root project
npm error
npm error Conflicting peer dependency: react@17.0.2
npm error node_modules/react
npm error   peer react@"17.0.2" from react-dom@17.0.2
npm error   node_modules/react-dom
npm error     peer react-dom@"^16.8.5 || ^17.0.0" from react-beautiful-dnd@13.1.0
npm error     node_modules/react-beautiful-dnd
npm error       react-beautiful-dnd@"^13.1.0" from the root project`;

const ranks = (c) => c.fixes.map((f) => f.rank);

describe('fix direction follows the verdict (regressions)', () => {
  it('reports which side of the range the installed version is on', () => {
    expect(explainSatisfies('17.0.2', '^18.3.1').direction).toBe('below');
    expect(explainSatisfies('19.0.0', '^18.0.0').direction).toBe('above');
    expect(explainSatisfies('9.1.12', '7.2.16').direction).toBe('above');
    expect(explainSatisfies('6.0.0', '7.2.16').direction).toBe('below');
    // too new for one alternative, too old for the other: no single direction
    expect(explainSatisfies('17.0.0', '^16.0.0 || ^18.0.0').direction).toBeNull();
    expect(explainSatisfies('18.3.0-canary.1', '^18.0.0').direction).toBeNull();
  });

  it('installed too OLD: raises the peer first, never "upgrade the dependent"', () => {
    const [c] = analyseEresolveLog(REACT17_DOM18).conflicts;
    expect(c.verdict.direction).toBe('below');
    expect(fixIds(c)).toEqual(['align', 'older-dependent', 'overrides', 'legacy-peer-deps', 'force']);
    expect(ranks(c).slice(0, 3)).toEqual(['best', 'alternative', 'workaround']);
    expect(c.fixes[0].title).toBe('Upgrade react to a version inside "^18.3.1"');
    expect(c.fixes[0].tradeoff).not.toMatch(/whatever you upgraded it for/);
    const older = c.fixes[1];
    expect(older.title).toMatch(/^Use an older react-dom/);
    expect(older.commands[0]).toBe('npm view react-dom@"<18.3.1" peerDependencies');
    expect(c.fixes.map((f) => f.title).join(' ')).not.toMatch(/Upgrade react-dom/);
    expect(c.fixes.find((f) => f.id === 'overrides').tradeoff).toMatch(/BELOW the lowest react version react-dom@18\.3\.1 declares/);
  });

  it('installed too NEW: upgrading the dependent stays the best fix', () => {
    const [c] = analyseEresolveLog(EXAMPLE_LOG).conflicts;
    expect(c.verdict.direction).toBe('above');
    expect(c.fixes[0]).toMatchObject({ id: 'upgrade', rank: 'best' });
    expect(c.fixes[1].tradeoff).toMatch(/whatever you upgraded it for/);
    expect(c.fixes.find((f) => f.id === 'overrides').tradeoff).not.toMatch(/BELOW/);
  });
});

describe('align checks the other dependents (regression, npm/cli eslint-plugin case)', () => {
  it('rangesIntersect finds a common release version or proves there is none', () => {
    expect(rangesIntersect('^7.0.0', '^5.0.0 || ^6.0.0')).toBeNull();
    expect(rangesIntersect('^7.0.0', '^5.16.0 || ^6.8.0 || ^7.2.0')).toBe('7.2.0');
    expect(rangesIntersect('>1.2.3', '<1.2.5')).toBe('1.2.4');
    expect(rangesIntersect('^1.0.0', '*')).toBe('1.0.0');
    expect(rangesIntersect('latest', '^1.0.0')).toBeUndefined();
  });

  it('names the peer the install would break and demotes the align fix', () => {
    const [c] = analyseEresolveLog(ESLINT_PLUGIN).conflicts;
    expect(c.target).toMatchObject({ name: 'eslint', range: '^7.0.0', declaredBy: { name: 'eslint-plugin-eslint-plugin', version: '3.5.1' } });
    expect(c.installed).toBe('6.8.0');
    expect(c.verdict.direction).toBe('below');
    expect(fixIds(c).slice(0, 3)).toEqual(['older-dependent', 'align', 'overrides']);
    const align = c.fixes.find((f) => f.id === 'align');
    expect(align.rank).toBe('alternative');
    expect(align.title).toMatch(/^Only together with other upgrades/);
    expect(align.tradeoff).toContain('will break: @typescript-eslint/parser@2.34.0 (peer eslint@"^5.0.0 || ^6.0.0")');
    expect(align.tradeoff).toContain('eslint-config-airbnb-base@14.2.1');
    expect(align.tradeoff).not.toMatch(/may need the newer version/);
    // eslint is a devDependency of the root: keep it there
    expect(align.commands).toEqual(['npm install --save-dev eslint@"^7.0.0"']);
    expect(c.fixes[0].commands[0]).toBe('npm view eslint-plugin-eslint-plugin@"<3.5.1" peerDependencies');
  });
});

describe('CI / hosting build-log prefixes (regression)', () => {
  const prefixed = (fn) => EXAMPLE_LOG.split('\n').map((l, i) => `${fn(i)}${l}`).join('\n');
  it.each([
    ['GitHub Actions', (i) => `2024-11-20T10:15:${String(i).padStart(2, '0')}.1234567Z `],
    ['Vercel', (i) => `[10:15:${String(i).padStart(2, '0')}.123] `],
    ['Docker BuildKit', (i) => `#8 1.${i}23 `],
    ['Netlify', (i) => `3:42:${String(i).padStart(2, '0')} PM: `],
  ])('reads a %s log as well as a bare one', (_name, fn) => {
    const [c] = analyseEresolveLog(prefixed(fn)).conflicts;
    expect(c.installed).toBe('19.0.0');
    expect(c.targetIsDirect).toBe(true);
    expect(c.directDependency).toMatchObject({ name: '@testing-library/react' });
    expect(fixIds(c)).toEqual(['upgrade', 'align', 'overrides', 'legacy-peer-deps', 'force']);
    expect(c.findings.find((f) => f.id === 'range').body).not.toContain('does not show');
  });

  it('does not strip words in front of "npm error" (collapsed pastes keep working)', () => {
    expect(analyseEresolveLog(COLLAPSED).conflicts[0].target.name).toBe('react');
  });
});

describe('conflicting peer that is a candidate for another package (regression)', () => {
  it('points at the edge declarer, not at the candidate npm tried to place', () => {
    const [c] = analyseEresolveLog(RBD_CANDIDATE).conflicts;
    expect(c.target).toMatchObject({ name: 'react', range: '17.0.2', declaredBy: { name: 'react-dom', version: '17.0.2' } });
    expect(c.viaEdge).toMatchObject({ name: 'react-beautiful-dnd', version: '13.1.0', peerName: 'react-dom' });
    const up = c.fixes[0];
    expect(up.id).toBe('upgrade');
    expect(up.commands).toEqual(['npm view react-beautiful-dnd peerDependencies', 'npm view react-beautiful-dnd versions']);
    expect(up.title).toBe('Upgrade react-beautiful-dnd to a release whose react-dom peer range works with react@18.2.0');
    const chain = c.findings.find((f) => f.id === 'chain').body;
    expect(chain).not.toMatch(/react-dom@17\.0\.2 is in your tree/);
    expect(chain).toContain('react-dom@17.0.2 is not in your tree yet');
    expect(chain).toContain('npm tried to install react-dom@17.0.2');
  });

  it('npm/cli cycleNested: looks at peer-dep-cycle-a, whose peer edge failed', () => {
    const [c] = analyseEresolveLog(CYCLE_NESTED).conflicts;
    expect(c.viaEdge).toMatchObject({ name: '@isaacs/peer-dep-cycle-a', peerName: '@isaacs/peer-dep-cycle-b' });
    expect(c.fixes[0].commands[0]).toBe('npm view @isaacs/peer-dep-cycle-a peerDependencies');
  });
});

describe('secret masking in echoed specs (regression)', () => {
  it('masks a token used as the URL user name, token query params and GitLab / fine-grained GitHub tokens', () => {
    const pat = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab';
    expect(maskSecrets(`https://${pat}@github.com/x`)).not.toContain('abcdefghijklmnop');
    expect(maskSecrets(`https://${FAKE_GLPAT_A}@gitlab.com/x`)).toBe('https://glpat-****@gitlab.com/x');
    expect(maskSecrets('https://0123456789abcdef0123456789abcdef@git.example.com/x')).toBe('https://****@git.example.com/x');
    expect(maskSecrets('https://gitlab.com/api/v4/projects/1/packages/npm/a.tgz?private_token=secretsecret123'))
      .toBe('https://gitlab.com/api/v4/projects/1/packages/npm/a.tgz?private_token=****');
    // a plain short user name stays readable
    expect(maskSecrets('git+ssh://git@github.com/acme/ui.git')).toBe('git+ssh://git@github.com/acme/ui.git');
  });

  it('never echoes a token from a git or tarball spec in the analysis', () => {
    const log = [
      'npm error code ERESOLVE',
      'npm error ERESOLVE unable to resolve dependency tree',
      'npm error Found: react@19.0.0',
      'npm error node_modules/react',
      'npm error   react@"^19.0.0" from the root project',
      'npm error Could not resolve dependency:',
      'npm error peer react@"^18.0.0" from ui-kit@1.0.0',
      'npm error node_modules/ui-kit',
      `npm error   ui-kit@"git+https://${FAKE_GLPAT_A}@gitlab.com/acme/ui-kit.git" from the root project`,
      `npm error   other@"https://gitlab.example.com/o.tgz?private_token=${FAKE_GLPAT_B}" from the root project`,
    ].join('\n');
    const out = JSON.stringify(analyseEresolveLog(log));
    expect(out).toContain('ui-kit');
    expect(out).not.toMatch(/glpat-[A-Za-z0-9]{8,}/);
  });
});

describe('performance on hostile input (regression)', () => {
  it.each([
    ['prefixed line with a whitespace run', `npm error code ERESOLVE\nnpm error x${' '.repeat(190000)}y\n`],
    ['bare edge line with a whitespace run', `Found: react@1.0.0\na@"1" from x${' '.repeat(190000)}y`],
    ['long edge line under the line cap', `Found: react@1.0.0\na@"1" from x${' '.repeat(3900)}y\n`.repeat(40)],
    ['many short whitespace lines', `npm error code ERESOLVE\n${'npm error a@"1" from x          y\n'.repeat(5000)}`],
  ])('stays fast: %s', (_name, input) => {
    const t = Date.now();
    analyseEresolveLog(input);
    expect(Date.now() - t).toBeLessThan(500);
  });
});
