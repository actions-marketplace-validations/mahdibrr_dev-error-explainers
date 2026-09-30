// Type declarations for dev-error-explainers/database-connection-explainer

export interface Source {
  url: string;
  label: string;
}

export type DbConnectionSeverity = 'critical' | 'warning' | 'info';

export type DbConnectionRuleId =
  | 'db.econnrefused-ipv6-localhost'
  | 'db.econnrefused'
  | 'db.etimedout'
  | 'db.enotfound'
  | 'db.eai-again'
  | 'db.prisma-p1001'
  | 'db.prisma-p1000'
  | 'db.prisma-p1017'
  | 'db.password-auth-failed'
  | 'db.pg-hba-no-entry'
  | 'db.too-many-connections'
  | 'db.tls-self-signed'
  | 'db.server-no-ssl';

/**
 * Why the text was treated as a PostgreSQL connection error:
 * `'caller'` (`postgres: true`), `'connection-string'` (a postgres:// URL),
 * `'stack-frame'` (pg / pg-pool / postgres.js / @prisma/adapter-pg frame),
 * `'port'` (5432 or 6543, including Prisma's `` `host`:`5432` ``), `'host-name'` (a host literally named postgres).
 */
export type PostgresSignal =
  | 'caller'
  | 'connection-string'
  | 'stack-frame'
  | 'port'
  | 'host-name';

/** A check or fix, least invasive first within a finding. */
export interface DbConnectionFix {
  title: string;
  detail: string;
  /** Code or shell snippet (secrets masked); `''` when there is none. */
  code: string;
}

export interface DbConnectionFinding {
  id: DbConnectionRuleId;
  severity: DbConnectionSeverity;
  title: string;
  cause: string;
  why: string;
  fixes: DbConnectionFix[];
  /** The primary source this finding was verified against. */
  source: Source;
  /** Further supporting sources, on some findings only. */
  extraSources?: Source[];
}

/** A pointer to another module of this package (never carries the pasted URL). */
export interface DbConnectionRelated {
  module: 'database-url-doctor';
  reasons: string[];
}

export interface DbConnectionInput {
  /** The pasted error text (a whole stack trace is fine). */
  error?: string | undefined;
  /**
   * Assert that the error comes from a PostgreSQL connection. Needed only for
   * generic network / TLS codes when the text itself carries no Postgres signal.
   */
  postgres?: boolean | undefined;
}

export interface DbConnectionExplanation {
  /** At least one finding. */
  recognised: boolean;
  findings: DbConnectionFinding[];
  related: DbConnectionRelated[];
  context: { postgresSignal: PostgresSignal | null };
  /** Why nothing was recognised, or input caveats. */
  notes: string[];
}

export interface DbConnectionRule {
  id: DbConnectionRuleId;
  name: string;
  source: Source;
}

export const SOURCES: Readonly<Record<
  | 'nodeSystemErrors' | 'dnsResultOrder' | 'dnsLookup' | 'dnsImplementation' | 'netAutoSelectFamily'
  | 'libuvErrors' | 'tlsCodes' | 'nodeExtraCaCerts' | 'composeNetworking' | 'dockerNetworking'
  | 'dockerDesktopHost' | 'prismaErrors' | 'prismaEngineErrors' | 'pgAuthProblems' | 'pgHba'
  | 'pgConnSettings' | 'pgStatActivity' | 'pgSsl' | 'pgSourceTooMany' | 'pgSourceReserved'
  | 'pgSourceHba' | 'nodePgSsl' | 'nodePgPool' | 'nodePgPoolSizing' | 'nodePgNoSsl',
  Source
>>;
/** Rule catalogue, in evaluation order. */
export const RULES: readonly DbConnectionRule[];
/** Every rule id, in evaluation order. */
export const RULE_IDS: readonly DbConnectionRuleId[];

/** Masks URL passwords, tokens, bearer credentials, well-known token shapes and JWTs. Falsy → `''`. */
export function maskSecrets(text: unknown): string;
/** What in the text marks it as a PostgreSQL connection error; `null` when nothing does. */
export function postgresSignal(text: string, options?: { postgres?: boolean }): PostgresSignal | null;

/** Explain a "can't connect to the database" error from a Node.js app (pg, postgres.js, Prisma…). */
export function explain(input?: string | DbConnectionInput | null): DbConnectionExplanation;
