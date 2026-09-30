#!/usr/bin/env node
'use strict';
/**
 * Executor de escrita do DBA — a ÚNICA porta de escrita em produção (ADR-013).
 *
 *   node executar.js --sql <arquivo.sql>                          → DRY-RUN: valida tudo, não conecta
 *   node executar.js --sql <arquivo.sql> --apply --aprovacao "…"  → executa, com backup e auditoria
 *   node executar.js --sql <arquivo.sql> --apply --autonomo       → ADR-017: sem frase por execução, SÓ se
 *        TWK_AUTONOMIA_ESCRITA=on em ~/.twk/dba.env, o arquivo for reversível (todo DELETE/UPDATE com
 *        backup declarado, nada de nextauth) e cada tabela tiver ≤ TWK_AUTONOMIA_MAX_LINHAS (200)
 *   node desfazer.js --ultimo --apply --motivo "…"                 → restaura o último backup (undo)
 *
 * Camadas (cada uma independe das outras — falhar alto):
 *   1. servidor: o papel twk_dba não tem DDL, TRUNCATE, GRANT nem escrita em nextauth;
 *   2. hooks (.claude/hooks/guard-sql.ps1): DROP/TRUNCATE e DELETE/UPDATE sem WHERE nunca passam;
 *   3. este executor: aprovação do fundador obrigatória e gravada · palavras estruturais recusadas ·
 *      DELETE/UPDATE têm de vir com WHERE · DELETE exige backup declarado e executado ANTES ·
 *      transação obrigatória (begin/commit no arquivo) · auditoria em orchestrator/logs/.
 *
 * Contrato do arquivo .sql:
 *   - linhas `-- backup: <schema.tabela> where <condição>` no topo, uma por tabela que perde linhas;
 *   - corpo entre `begin;` e `commit;` (asserts de contagem via DO $$ são bem-vindos);
 *   - backups caem em %USERPROFILE%\.twk\backups\<data>-<nome>\ (fora do OneDrive — podem ter PII).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const TWK_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');

const a = process.argv.slice(2);
const val = (n) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : null; };
const arquivo = val('--sql');
const apply = a.includes('--apply');
const aprovacao = val('--aprovacao');
const autonomo = a.includes('--autonomo');
const hoje = () => new Date().toISOString().slice(0, 10);

const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-dba-escrita', agente: 'dba-escrita', ...o }) + '\n'); } catch {} };
const falha = (msg, extra = {}) => { console.error('BLOQUEADO:', msg); audit({ evento: 'escrita_bloqueada', motivo: msg, arquivo, ...extra }); process.exit(3); };

/** Erro de validação: `validar()` LANÇA em vez de encerrar o processo, para ser testável no eval (ADR-011). */
class Bloqueio extends Error {}

