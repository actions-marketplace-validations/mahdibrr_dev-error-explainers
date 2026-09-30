// Type-level test of the declarations (not shipped logic). Imports go through
// the package name, so they resolve via package.json "exports" → "types",
// exactly as a consumer's would. Run: npx -p typescript@5 tsc -p types/tsconfig.json (kept out of the npm tarball)

import {
  diagnoseCors, explainEsmCjs, analyseEresolveLog, diagnoseChunkCache,
  diagnoseDatabaseUrl, decodeBuildError, detect, MODULES,
  type ModuleName, type CorsDiagnosis, type EresolveFix,
} from 'dev-error-explainers';
import * as build from 'dev-error-explainers/build-error-decoder';
import * as chunk from 'dev-error-explainers/chunk-cache-explainer';
import * as cors from 'dev-error-explainers/cors-error-explainer';
import * as db from 'dev-error-explainers/database-url-doctor';
import * as esm from 'dev-error-explainers/esm-cjs-explainer';
import * as npm from 'dev-error-explainers/npm-eresolve-explainer';

type IsAny<T> = 0 extends 1 & T ? true : false;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
function assertType<T extends true>(): T | void {}

// ---- no `any` leaks on the main entry points --------------------------------
assertType<Equal<IsAny<ReturnType<typeof diagnoseCors>>, false>>();
assertType<Equal<IsAny<ReturnType<typeof explainEsmCjs>>, false>>();
assertType<Equal<IsAny<ReturnType<typeof analyseEresolveLog>>, false>>();
assertType<Equal<IsAny<ReturnType<typeof diagnoseChunkCache>>, false>>();
assertType<Equal<IsAny<ReturnType<typeof diagnoseDatabaseUrl>>, false>>();
assertType<Equal<IsAny<ReturnType<typeof decodeBuildError>>, false>>();
// index re-exports are the module functions themselves
assertType<Equal<typeof diagnoseCors, typeof cors.diagnose>>();
assertType<Equal<typeof decodeBuildError, typeof build.decode>>();

// ---- index -----------------------------------------------------------------
const modules: ModuleName[] = detect("Error [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/x/index.js");
const firstModule: ModuleName | undefined = MODULES[0];
void modules; void firstModule;

// ---- build-error-decoder ---------------------------------------------------
for (const hit of decodeBuildError('Error: listen EADDRINUSE: address already in use :::3000')) {
  const id: build.BuildRuleId = hit.id;
  const sev: 'critical' | 'warning' | 'info' = hit.severity;
  const line: number | undefined = hit.evidence?.lineNo;
  const href: string = hit.link.href;
  void id; void sev; void line; void href;
}
const ev = build.findEvidence(/EADDRINUSE/, 'x');
// @ts-expect-error findEvidence can return null
ev.lineNo;
// @ts-expect-error sample can be null
const sample: string = build.RULES[0]!.sample;
void sample;

// ---- chunk-cache-explainer -------------------------------------------------
const cc = diagnoseChunkCache({ htmlHeaders: chunk.EXAMPLE_HTML, chunkHeaders: chunk.EXAMPLE_CHUNK, host: 'auto', serviceWorker: true });
const verdict: 'cause-found' | 'suspects' | 'incomplete' | 'clean' = cc.verdict;
const critical: number = cc.counts.critical;
const hosts: chunk.DetectedHost[] = cc.detectedHosts;
for (const f of cc.findings) {
  const ruleId: chunk.ChunkRuleId = f.ruleId;
  const code: string | null = f.code;
  void ruleId; void code;
}
// @ts-expect-error html is null when nothing was pasted
cc.html.status;
const status: number | null | undefined = cc.chunk?.status;
diagnoseChunkCache({ host: 'fly.io' }); // unknown host strings pass through
diagnoseChunkCache();
const parsed = chunk.parseResponseHeaders('HTTP/2 404\ncf-cache-status: HIT');
const last = chunk.finalResponse(parsed);
const cacheStatus: string | null = chunk.getHeader(last, 'cf-cache-status');
const cacheControl = chunk.parseCacheControl('public, max-age=31536000, immutable');
const immutable: string | true | undefined = cacheControl['immutable'];
const masked: string = chunk.maskUrlSecrets('https://u:p@x.test/?token=1');
void verdict; void critical; void hosts; void status; void cacheStatus; void immutable; void masked;

