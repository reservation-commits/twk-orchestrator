'use strict';
/**
 * Eval da Central de Comando (MAESTRO) — o núcleo que coordena, executa SQL via DBA e
 * envia e-mail tinha ZERO testes (auditoria 2026-09-21). Zero LLM, zero rede, zero banco:
 * só os caminhos determinísticos que decidem se algo perigoso passa.
 *
 * Ambiente é limpo ANTES do require: as guardas dependem de env ausente para
 * recusar cedo, e um .env do desenvolvedor não pode transformar o eval em chamada real.
 */
for (const k of ['EMAIL_WEBHOOK_URL', 'EMAIL_WEBHOOK_TOKEN', 'RESEND_API_KEY', 'EMAIL_FROM',
  'AGENT_DBA_URL', 'AGENT_DBA_TOKEN', 'AGENT_DBA_WRITE_TOKEN', 'MAESTRO_DB_WRITE',
  'AGENT_CLAVIS_URL', 'AGENT_ARIA_URL', 'AGENT_QUILL_URL', 'AGENT_ATLAS_URL']) delete process.env[k];

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dbexec = require('../../command-center/dbexec.js');
const email = require('../../command-center/email.js');
const tools = require('../../command-center/tools.js');
const sentinels = require('../../command-center/sentinels.js');

const esperar = (cond, msg) => (cond ? [] : [msg]);
const casos = [];

// ── dbexec: classificação do que o fundador aprova ───────────────────────────
const classe = (sql) => dbexec.classificar(sql);
casos.push(
  { nome: 'dbexec: UPDATE com WHERE é "dados"', run: () => esperar(classe('update db_restaurants set city = $1 where restaurant_id = $2').tipo === 'dados', 'classificou errado') },
  { nome: 'dbexec: UPDATE sem WHERE é destrutivo', run: () => esperar(classe('update db_restaurants set city = null').tipo === 'destrutivo', 'passou como dados') },
  { nome: 'dbexec: DELETE é destrutivo mesmo com WHERE', run: () => esperar(classe('delete from db_restaurants where restaurant_id = 1').tipo === 'destrutivo', 'passou como dados') },
  { nome: 'dbexec: mudar published é destrutivo (tabela de escalonamento)', run: () => esperar(classe('update db_restaurants set published = false where restaurant_id = 1').tipo === 'destrutivo', 'published passou como dados') },
  { nome: 'dbexec: DDL é destrutivo', run: () => esperar(classe('alter table x add column y int').tipo === 'destrutivo', 'DDL passou como dados') },
  { nome: 'dbexec: duas instruções são recusadas', run: () => esperar(!!classe('update x set a=1 where id=1; delete from x').erro, 'multi-statement passou') },
  { nome: 'dbexec: SQL vazio é recusado', run: () => esperar(!!classe('   ').erro, 'vazio passou') },
  { nome: 'dbexec: escrita fica OFF sem feature-flag', run: () => esperar(dbexec.enabled() === false && /off/.test(dbexec.statusLinha()), `enabled=${dbexec.enabled()} status="${dbexec.statusLinha()}"`) },
  { nome: 'dbexec: executar() recusa sem escrita ligada (não chama rede)', run: async () => { const r = await dbexec.executar({ sql: 'update x set a=1 where id=1' }); return esperar(r.ok === false && /desligada/.test(r.detalhe), JSON.stringify(r)); } },
);

// ── email: nunca finge que enviou ────────────────────────────────────────────
casos.push(
  { nome: 'email: sem provedor, enviar() falha alto com instrução', run: async () => { const r = await email.enviar({ para: 'a@b.co', assunto: 'x', html: '<p>x</p>' }); return esperar(r.ok === false && /EMAIL_WEBHOOK_URL|RESEND/.test(r.detalhe), JSON.stringify(r)); } },
  { nome: 'email: destinatário inválido é recusado', run: () => esperar(!email.EMAIL_RE.test('nao-e-email') && !email.EMAIL_RE.test('a@b') && email.EMAIL_RE.test('reservation@theworldkeys.com'), 'EMAIL_RE inconsistente') },
  { nome: 'email: enabled() é falso sem provedor', run: () => esperar(email.enabled() === false && email.provider() === null, 'provedor fantasma') },
);