function semComentarios(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function validar(sqlBruto) {
  const sql = semComentarios(sqlBruto);
  const bloqueia = (msg) => { throw new Bloqueio(msg); };

  // 3a. estrutura é do dono, nunca deste executor (o servidor também recusa — dupla camada)
  const proibida = sql.match(/\b(drop|truncate|alter|create|grant|revoke|vacuum|reindex|copy|security|owner)\b/i);
  if (proibida) bloqueia(`palavra estrutural "${proibida[1]}" — mudança de estrutura/privilégio é runbook humano, não executor`);

  // 3b. transação obrigatória
  const corpo = sql.trim();
  if (!/^begin\b/i.test(corpo) || !/\bcommit\s*;?\s*$/i.test(corpo)) bloqueia('o corpo precisa começar com "begin;" e terminar com "commit;" — escrita fora de transação não passa');

  // 3c. todo DELETE/UPDATE com WHERE na mesma sentença
  for (const m of sql.matchAll(/\bdelete\s+from\b([^;]*);/gi)) if (!/\bwhere\b/i.test(m[1])) bloqueia(`DELETE sem WHERE: "${m[0].slice(0, 60)}…"`);
  for (const m of sql.matchAll(/\bupdate\s+[\w."]+\s+set\b([^;]*);/gi)) if (!/\bwhere\b/i.test(m[1])) bloqueia(`UPDATE sem WHERE: "${m[0].slice(0, 60)}…"`);
  if (/\bwhere\s+(true|1\s*=\s*1)\b/i.test(sql)) bloqueia('WHERE tautológico (true / 1=1) — equivale a operação sem WHERE');

  // 3d. DELETE exige backup declarado no cabeçalho
  const backups = [...sqlBruto.matchAll(/^--\s*backup:\s*([\w."]+)\s+where\s+(.+)$/gim)].map((m) => ({ tabela: m[1], cond: m[2].trim() }));
  if (/\bdelete\s+from\b/i.test(sql) && backups.length === 0) bloqueia('há DELETE mas nenhuma linha "-- backup: <tabela> where <condição>" no cabeçalho');
  for (const b of backups) if (!/^[\w]+\.[\w"]+$/.test(b.tabela)) bloqueia(`tabela de backup mal formada: ${b.tabela}`);
  return backups;
}

/**
 * Reversibilidade (ADR-017): um arquivo só pode rodar em modo AUTÔNOMO se TODA tabela que
 * ele apaga ou altera tiver backup declarado — assim `desfazer.js` consegue voltar tudo.
 * Também recusa qualquer menção a `nextauth` (contas de cliente: sempre humano).
 * PURA; coberta pelo eval. Devolve { reversivel, motivo, tabelasSemBackup }.
 */
function verificarReversibilidade(sqlBruto) {
  const sql = semComentarios(sqlBruto);
  if (/\bnextauth\b/i.test(sql)) return { reversivel: false, motivo: 'toca nextauth (contas de cliente) — sempre humano', tabelasSemBackup: [] };
  const backups = new Set([...sqlBruto.matchAll(/^--\s*backup:\s*([\w."]+)\s+where\s+/gim)].map((m) => m[1].toLowerCase().replace(/"/g, '')));
  const alvos = new Set();
  for (const m of sql.matchAll(/\bdelete\s+from\s+([\w."]+)/gi)) alvos.add(m[1].toLowerCase().replace(/"/g, ''));
  for (const m of sql.matchAll(/\bupdate\s+([\w."]+)\s+set\b/gi)) alvos.add(m[1].toLowerCase().replace(/"/g, ''));
  const norm = (t) => (t.includes('.') ? t : `public.${t}`);
  const semBackup = [...alvos].map(norm).filter((t) => !backups.has(t) && !backups.has(t.replace(/^public\./, '')));
  if (semBackup.length) return { reversivel: false, motivo: `sem backup declarado para: ${semBackup.join(', ')}`, tabelasSemBackup: semBackup };
  return { reversivel: true, motivo: alvos.size ? 'toda tabela alterada/apagada tem backup' : 'só INSERT — nada a reverter', tabelasSemBackup: [] };
}

async function main() {
  if (!arquivo) { console.error('uso: node executar.js --sql <arquivo> [--apply --aprovacao "<frase do fundador>"]'); process.exit(2); }
  const sqlBruto = fs.readFileSync(arquivo, 'utf8');
  const hash = crypto.createHash('sha256').update(sqlBruto).digest('hex').slice(0, 16);
  let backups;
  try { backups = validar(sqlBruto); }
  catch (e) { if (e instanceof Bloqueio) falha(e.message); throw e; }

  console.log(`arquivo: ${arquivo}`);
  console.log(`sha256:  ${hash}`);
  console.log(`backups declarados: ${backups.length ? backups.map((b) => b.tabela).join(', ') : '(nenhum — sem DELETE)'}`);

  const rev = verificarReversibilidade(sqlBruto);
  console.log(`reversível: ${rev.reversivel ? 'sim' : 'NÃO'} — ${rev.motivo}`);

  if (!apply) { console.log('\nDRY-RUN — validações passaram; nada foi executado. Use --apply --aprovacao "<frase>" (ou --autonomo, se TWK_AUTONOMIA_ESCRITA=on).'); return; }

  // credencial de escrita: fora do OneDrive, só existe se o fundador criou o papel
  let url = null; const envDba = {};
  try { for (const l of fs.readFileSync(path.join(TWK_DIR, 'dba.env'), 'utf8').split(/[\r\n]+/)) { const m = l.match(/^([A-Z0-9_]+)=(.+)$/); if (m) envDba[m[1]] = m[2].trim(); } } catch {}
  url = envDba.TWK_DBA_URL || null;
  if (!url || url.includes('__SENHA')) falha('credencial twk_dba ausente em ~/.twk/dba.env — o papel já foi criado no banco?');

  // MODO AUTÔNOMO (ADR-017): sem frase do fundador por execução. Só existe se ele ligou o
  // interruptor UMA vez (TWK_AUTONOMIA_ESCRITA=on em ~/.twk/dba.env — fora do OneDrive), e só
  // para arquivos REVERSÍVEIS (todo DELETE/UPDATE com backup; nada de nextauth) e pequenos
  // (teto de linhas por tabela, TWK_AUTONOMIA_MAX_LINHAS, padrão 200). Tudo o mais continua
  // exigindo --aprovacao. O interruptor é a aprovação; o backup é o desfazer.
  let aprovacaoRef = aprovacao;
  if (autonomo) {
    if (String(envDba.TWK_AUTONOMIA_ESCRITA || '').toLowerCase() !== 'on') falha('--autonomo exige TWK_AUTONOMIA_ESCRITA=on em ~/.twk/dba.env (aprovação única do fundador, ADR-017)');
    if (!rev.reversivel) falha(`--autonomo só para escrita reversível: ${rev.motivo}`);
    aprovacaoRef = `AUTONOMO (TWK_AUTONOMIA_ESCRITA=on · ADR-017 · reversível · teto ${envDba.TWK_AUTONOMIA_MAX_LINHAS || 200} linhas)`;
  } else if (!aprovacao || aprovacao.length < 10) falha('--apply exige --aprovacao com a frase/registro do fundador (mín. 10 caracteres) — ou --autonomo para escrita reversível');
  const tetoAutonomo = Number(envDba.TWK_AUTONOMIA_MAX_LINHAS || 200);

  // A biblioteca pg vem de qualquer agente que a tenha instalada (a do CLAVIS sumiu na limpeza de 24/09;
  // a porta ficou muda até 30/09 — mesmo resolvedor da Sentinela).
  const { Client } = (() => { for (const p of [['Agente de Suporte e Concierge', 'node_modules', 'pg'], ['Agente Gerenciador do Banco de Dados', 'twk-db-agent', 'node_modules', 'pg'], ['Agente Comercial', 'service', 'node_modules', 'pg'], ['orchestrator', 'command-center', 'node_modules', 'pg']]) { try { return require(path.join(RAIZ, ...p)); } catch {} } throw new Error('biblioteca pg não encontrada em nenhum agente — rode npm install na Aria'); })();
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // backup ANTES de qualquer escrita — para ~/.twk/backups (fora do OneDrive; pode conter PII)
  // Grava também _meta.json (chave primária por tabela, origem, aprovação) para que
  // desfazer.js consiga restaurar sem adivinhar nada.
  let dirBackup = null;
  if (backups.length) {
    dirBackup = path.join(TWK_DIR, 'backups', `${hoje()}-${path.basename(arquivo, '.sql')}-${hash.slice(0, 6)}`);
    fs.mkdirSync(dirBackup, { recursive: true });
    const metaTabelas = [];
    for (const b of backups) {
      const [schema, tabela] = b.tabela.replace(/"/g, '').split('.');
      const pkr = await c.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`, [schema, tabela]);
      const pk = pkr.rowCount === 1 ? pkr.rows[0].column_name : null; // chave composta → não restaurável automaticamente
      const r = await c.query(`select * from ${b.tabela} where ${b.cond}`);
      if (autonomo && r.rowCount > tetoAutonomo) { await c.end(); falha(`--autonomo: ${b.tabela} teria ${r.rowCount} linha(s) afetadas, acima do teto ${tetoAutonomo} — peça aprovação explícita`); }
      const arquivoJson = b.tabela.replace(/[^\w.]/g, '') + '.json';
      fs.writeFileSync(path.join(dirBackup, arquivoJson), JSON.stringify(r.rows, null, 1));
      metaTabelas.push({ tabela: `${schema}.${tabela}`, arquivo: arquivoJson, pk, cond: b.cond, linhas: r.rowCount });
      console.log(`backup: ${b.tabela} → ${r.rowCount} linha(s)${pk ? ` · pk ${pk}` : ' · SEM pk simples (não restaurável automaticamente)'}`);
      if (r.rowCount === 0) console.log(`  atenção: backup vazio — confirme se a condição está certa antes de confiar no resultado`);
    }
    fs.writeFileSync(path.join(dirBackup, '_meta.json'), JSON.stringify({ arquivo, sha256: hash, executado_em: new Date().toISOString(), aprovacao_ref: aprovacaoRef, modo: autonomo ? 'autonomo' : 'aprovado', tabelas: metaTabelas }, null, 1));
  }

  const res = await c.query(sqlBruto);
  const lista = Array.isArray(res) ? res : [res];
  const afetadas = lista.filter((r) => ['DELETE', 'UPDATE', 'INSERT'].includes(r.command)).map((r) => `${r.command}:${r.rowCount}`);
  for (const r of lista) if (r.command === 'SELECT' && r.rows.length) console.table(r.rows);
  await c.end();

  console.log(`\nEXECUTADO. escritas: ${afetadas.join(' ') || '(nenhuma?)'}${dirBackup ? `\ndesfazer: node orchestrator/agents/dba-escrita/desfazer.js --backup "${dirBackup}" --apply --motivo "…"` : ''}`);
  audit({ evento: 'sql_escrita', arquivo, sha256: hash, aprovacao_ref: aprovacaoRef, modo: autonomo ? 'autonomo' : 'aprovado', reversivel: rev.reversivel, escritas: afetadas, backup_dir: dirBackup, papel: 'twk_dba' });
}
module.exports = { validar, semComentarios, verificarReversibilidade, Bloqueio };

// Só executa quando chamado como CLI; `require()` (eval harness) apenas expõe o validador.
if (require.main === module) {
  main().catch((e) => { audit({ evento: 'escrita_falhou', arquivo, erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
}
