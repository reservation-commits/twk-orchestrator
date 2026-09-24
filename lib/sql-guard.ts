/**
 * Guarda central de identificadores e statements SQL.
 *
 * Regra de ouro: NENHUM identificador vindo de request/modelo entra em SQL por
 * interpolação sem passar por aqui. Zod valida tipo; este módulo valida conteúdo.
 */

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

/** Valida um identificador simples (coluna, tabela sem schema). */
export function isSafeIdent(name: string): boolean {
  return IDENT_RE.test(name);
}

/**
 * Valida e cita um identificador possivelmente qualificado (`schema.tabela`).
 * Retorna a forma citada (`"schema"."tabela"`) segura para interpolar.
 * Lança erro descritivo se qualquer parte for inválida.
 */
export function safeIdent(name: string): string {
  const parts = String(name).split('.');
  if (parts.length > 2) throw new Error(`Identificador inválido: ${name}`);
  for (const p of parts) {
    if (!IDENT_RE.test(p)) {
      throw new Error(`Identificador SQL inválido ou perigoso: "${name}"`);
    }
  }
  return parts.map((p) => `"${p}"`).join('.');
}

/** Valida uma coluna simples (sem qualificação) e a retorna citada. */
export function safeColumn(name: string): string {
  if (!IDENT_RE.test(String(name))) {
    throw new Error(`Nome de coluna inválido: "${name}"`);
  }
  return `"${name}"`;
}

/** Normaliza direção de ordenação para ASC/DESC. */
export function safeOrderDir(dir: unknown): 'ASC' | 'DESC' {
  return String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
}

export type WriteOperation = 'INSERT' | 'UPDATE' | 'DELETE';

export interface WriteAnalysis {
  operation: WriteOperation;
  hasWhere: boolean;
  statement: string;
  /** Tabela-alvo normalizada da mutação ("tabela" ou "schema.tabela", sem aspas). */
  table: string;
  /** Última cláusula WHERE do statement (sem RETURNING), ou null se ausente. */
  whereClause: string | null;
}

// ── Allowlist de tabelas mutáveis ─────────────────────────────────────────────
// O agente só escreve em tabelas de conteúdo do catálogo. Tabelas de negócio
// sensível (reservas, pagamentos, usuários, mensagens) são bloqueadas
// explicitamente; qualquer tabela fora das duas listas exige revisão humana.
const BLOCKED_TABLES = new Set([
  'reservations',
  'reservations_backup',
  'reservation_deposits',
  'deposit_rules',
  'deposit_billing_config',
  'stripe_webhook_events',
  'favorites',
  'messages',
  'event',
  'wp_user_phones',
  'sales_representatives',
  'n8n_chat_histories',
]);

const ALLOWED_TABLES = new Set([
  'db_restaurants',
  'opening_hours',
  'restaurant_category_map',
  'restaurant_categories',
  'establishment_type_map',
  'establishment_types',
  'restaurant_awards',
  'restaurant_michelin',
  'restaurant_about_hours',
  'restaurant_price_range',
  'cities',
  'countries',
  'contacts_pro',
  'rest_contacts',
  'restaurant_field_verifications',
  'quality_snapshots',
  'agent_audit_log',
  'update_events',
]);

// Identificador simples ou entre aspas duplas (preserva caixa quando citado).
const TABLE_IDENT = `(?:"[^"]+"|[a-zA-Z_][a-zA-Z0-9_$]*)`;

function unquotePart(part: string): string {
  const p = part.trim();
  return p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase();
}

/** Extrai a tabela-alvo de um INSERT/UPDATE/DELETE já validado. */
function extractTargetTable(statement: string, operation: WriteOperation): string {
  const prefix =
    operation === 'INSERT' ? String.raw`insert\s+into\s+`
    : operation === 'UPDATE' ? String.raw`update\s+(?:only\s+)?`
    : String.raw`delete\s+from\s+(?:only\s+)?`;
  const m = new RegExp(
    `^${prefix}(${TABLE_IDENT})(?:\\s*\\.\\s*(${TABLE_IDENT}))?`,
    'i'
  ).exec(statement);
  if (!m) {
    throw new Error(
      `Não foi possível identificar a tabela-alvo da mutação (${operation}). Bloqueado por precaução.`
    );
  }
  return m[2] ? `${unquotePart(m[1])}.${unquotePart(m[2])}` : unquotePart(m[1]);
}

