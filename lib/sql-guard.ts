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
  const hasWhere = /\bwhere\b/i.test(statement);
  if ((operation === 'UPDATE' || operation === 'DELETE') && !hasWhere && !opts.allowMissingWhere) {
    throw new Error(
      `${operation} sem WHERE afetaria a tabela inteira. Adicione WHERE ou confirme explicitamente com allow_full_table=true.`
    );
  }
  return { operation, hasWhere, statement };
}