// ── tools: as ferramentas do modelo são só de leitura ───────────────────────
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-eval-central-'));
const exec = (name, input) => tools.executar(S, { Anthropic: null, model: 'x' }, name, input);
const parse = (r) => { try { return JSON.parse(r.resultado); } catch { return { corpo_texto: r.resultado }; } };
casos.push(
  { nome: 'tools: sql_leitura_dba recusa verbo de escrita antes de qualquer rede', run: async () => { const r = parse(await exec('sql_leitura_dba', { sql: 'delete from reservations where 1=1' })); return esperar(!!r.erro && /escrita|SELECT/i.test(r.erro), JSON.stringify(r)); } },
  { nome: 'tools: sql_leitura_dba recusa UPDATE disfarçado em CTE', run: async () => { const r = parse(await exec('sql_leitura_dba', { sql: 'with x as (update reservations set a=1 returning 1) select * from x' })); return esperar(!!r.erro, JSON.stringify(r)); } },
  { nome: 'tools: sql_leitura_dba recusa duas instruções', run: async () => { const r = parse(await exec('sql_leitura_dba', { sql: 'select 1; select 2' })); return esperar(!!r.erro && /uma instrução/i.test(r.erro), JSON.stringify(r)); } },
  { nome: 'tools: SELECT válido sem URL do DBA falha alto (não inventa dado)', run: async () => { const r = parse(await exec('sql_leitura_dba', { sql: 'select count(*) from db_restaurants' })); return esperar(!!r.erro && /AGENT_DBA_URL/.test(r.erro), JSON.stringify(r)); } },
  { nome: 'tools: consultar_api_agente bloqueia caminho de cron (GET que escreve)', run: async () => { const r = parse(await exec('consultar_api_agente', { agente: 'dba', caminho: '/api/cron/snapshot' })); return esperar(!!r.erro && /bloqueado/i.test(r.erro), JSON.stringify(r)); } },
  { nome: 'tools: consultar_api_agente recusa agente inválido', run: async () => { const r = parse(await exec('consultar_api_agente', { agente: 'hacker', caminho: '/x' })); return esperar(!!r.erro, JSON.stringify(r)); } },
  { nome: 'tools: consultar_api_agente recusa caminho absoluto externo', run: async () => { const r = parse(await exec('consultar_api_agente', { agente: 'dba', caminho: 'https://evil.example/x' })); return esperar(!!r.erro, JSON.stringify(r)); } },
  { nome: 'tools: ferramenta desconhecida vira erro explícito', run: async () => { const r = parse(await exec('apagar_tudo', {})); return esperar(!!r.erro, JSON.stringify(r)); } },
  { nome: 'tools: ler_estado recusa caminho fora da lista (sem path traversal)', run: async () => { const r = await exec('ler_estado', { arquivo: '../../.env' }); return esperar(/inválido/i.test(r.resultado), r.resultado.slice(0, 120)); } },
  { nome: 'tools: ler_estado só aceita missao:<nome>.md com caracteres seguros', run: async () => { const r = await exec('ler_estado', { arquivo: 'missao:../segredo.md' }); return esperar(/inválido/i.test(r.resultado), r.resultado.slice(0, 120)); } },
  { nome: 'tools: nenhuma definição de ferramenta declara escrita', run: () => { const nomes = tools.TOOL_DEFS.map((t) => t.name); const suspeitos = nomes.filter((n) => /escrev|write|mutat|enviar|send|delete|update/i.test(n)); return esperar(suspeitos.length === 0, `ferramentas suspeitas: ${suspeitos.join(', ')}`); } },
);

// ── sentinels: achados não duplicam e não somem ─────────────────────────────
casos.push({
  nome: 'sentinels: mesmo (agente, regra) aberto agrega ocorrências em vez de duplicar',
  run: () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-eval-sent-'));
    const f = { agente: 'dba', regra: 'queda_publicados', severidade: 'alta', titulo: 'x', detalhe: 'd1', evidencia: 'e' };
    sentinels.upsert(dir, f);
    sentinels.upsert(dir, { ...f, detalhe: 'd2' });
    const itens = sentinels.readActions(dir);
    return [
      ...esperar(itens.length === 1, `${itens.length} itens (esperado 1)`),
      ...esperar((itens[0] && itens[0].ocorrencias) === 2, `ocorrencias=${itens[0] && itens[0].ocorrencias}`),
      ...esperar(itens[0] && itens[0].detalhe === 'd2', 'detalhe não atualizado'),
    ];
  },
});

module.exports = { casos };