/**
 * Aplica a allowlist de tabelas mutáveis a uma tabela ("tabela" ou
 * "schema.tabela", sem aspas). Lança erro descritivo se bloqueada/desconhecida.
 */
export function assertMutableTable(table: string): void {
  const parts = table.split('.');
  const schema = parts.length === 2 ? parts[0].toLowerCase() : 'public';
  const name = (parts.length === 2 ? parts[1] : parts[0]).toLowerCase();
  if (schema === 'nextauth') {
    throw new Error(
      `Mutação bloqueada: tabelas do schema nextauth (autenticação) nunca podem ser alteradas pelo agente ("${table}").`
    );
  }
  if (BLOCKED_TABLES.has(name) || name.startsWith('aria_')) {
    throw new Error(
      `Mutação bloqueada: "${table}" é tabela de negócio protegida (reservas/pagamentos/usuários/mensagens). O agente não pode escrever nela.`
    );
  }
  if (schema !== 'public' || !ALLOWED_TABLES.has(name)) {
    throw new Error(
      `Mutação bloqueada: "${table}" não está na allowlist de tabelas mutáveis. Solicite revisão humana antes de escrever nesta tabela.`
    );
  }
}

// WHERE tautológico (true, 1=1, '1'='1') não filtra nada — vale como sem WHERE.
const TAUTOLOGY_RE = /^[\s(]*(?:true|1\s*=\s*1|'1'\s*=\s*'1')[\s)]*$/i;

/** Extrai a última cláusula WHERE do statement (sem RETURNING), ou null. */
function extractWhereClause(statement: string): string | null {
  const matches = [...statement.matchAll(/\bwhere\b/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  return statement
    .slice((last.index ?? 0) + last[0].length)
    .replace(/\breturning\b[\s\S]*$/i, '')
    .trim();
}

const DDL_OR_DANGEROUS =
  /\b(drop|alter|create|truncate|grant|revoke|comment|copy|vacuum|reindex|call|do|merge|lock|set\s+role|reset|security|owner)\b/i;

/**
 * Analisa um statement de escrita vindo do modelo/cliente.
 * Garante: statement único, operação declarada bate com o SQL real,
 * nada de DDL escondido, e UPDATE/DELETE exigem WHERE.
 */
export function analyzeWriteSql(
  sql: string,
  declaredOperation?: string,
  opts: { allowMissingWhere?: boolean } = {}
): WriteAnalysis {
  const statement = sql.trim().replace(/;+\s*$/, '');
  if (/;/.test(statement)) {
    throw new Error('Múltiplos statements não são permitidos em uma mutação.');
  }
  const head = statement.slice(0, 10).toLowerCase();
  let operation: WriteOperation;
  if (head.startsWith('insert')) operation = 'INSERT';
  else if (head.startsWith('update')) operation = 'UPDATE';
  else if (head.startsWith('delete')) operation = 'DELETE';
  else {
    throw new Error(
      'Mutação aceita apenas INSERT/UPDATE/DELETE. DDL (CREATE/ALTER/DROP) deve passar por migration versionada.'
    );
  }
  if (DDL_OR_DANGEROUS.test(statement)) {
    throw new Error(
      `Mutação bloqueada: palavra-chave DDL/perigosa detectada. Use migrations para mudanças de schema.`
    );
  }
  if (declaredOperation && declaredOperation.toUpperCase() !== operation) {
    throw new Error(
      `Operação declarada (${declaredOperation}) não corresponde ao SQL (${operation}). Bloqueado.`
    );
  }
  const table = extractTargetTable(statement, operation);
  assertMutableTable(table);
  const whereClause = extractWhereClause(statement);
  const hasWhere = whereClause !== null && !TAUTOLOGY_RE.test(whereClause);
  if ((operation === 'UPDATE' || operation === 'DELETE') && !hasWhere && !opts.allowMissingWhere) {
    throw new Error(
      `${operation} sem WHERE afetaria a tabela inteira. Adicione WHERE ou confirme explicitamente com allow_full_table=true.`
    );
  }
  return { operation, hasWhere, statement, table, whereClause };
}
