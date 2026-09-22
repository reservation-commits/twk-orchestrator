#!/usr/bin/env node
'use strict';
/**
 * Desfazer — o botão de undo do executor de escrita (ADR-017, proposto em 2026-09-21).
 *
 * POR QUE EXISTE
 * O executor tira backup ANTES de apagar/alterar, mas não tinha como restaurar. Sem
 * restauração, "reversível" era promessa; com ela, apagar contato ou corrigir dado vira
 * ação que um agente pode tomar sozinho — porque o erro custa um comando, não um dia.
 *
 * O QUE FAZ
 *   Lê a pasta de backup gerada por executar.js (~/.twk/backups/<data>-<nome>/), que tem
 *   um <schema.tabela>.json por tabela (as linhas como estavam ANTES) e um _meta.json com
 *   a chave primária de cada tabela. Para cada tabela, faz UPSERT das linhas antigas pela
 *   chave primária:
 *     - linha apagada → volta (INSERT);
 *     - linha alterada → valores antigos voltam (UPDATE via ON CONFLICT).
 *   Tabela sem chave primária → recusa (não há como garantir que restaura a linha certa).
 *
 *   node desfazer.js --ultimo                       → dry-run do backup mais recente
 *   node desfazer.js --backup <pasta>               → dry-run de um backup específico
 *   … --apply --motivo "<por que>"                  → restaura, com auditoria
 *
 * Usa o MESMO papel twk_dba (~/.twk/dba.env). Não faz DDL, não toca nextauth.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const TWK_DIR = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const hoje = () => new Date().toISOString().slice(0, 10);
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-dba-desfazer', agente: 'dba-escrita', ...o }) + '\n'); } catch {} };

const IDENT = /^[a-z_][a-z0-9_]*$/i;

/** Aspas duplas para identificador (tabela/coluna) — recusa o que não é identificador simples. */
function q(ident) {
  if (!IDENT.test(ident)) throw new Error(`identificador inválido: ${ident}`);
  return `"${ident}"`;
}

/**
 * Monta o UPSERT que restaura `linhas` em `schema.tabela` pela chave `pk`.
 * PURA (sem I/O) — coberta pelo eval. Devolve { sql, params }.
 *   INSERT INTO s.t (c1,c2,…) SELECT c1,c2,… FROM json_populate_recordset(NULL::s.t, $1)
 *   ON CONFLICT (pk) DO UPDATE SET c2 = EXCLUDED.c2, … (todas as colunas menos a pk)
 */
function montarUpsert(schema, tabela, pk, linhas) {
  if (!Array.isArray(linhas) || linhas.length === 0) throw new Error('sem linhas para restaurar');
  const colunas = Object.keys(linhas[0]);
  if (!colunas.includes(pk)) throw new Error(`chave primária ${pk} não está nas colunas do backup`);
  for (const l of linhas) {
    const k = Object.keys(l);
    if (k.length !== colunas.length || k.some((c) => !colunas.includes(c))) throw new Error('linhas do backup com colunas diferentes entre si');
  }
  const alvo = `${q(schema)}.${q(tabela)}`;
  const lista = colunas.map(q).join(', ');
  const semPk = colunas.filter((c) => c !== pk);
  const set = semPk.length ? ` DO UPDATE SET ${semPk.map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ')}` : ' DO NOTHING';
  const sql = `INSERT INTO ${alvo} (${lista}) SELECT ${lista} FROM json_populate_recordset(NULL::${alvo}, $1) ON CONFLICT (${q(pk)})${set}`;
  return { sql, params: [JSON.stringify(linhas)] };
}

function lerBackup(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, '_meta.json'), 'utf8'));
  const tabelas = [];
  for (const t of meta.tabelas) {
    const f = path.join(dir, t.arquivo);
    const linhas = JSON.parse(fs.readFileSync(f, 'utf8'));
    tabelas.push({ ...t, linhas });
  }
  return { meta, tabelas };
}

function backupMaisRecente() {
  const base = path.join(TWK_DIR, 'backups');
  const dirs = fs.readdirSync(base).filter((d) => fs.existsSync(path.join(base, d, '_meta.json'))).sort();
  if (!dirs.length) throw new Error('nenhum backup com _meta.json em ' + base + ' (backups anteriores a 2026-09-21 não têm metadados de chave — restaurar à mão)');
  return path.join(base, dirs[dirs.length - 1]);
}

async function main() {
  const a = process.argv.slice(2);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : null; };
  const apply = a.includes('--apply');
  const motivo = val('--motivo');
  const dir = a.includes('--ultimo') ? backupMaisRecente() : val('--backup');
  if (!dir) { console.error('uso: node desfazer.js (--ultimo | --backup <pasta>) [--apply --motivo "<por que>"]'); process.exit(2); }
  if (apply && (!motivo || motivo.length < 5)) { console.error('--apply exige --motivo'); process.exit(2); }

  const { meta, tabelas } = lerBackup(dir);
  console.log(`backup: ${dir}`);
  console.log(`origem: ${meta.arquivo} (sha256 ${meta.sha256}) · executado em ${meta.executado_em} · aprovação: ${meta.aprovacao_ref}`);
  const planos = [];
  for (const t of tabelas) {
    if (!t.pk) { console.log(`  ${t.tabela}: SEM chave primária — não restaurável automaticamente (${t.linhas.length} linha(s) no backup)`); continue; }
    if (!t.linhas.length) { console.log(`  ${t.tabela}: backup vazio — nada a restaurar`); continue; }
    const [schema, tabela] = t.tabela.split('.');
    planos.push({ ...t, schema, tabela, upsert: montarUpsert(schema, tabela, t.pk, t.linhas) });
    console.log(`  ${t.tabela}: ${t.linhas.length} linha(s) → upsert por ${t.pk}`);
  }
  if (!planos.length) { console.log('nada restaurável.'); return; }
  if (!apply) { console.log('\nDRY-RUN — nada foi restaurado. Use --apply --motivo "…".'); return; }

  let url = null;
  try { for (const l of fs.readFileSync(path.join(TWK_DIR, 'dba.env'), 'utf8').split(/[\r\n]+/)) { const m = l.match(/^TWK_DBA_URL=(.+)$/); if (m) url = m[1].trim(); } } catch {}
  if (!url) { console.error('credencial twk_dba ausente em ~/.twk/dba.env'); process.exit(3); }

  const { Client } = require(path.join(RAIZ, 'Agente Comercial', 'service', 'node_modules', 'pg'));
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const feitos = [];
  try {
    await c.query('BEGIN');
    for (const p of planos) {
      const r = await c.query(p.upsert.sql, p.upsert.params);
      feitos.push(`${p.tabela}:${r.rowCount}`);
    }
    await c.query('COMMIT');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch {}
    audit({ evento: 'desfazer_falhou', backup: dir, erro: e.message });
    throw e;
  } finally { await c.end(); }

  console.log(`\nRESTAURADO: ${feitos.join(' ')}`);
  audit({ evento: 'sql_desfeito', backup: dir, origem_sha256: meta.sha256, motivo, restaurado: feitos, papel: 'twk_dba' });
}

module.exports = { montarUpsert, lerBackup };
if (require.main === module) main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
