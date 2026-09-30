// Type declarations for dev-error-explainers/database-url-doctor

export type Severity = 'critical' | 'warning' | 'info';

/** Client the corrected strings and advice target. Unknown values fall back to `'prisma'`. */
export type DatabaseClient = 'prisma' | 'drizzle' | 'pg' | 'psql';

export type HostKind =
  | 'direct'
  | 'dedicated-pooler'
  | 'shared-session'
  | 'shared-transaction'
  | 'api-host'
  | 'local'
  | 'generic';

export type HostProvider = 'supabase' | 'local' | 'generic';

/** Ids of the "what gets checked" catalogue (`RULES`) — groups, not the emitted finding ids. */
export type RuleGroupId =
  | 'password-needs-encoding'
  | 'placeholder-left'
  | 'pooler-username'
  | 'port-mode'
  | 'direct-ipv6'
  | 'prepared-statements'
  | 'migrations-through-transaction-pooler'
  | 'sslmode'
  | 'generic';

export interface ArticleLink {
  /** Site-relative path on iloveblogs.blog. */
  href: string;
  label: string;
}

export interface DatabaseUrlFinding {
  /** e.g. `'password-needs-encoding'`, `'pooler-username'`, `'invalid-port'`, `'sslmode-invalid'`. */
  id: string;
  severity: Severity;
  title: string;
  body: string;
  /** Corrected value, config or command. */
  fix: string;
  /** Primary-source URL. */
  source: string;
  link: ArticleLink | null;
}

/** One row of the parsed-components table (the password is always masked). */
export interface UrlComponent {
  label: string;
  value: string;
}

/** A corrected environment variable. */
export interface CorrectedUrl {
  name: 'DATABASE_URL' | 'DIRECT_URL';
  /** The password is `[YOUR-PASSWORD]` unless obtained through `correctedWithPassword`. */
  value: string;
  note: string | null;
}

export interface DiagnoseOptions {
  client?: DatabaseClient | undefined;
  /** The URL is (also) used for migrations, psql or pg_dump. */
  forMigrations?: boolean | undefined;
}

interface DiagnosisBase {
  client: DatabaseClient;
  forMigrations: boolean;
  components: UrlComponent[];
  /** Most severe first. */
  findings: DatabaseUrlFinding[];
  corrected: CorrectedUrl[];
}

/** The input parsed as a postgres:// / postgresql:// URI. */
export interface DatabaseUrlDiagnosisOk extends DiagnosisBase {
  ok: true;
  kind: HostKind;
  kindLabel: string;
}

/** Empty input, no scheme, or a non-Postgres scheme. `components` and `corrected` are empty. */
export interface DatabaseUrlDiagnosisFailed extends DiagnosisBase {
  ok: false;
  kind: null;
  kindLabel: null;
}

export type DatabaseUrlDiagnosis = DatabaseUrlDiagnosisOk | DatabaseUrlDiagnosisFailed;

export interface QueryParam {
  key: string;
  value: string;
}

export interface ParsedConnectionString {
  ok: true;
  scheme: 'postgres' | 'postgresql';
  rawUser: string | null;
  user: string | null;
  rawPassword: string | null;
  hasPassword: boolean;
  /** Lowercased; IPv6 literals keep their brackets. */
  host: string;
  hostIsIpv6: boolean;
  multiHost: boolean;
  rawPort: string | null;
  /** `null` when absent or not numeric. */
  port: number | null;
  database: string | null;
  params: QueryParam[];
}

export type ConnectionStringParseError =
  | { ok: false; errorId: 'empty' }
  | { ok: false; errorId: 'no-scheme'; raw: string }
  | { ok: false; errorId: 'wrong-scheme'; scheme: string; host: string };

export type ConnectionStringParseResult = ParsedConnectionString | ConnectionStringParseError;

export interface HostClassification {
  provider: HostProvider;
  kind: HostKind;
  /** Supabase project ref when known. */
  ref: string | null;
  /** Transaction-mode pooler (port 6543). */
  transaction: boolean;
}

export interface RuleGroup {
  id: RuleGroupId;
  name: string;
  detail: string;
  source: string;
}

export const SOURCES: Readonly<Record<
  | 'supabaseConnect' | 'supabaseDrivers' | 'supabaseTenant' | 'supabaseIpv4' | 'supabaseSsl'
  | 'supabasePrisma' | 'supabaseDrizzle' | 'supabaseApi' | 'prismaPgbouncer' | 'prisma7' | 'libpq'
  | 'rfc3986' | 'nodePgQueries' | 'nodePgSsl' | 'postgresJs' | 'pgConnectionString' | 'nextEnv',
  string
>>;
/** Client id → display name. */
export const CLIENTS: Readonly<Record<DatabaseClient, string>>;
/** The "what gets checked" catalogue. */
export const RULES: readonly RuleGroup[];

/** Characters of a userinfo component that must be percent-encoded (`@ # / ? [ ]`, space, bare `%`). */
export function findUnencodedChars(component: string | null | undefined): string[];
/** Strip `export`, `NAME=`, quotes and inline comments; picks the postgres:// line of a pasted .env. */
export function normaliseInput(input: string): string;
/** Parse without the WHATWG URL parser, so unencoded `@ # / ?` in a password still split as intended. */
export function parseConnectionString(input: string): ConnectionStringParseResult;
export function classifyHost(parsed: Pick<ParsedConnectionString, 'host' | 'port' | 'user'>): HostClassification;

/**
 * Diagnose a connection string (or a whole `DATABASE_URL=…` line).
 * The password never appears in the result.
 */
export function diagnose(input: string, options?: DiagnoseOptions): DatabaseUrlDiagnosis;
/**
 * The corrected strings WITH the user's real (percent-encoded) password.
 * Meant for a "copy" handler only — never render it.
 */
export function correctedWithPassword(input: string, options?: DiagnoseOptions): CorrectedUrl[];
