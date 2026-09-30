#!/usr/bin/env node
'use strict';
/**
 * Zelador de Privilégios — o vigia determinístico da credencial de banco.
 *
 * POR QUE EXISTE
 * A auditoria de 2026-09-21 encontrou três agentes (DBA, Atlas, Quill) escrevendo no
 * Cloud SQL como `postgres`, e dois papéis de menor privilégio escritos e nunca criados.
 * Nada acusava: cada README prometia uma coisa, o servidor concedia outra, e a
 * distância entre os dois só apareceu lendo `pg_class.relacl` à mão. Este script faz
 * essa leitura todo dia e vira achado no formato do relato (ADR-012) quando a realidade
 * diverge do desenho.
 *
 * O QUE CHECA (zero LLM, zero escrita, credencial twk_ro)
 *   1. nenhum agente configurado localmente com usuário `postgres` (lê o USUÁRIO das URLs
 *      nos .env conhecidos — nunca a senha, nunca imprime a URL);
 *   2. papéis esperados existem;
 *   3. atributos perigosos (SUPERUSER / CREATEROLE / CREATEDB / BYPASSRLS) em papel de agente;
 *   4. papéis de leitura com `default_transaction_read_only=on` imposto na sessão;
 *   5. nenhum papel de agente com DML em `reservations` ou em `nextauth` (relacl), exceto
 *      `twk_dba` em `public` (ADR-013);
 *   6. tabelas do Atlas dentro do `twk_auth` (migration no banco errado).
 *
 *   node verificar.js            → relatório humano; sai com 1 se houver achado crítico
 *   node verificar.js --relato   → grava state/relato-<data>.json (contrato relato v1, agente "dba")
 *   TWK_RO_ENV=<caminho>         → .env.readonly.local alternativo (padrão: o do DBA)
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const hoje = () => new Date().toISOString().slice(0, 10);

// ── quem usa qual credencial, localmente (só o usuário da URL, nunca a senha) ──
const ENVS = [
  // O DBA (app, scripts e executor) usa twk_dba via ~/.twk/dba.env (ADR-017). O .env.local só
  // é fallback — mas se ainda tiver postgres, é a chave-mestra a um "TWK_DBA_ENV=off" de distância.
  { agente: 'dba (fallback .env.local)', arquivo: 'Agente Gerenciador do Banco de Dados/twk-db-agent/.env.local', chave: 'DATABASE_URL', esperado: 'twk_dba' },
  { agente: 'atlas (serviço)', arquivo: 'Agente Financeiro/.env', chave: 'DATABASE_URL', esperado: 'atlas_service' },
  { agente: 'atlas (agente RO)', arquivo: 'Agente Financeiro/.env', chave: 'DATABASE_URL_READONLY', esperado: 'atlas_agent_ro' },
  { agente: 'quill (write-back TWK)', arquivo: 'Agente Editorial/.env', chave: 'TWK_DATABASE_URL', esperado: 'quill_writer' },
  { agente: 'clavis (RO)', arquivo: 'Agente Comercial/.env', chave: 'DB_READONLY_URL', esperado: 'clavis_ro' },
  { agente: 'clavis (RW)', arquivo: 'Agente Comercial/.env', chave: 'DB_WRITE_URL', esperado: null },
];

function usuarioDaUrl(arquivo, chave) {
  try {
    const linha = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8').split(/\r?\n/).find((l) => l.startsWith(chave + '='));
    if (!linha) return { estado: 'ausente' };
    const v = linha.slice(chave.length + 1).trim().replace(/^["']|["']$/g, '');
    if (!v) return { estado: 'vazio' };
    return { estado: 'ok', usuario: new URL(v).username || '(sem usuário)' };
  } catch { return { estado: 'ilegível' }; }
}

// ── o que o desenho promete ─────────────────────────────────────────────────
// ADR-017: um papel de escrita para a operação (twk_dba). twk_db_agent (desenho antigo do app do
// DBA) deixou de ser esperado — o app passou a usar twk_dba. quill_writer e atlas_service seguem.
const PAPEIS_ESPERADOS = ['twk_ro', 'twk_dba', 'atlas_agent_ro', 'clavis_ro', 'quill_writer', 'atlas_service'];
const PAPEIS_DE_AGENTE = ['twk_ro', 'twk_dba', 'atlas_agent_ro', 'clavis_ro', 'clavis_rw', 'twk_db_agent', 'quill_writer', 'atlas_service'];
const SOMENTE_LEITURA = ['twk_ro', 'atlas_agent_ro', 'clavis_ro'];
const TABELAS_ATLAS = ['audit_log', 'fx_rates', 'ledger_entries', 'stripe_balance_transactions', 'stripe_charges', 'stripe_customers',
  'stripe_disputes', 'stripe_events', 'stripe_invoices', 'stripe_payouts', 'stripe_refunds', 'stripe_subscription_items', 'stripe_subscriptions', 'sync_outbox'];

function urlRo() {
  const f = process.env.TWK_RO_ENV || path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  const l = fs.readFileSync(f, 'utf8').split(/\r?\n/).find((x) => x.startsWith('DATABASE_URL_RO='));
  if (!l) throw new Error('DATABASE_URL_RO ausente em ' + f);
  return l.slice('DATABASE_URL_RO='.length).trim().replace(/^["']|["']$/g, '');
}

async function main() {
  const achados = [];
  const achado = (severidade, titulo, evidencia, acao_proposta, chave) =>
    achados.push({ chave: `zelador.${chave}`, severidade, titulo, evidencia, fonte: 'zelador-privilegios', acao_proposta, autonomia: 'requer_aprovacao_humana', dono: 'fundador' });

  // 1. credenciais locais
  for (const e of ENVS) {
    const u = usuarioDaUrl(e.arquivo, e.chave);
    if (u.estado !== 'ok') continue; // ausente/vazio = agente sem essa credencial aqui; não é achado deste vigia
    if (u.usuario === 'postgres') achado('critica', `${e.agente} conecta como postgres`, `${e.arquivo} · ${e.chave} · usuário=postgres`, `criar/usar ${e.esperado || 'papel de menor privilégio'} e trocar a URL`, `postgres.${e.chave}.${e.agente.split(' ')[0]}`);
    else if (e.esperado && u.usuario !== e.esperado) achado('media', `${e.agente} não usa o papel desenhado`, `usuário=${u.usuario}, desenho=${e.esperado}`, `apontar ${e.chave} para ${e.esperado}`, `papel_divergente.${e.chave}`);
  }

  // 2–6. servidor
  const { Client } = (() => { for (const p of [["Agente Gerenciador do Banco de Dados","twk-db-agent","node_modules","pg"],["Agente de Suporte e Concierge","node_modules","pg"],["Agente Comercial","service","node_modules","pg"],["orchestrator","command-center","node_modules","pg"]]) { try { return require(path.join(RAIZ, ...p)); } catch {} } throw new Error("biblioteca pg não encontrada em nenhum agente — rode npm install na Aria"); })();
  const c = new Client({ connectionString: urlRo(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ro = await c.query('show default_transaction_read_only');
  if (String(ro.rows[0].default_transaction_read_only) !== 'on') { await c.end(); throw new Error('a sessão do zelador NÃO é read-only — abortado (a credencial não é twk_ro?)'); }

  const roles = (await c.query(`SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls FROM pg_roles WHERE rolname = ANY($1)`, [PAPEIS_DE_AGENTE])).rows;
  const existentes = new Set(roles.map((r) => r.rolname));
  for (const p of PAPEIS_ESPERADOS) if (!existentes.has(p)) achado(p === 'quill_writer' || p === 'atlas_service' ? 'alta' : 'critica', `papel ${p} não existe`, 'ausente em pg_roles', `runbook docs/runbooks/privilegios-minimos-2026-09-21.md`, `papel_ausente.${p}`);
  for (const r of roles) {
    const perigosos = ['rolsuper', 'rolcreaterole', 'rolcreatedb', 'rolbypassrls'].filter((k) => r[k]);
    if (perigosos.length) achado('alta', `papel ${r.rolname} com atributo perigoso`, perigosos.join(', '), `ALTER ROLE ${r.rolname} NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS`, `atributo.${r.rolname}`);
  }

  const cfg = (await c.query(`SELECT r.rolname, s.setconfig FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = ANY($1)`, [SOMENTE_LEITURA])).rows;
  for (const p of SOMENTE_LEITURA) {
    if (!existentes.has(p)) continue;
    const s = cfg.find((x) => x.rolname === p);
    if (!s || !(s.setconfig || []).some((v) => /default_transaction_read_only=on/.test(v))) achado('alta', `papel de leitura ${p} sem read-only imposto`, 'pg_db_role_setting sem default_transaction_read_only=on', `ALTER ROLE ${p} SET default_transaction_read_only = on`, `readonly.${p}`);
  }

  const dml = (await c.query(`
    SELECT n.nspname AS schema, c.relname AS tabela, a.grantee::regrole::text AS papel, string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, LATERAL aclexplode(c.relacl) a
     WHERE c.relkind = 'r' AND a.privilege_type IN ('INSERT','UPDATE','DELETE')
       AND a.grantee::regrole::text = ANY($1)
       AND (n.nspname = 'nextauth' OR c.relname = 'reservations')
     GROUP BY 1,2,3`, [PAPEIS_DE_AGENTE])).rows;
  for (const d of dml) {
    if (d.papel === 'twk_dba' && d.schema === 'public') continue; // ADR-013: twk_dba escreve em public
    achado('critica', `papel ${d.papel} escreve em ${d.schema}.${d.tabela}`, `privilégios: ${d.privs}`, `REVOKE INSERT, UPDATE, DELETE ON ${d.schema}.${d.tabela} FROM ${d.papel}`, `dml.${d.papel}.${d.tabela}`);
  }

  const atlas = (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`, [TABELAS_ATLAS])).rows;
  if (atlas.length) achado('media', `${atlas.length} tabela(s) do Atlas dentro do twk_auth`, atlas.map((t) => t.table_name).join(', '), 'DROP após confirmar 0 linhas (runbook privilegios-minimos)', 'atlas_no_twk_auth');
  await c.end();

  // ── saída ──
  const criticos = achados.filter((a) => a.severidade === 'critica').length;
  console.log(`\nZelador de Privilégios · ${hoje()} · ${achados.length} achado(s), ${criticos} crítico(s)`);
  for (const a of achados) console.log(`  [${a.severidade}] ${a.titulo} — ${a.evidencia}\n      → ${a.acao_proposta}`);
  if (!achados.length) console.log('  realidade do servidor bate com o desenho.');

  if (process.argv.includes('--relato')) {
    fs.mkdirSync(STATE, { recursive: true });
    const relato = {
      agente: 'dba', ts: new Date().toISOString(), trace_id: `trc-zelador-${hoje().replace(/-/g, '')}`,
      status: 'ok', kpis: { achados: achados.length, criticos },
      achados,
      cobertura: { fontes: ['pg_roles', 'pg_db_role_setting', 'pg_class.relacl', ...ENVS.map((e) => e.arquivo)], lacunas: ['credenciais em produção (Easypanel) não são visíveis daqui'] },
    };
    const f = path.join(STATE, `relato-${hoje()}.json`);
    fs.writeFileSync(f, JSON.stringify(relato, null, 1), 'utf8');
    console.log(`\nrelato: ${path.relative(RAIZ, f)}`);
  }
  process.exit(criticos ? 1 : 0);
}

main().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });
