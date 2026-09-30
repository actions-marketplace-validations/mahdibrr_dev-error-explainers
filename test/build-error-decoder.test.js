import { RULES, EXAMPLES, decode, findEvidence } from '../src/build-error-decoder.js';
// Error signatures this decoder is declared to recognise (the site's tool catalogue).
const DECLARED_SIGNATURES = ["should be wrapped in a suspense boundary","missing-suspense-with-csr-bailout","Dynamic server usage","couldn't be rendered statically","window is not defined","document is not defined","Module not found: Can't resolve","Cannot find module '@/","JavaScript heap out of memory","Hydration failed","Text content does not match","stuck on compiling","EADDRINUSE","Cannot find module 'next/babel'","is not configured under images","Invalid src prop"];

describe('build-error-decoder', () => {
  test('every rule has a label, a severity and a fix link', () => {
    for (const r of RULES) {
      expect(r.signature).toEqual(expect.any(String));
      expect(['critical', 'warning', 'info']).toContain(r.severity);
      expect(r.link.href).toMatch(/^\/(post|guides|fix)\//);
    }
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  test('each one-click example decodes to its own rule, with a located line', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(10);
    for (const ex of EXAMPLES) {
      const hit = decode(ex.output).find((r) => r.id === ex.id);
      expect(hit).toBeDefined();
      expect(hit.evidence).not.toBeNull();
      expect(ex.output.split('\n')[hit.evidence.lineNo - 1].trim()).toBe(hit.evidence.line);
    }
  });

  test('evidence points at the triggering line, not the first line', () => {
    const out = 'info  - Linting and checking validity of types\n'
      + 'Creating an optimized production build ...\r\n'
      + 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory';
    const [hit] = decode(out);
    expect(hit.id).toBe('heap-oom');
    expect(hit.evidence).toEqual({
      lineNo: 3,
      line: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
    });
  });

  test('results are ordered most severe first', () => {
    const out = 'Error: listen EADDRINUSE: address already in use :::3000\nReferenceError: window is not defined';
    expect(decode(out).map((r) => r.severity)).toEqual(['critical', 'warning']);
  });

  test('a multi-line-only match still fires, without a fabricated evidence line', () => {
    const r = RULES.find((x) => x.id === 'turbopack-stuck');
    expect(findEvidence(r.pattern, '▲ Next.js 15 (turbopack)\n\nit just hangs')).toBeNull();
    expect(decode('▲ Next.js 15 (turbopack)\n\nit just hangs').map((x) => x.id)).toContain('turbopack-stuck');
  });

  test('empty or non-string input decodes to nothing', () => {
    expect(decode('')).toEqual([]);
    expect(decode('   \n ')).toEqual([]);
    expect(decode(undefined)).toEqual([]);
    expect(decode('✓ Compiled successfully')).toEqual([]);
  });

  // The Error Inbox routes pasted errors to this tool on these strings: each
  // must actually be detected, or the inbox promises a diagnosis it cannot give.
  // Signatures are fragments, so a fragment that needs its surrounding words
  // (e.g. "should be wrapped in a suspense boundary" is always preceded by
  // "useSearchParams()") counts when the full message sample containing it hits.
  test('every declared error signature is detected', () => {
    for (const sig of DECLARED_SIGNATURES) {
      const alone = decode(sig).length > 0;
      const inContext = RULES.some((r) => r.sample && r.sample.includes(sig) && decode(r.sample).length > 0);
      expect({ sig, detected: alone || inContext }).toEqual({ sig, detected: true });
    }
  });
});
