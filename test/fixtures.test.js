/**
 * Runs diagnose() over the public corpus in fixtures/<family>/<case>/.
 *
 * expected.json holds only the STABLE parts of the result — matched, the
 * redaction count, and each result's rule id, family and severity, in order —
 * so rewording a title or a fix never breaks the corpus. Negative cases
 * (`absentFamilies`) must not produce a result of those families.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, FAMILIES, RULES } from '../src/contract.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const KNOWN = new Set(RULES.map((r) => r.rule));

// CRLF-normalise files a Windows checkout may have converted, but keep a CRLF
// that is part of an input (HTTP/1.1 headers) — input.txt is read verbatim.
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));

const cases = [];
for (const family of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, family);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const name of fs.readdirSync(dir)) {
    const caseDir = path.join(dir, name);
    if (fs.statSync(caseDir).isDirectory()) cases.push({ family, name, caseDir });
  }
}

const project = (r) => r.results.map((x) => ({ rule: x.rule, family: x.family, severity: x.severity }));

describe('fixtures corpus', () => {
  test('every family has at least 5 positive and 2 negative cases', () => {
    for (const family of FAMILIES) {
      const mine = cases.filter((c) => c.family === family);
      const negatives = mine.filter((c) => readJson(path.join(c.caseDir, 'expected.json')).absentFamilies);
      expect({ family, positives: mine.length - negatives.length >= 5, negatives: negatives.length >= 2 })
        .toEqual({ family, positives: true, negatives: true });
    }
  });

  test('every case has input.txt, expected.json and source.md', () => {
    for (const c of cases) {
      for (const f of ['input.txt', 'expected.json', 'source.md']) {
        expect({ case: `${c.family}/${c.name}`, f, exists: fs.existsSync(path.join(c.caseDir, f)) })
          .toEqual({ case: `${c.family}/${c.name}`, f, exists: true });
      }
    }
  });

  test.each(cases.map((c) => [`${c.family}/${c.name}`, c]))('%s', (_, c) => {
    const input = fs.readFileSync(path.join(c.caseDir, 'input.txt'), 'utf8');
    const expected = readJson(path.join(c.caseDir, 'expected.json'));
    const r = diagnose(input, expected.options || {});

    expect(r.version).toBe('0.1');
    expect(r.matched).toBe(expected.matched);
    expect(r.redactions).toBe(expected.redactions);
    expect(project(r)).toEqual(expected.results);
    for (const x of r.results) expect(KNOWN.has(x.rule)).toBe(true);

    if (expected.absentFamilies) {
      for (const fam of expected.absentFamilies) expect(r.results.map((x) => x.family)).not.toContain(fam);
    } else {
      expect(r.results.map((x) => x.family)).toContain(c.family);
    }
  });
});