// ---- cors-error-explainer --------------------------------------------------
const cd: CorsDiagnosis = diagnoseCors({
  error: "Access to fetch at 'https://api.example.com/v1' from origin 'http://localhost:3000' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.",
  headers: 'HTTP/2 204\naccess-control-allow-origin: *',
  stack: 'express',
});
const isCors: boolean | null = cd.isCorsProblem;
const stack: cors.StackId = cd.stack;
const credentials: boolean = cd.context.credentials;
// @ts-expect-error reasons exist on parseConsoleError() only
cd.context.reasons;
for (const f of cd.findings) {
  const kind: 'cors' | 'not-cors' | 'hint' = f.kind;
  const url: string = f.source.url;
  const steps: string[] = f.steps;
  void kind; void url; void steps;
}
if (cd.fix) {
  const filename: string = cd.fix.filename;
  // @ts-expect-error sources is only on the middleware fix
  const sources: cors.Source[] = cd.fix.sources;
  void filename; void sources;
}
const ctx = cors.parseConsoleError('Cross-Origin Request Blocked');
const reasons: string[] = ctx.reasons;
const fix = cors.buildFix('supabase-edge', cors.fixParams(ctx, { credentials: true }));
const diff: string | null = cors.describeOriginDiff('https://a.com/', 'https://a.com');
void isCors; void stack; void credentials; void reasons; void fix; void diff;

// ---- database-url-doctor ---------------------------------------------------
const dd = diagnoseDatabaseUrl('postgresql://postgres:p@ss@aws-0-eu-west-2.pooler.supabase.com:6543/postgres', { client: 'drizzle', forMigrations: true });
if (dd.ok) {
  const kind: db.HostKind = dd.kind;
  void kind;
} else {
  const kind: null = dd.kind;
  void kind;
}
for (const f of dd.findings) {
  const href: string | undefined = f.link?.href;
  void href;
}
const correctedName: 'DATABASE_URL' | 'DIRECT_URL' | undefined = dd.corrected[0]?.name;
// @ts-expect-error unknown client
diagnoseDatabaseUrl('postgres://x', { client: 'mysql' });
const pc = db.parseConnectionString('postgres://u@h:5432/d');
if (pc.ok) {
  const port: number | null = pc.port;
  const cls = db.classifyHost(pc);
  const transaction: boolean = cls.transaction;
  void port; void transaction;
} else if (pc.errorId === 'wrong-scheme') {
  const scheme: string = pc.scheme;
  void scheme;
}
const withPw: db.CorrectedUrl[] = db.correctedWithPassword('postgres://u:p@h/d', { client: 'prisma' });
void correctedName; void withPw;

// ---- esm-cjs-explainer -----------------------------------------------------
const ex = explainEsmCjs({ error: 'SyntaxError: Cannot use import statement outside a module', packageJson: '"type": "module"', fileExt: '.ts', nodeVersion: '22.12.0' });
for (const f of ex.findings) {
  const id: esm.EsmRuleId = f.id;
  const cause: string = f.cause;
  const code: string | undefined = f.fixes[0]?.code;
  const extra: string | undefined = f.extraSource?.url;
  void id; void cause; void code; void extra;
}
const versionSource: 'error' | 'input' | null = ex.context.versionSource;
const has: boolean | null = esm.hasFeature('20.19.0', 'requireEsmDefault');
const cmp: number = esm.compareVersions('22.12.0', esm.parseVersion('v20'));
esm.describeFeatureVersions('syntaxDetection');
// @ts-expect-error describeFeatureVersions throws on an unknown feature name
esm.describeFeatureVersions('nope');
const facts = esm.extractFromError('Node.js v22.3.0');
const nodeVersion: string | undefined = facts.nodeVersion;
void versionSource; void has; void cmp; void nodeVersion;

// ---- npm-eresolve-explainer ------------------------------------------------
const na = analyseEresolveLog(npm.EXAMPLE_LOG);
const reason: 'empty' | 'other-code' | 'unparsed' | 'no-eresolve' | undefined = na.reason;
for (const c of na.conflicts) {
  const kind: 'error' | 'warning' = c.kind;
  const range: string = c.target.range;
  if (c.verdict && c.verdict.valid) {
    const failed: string[] | undefined = c.verdict.sets[0]?.failed;
    void failed;
  }
  for (const f of c.fixes) {
    const rank: npm.FixRank = f.rank;
    // @ts-expect-error commands is absent on the overrides fix
    const commands: string[] = f.commands;
    void rank; void commands;
  }
  void kind; void range;
}
const fixOfType: EresolveFix['id'] = 'overrides';
const v = npm.parseVersion('18.3.1');
if (v) {
  const order: number = npm.compareVersions(v, v);
  void order;
}
// @ts-expect-error npm's compareVersions takes parsed versions, not strings
npm.compareVersions('1.0.0', '2.0.0');
const sat: boolean | null = npm.satisfies('18.3.1', '^18.0.0');
const witness: string | null | undefined = npm.rangesIntersect('^17 || ^18', '>=18');
const exp = npm.explainSatisfies('19.0.0', '^18.0.0');
if (exp.valid) {
  const direction: 'below' | 'above' | null = exp.direction;
  void direction;
}
void reason; void fixOfType; void sat; void witness;

// ---- optional inputs accept an explicit undefined (exactOptionalPropertyTypes)
declare const maybe: string | undefined;
diagnoseCors({ error: maybe, headers: maybe, stack: maybe });
diagnoseChunkCache({ htmlHeaders: maybe, chunkHeaders: maybe, host: maybe, serviceWorker: undefined });
explainEsmCjs({ error: maybe, packageJson: maybe, fileExt: maybe, nodeVersion: maybe });
diagnoseDatabaseUrl('postgres://x', { client: undefined, forMigrations: undefined });
cors.fixParams({ origin: maybe }, { credentials: undefined, extraHeaders: undefined });
cors.guessStack({ url: maybe });

// ---- 0.2.0: contract, redact, database-connection-explainer ---------------
import {
  diagnose as rootDiagnose, CONTRACT_RULES, FAMILIES, CONTRACT_VERSION, redact as rootRedact,
  explainDatabaseConnection, type Diagnosis, type Family,
} from 'dev-error-explainers';
import * as contract from 'dev-error-explainers/contract';
import * as redactMod from 'dev-error-explainers/redact';
import * as dbConn from 'dev-error-explainers/database-connection-explainer';

assertType<Equal<typeof rootDiagnose, typeof contract.diagnose>>();
assertType<Equal<typeof CONTRACT_RULES, typeof contract.RULES>>();
assertType<Equal<typeof rootRedact, typeof redactMod.redact>>();
assertType<Equal<typeof explainDatabaseConnection, typeof dbConn.explain>>();
const contractVersion: '0.1' = CONTRACT_VERSION;
const families: readonly Family[] = FAMILIES;
const dbFamily: Family = 'database-connection';
const result = rootDiagnose('Error: connect ECONNREFUSED 127.0.0.1:5432', { only: ['database-connection'], client: 'pg' });
const firstDiagnosis: Diagnosis | undefined = result.results[0];
const pair = contract.diagnoseHeaders({ htmlHeaders: 'HTTP/2 200', chunkHeaders: 'HTTP/2 404' });
const redactedText: string = rootRedact('Authorization: Bearer x').text;
const dbIds: readonly dbConn.DbConnectionRuleId[] = dbConn.RULE_IDS;
void contractVersion; void families; void dbFamily; void firstDiagnosis; void pair; void redactedText; void dbIds;
