'use strict';
/**
 * Agenda do Julien às 9:00 AM — a rotina hospedada (Central, rotinas.js) que lê as reservas, monta a agenda do dia e
 * pede à Aria o aviso no WhatsApp do Julien. Escrita em 18/11/2026; desde 19/11 lê as RESERVAS da Central (reservas.js,
 * a mesma pasta de estado) por padrão. DESLIGADA até a chave entrar.
 *
 * Ligar (Easypanel da Central):
 *   CHAUFFEUR_AGENDA=on                      o interruptor
 *   CHAUFFEUR_AGENDA_FONTE=planilha          (opcional) voltar à aba CSV de 18/11; exige então
 *   CHAUFFEUR_AGENDA_CSV_URL=https://…       a aba "clientes" da planilha publicada como CSV (Arquivo → Compartilhar →
 *                                            Publicar na web → aba clientes → CSV). Qualquer URL que devolva CSV serve.
 *   ARIA_TEAM_ALERT_SECRET=…                 o mesmo TEAM_ALERT_SECRET da Aria (já usado pelo Olheiro); "julien" precisa
 *                                            estar na lista TEAM_ALERT_TO da Aria (nome=número; aqui só vai o nome)
 *   CHAUFFEUR_AGENDA_HORA=9                  hora de Paris (padrão 9) · CHAUFFEUR_AGENDA_PARA=julien (padrão)
 *   CHAUFFEUR_AGENDA_VAZIA=on                também avisa em dia sem corrida (padrão off: dia vazio não gera mensagem)
 *
 * Regras: 1 envio por dia (estado em TWK_STATE_ROOT/agents/wanted-chauffeur/agenda-<dia>.json e, na Aria, o evento
 * agenda:<dia> não repete em 24 h); o telefone do cliente nunca vai no aviso; a planilha é lida, nunca escrita;
 * sem URL, sem segredo ou planilha fora do ar = sai com erro e o log diz o porquê (falhar alto), nada de "ok" vazio.
 *
 * Uso à mão:  node agenda-run.js [--dry-run] [--dia AAAA-MM-DD] [--csv caminho.csv]   (--csv força a planilha)
 */
const fs = require('node:fs');
const path = require('node:path');
const { lerCsv, montarCompacta, hojeParis, COLUNAS } = require('./agenda-do-dia.js');
const reservasMod = require('./reservas.js');

const HOSPEDADO = process.env.TWK_STATE_ROOT ? path.resolve(process.env.TWK_STATE_ROOT) : null;
const STATE = process.env.CHAUFFEUR_STATE_DIR ? path.resolve(process.env.CHAUFFEUR_STATE_DIR) : HOSPEDADO ? path.join(HOSPEDADO, 'agents', 'wanted-chauffeur') : path.join(__dirname, 'state');

function config(env = process.env) {
  const v = (k) => String(env[k] || '').trim();
  return {
    ligado: v('CHAUFFEUR_AGENDA') === 'on',
    // Fonte (19/11): "reservas" = o armazém da Central (padrão, mesma pasta de estado); "planilha" = a aba CSV de 18/11.
    fonte: v('CHAUFFEUR_AGENDA_FONTE') === 'planilha' ? 'planilha' : 'reservas',
    csvUrl: v('CHAUFFEUR_AGENDA_CSV_URL'),
    ariaUrl: (v('AGENT_ARIA_URL') || 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host').replace(/\/+$/, ''),
    segredo: v('ARIA_TEAM_ALERT_SECRET'),
    para: (v('CHAUFFEUR_AGENDA_PARA') || 'julien').toLowerCase(),
    hora: Number(v('CHAUFFEUR_AGENDA_HORA') || 9),
    avisarVazia: v('CHAUFFEUR_AGENDA_VAZIA') === 'on',
  };
}

/** Reservas da Central → o mesmo formato de linhas da planilha, para a montarCompacta() não mudar. */
async function lerReservas(cfg, { env, store }) {
  const s = store || await reservasMod.abrir({ dir: STATE, env, log: () => {} });
  const todas = await s.listar({ dias: 365 });
  const linhas = todas.map((r) => ({
    nome_da_reserva: r.nome || '', whatsapp: r.whatsapp || '', hotel_ou_bairro: r.partida || '', origem_do_pedido: r.origem_nome || '',
    produto: r.produto_nome || r.produto, data: r.data || '', hora: r.hora || '', codigo: r.codigo, resultado: r.status, observacao: r.horas ? `${r.horas} h` : '',
  }));
  return { nomes: COLUNAS.slice(), linhas, modo: s.modo };
}

async function lerPlanilha(cfg, { fetchImpl, csvLocal }) {
  if (csvLocal) return fs.readFileSync(csvLocal, 'utf8');
  if (!cfg.csvUrl) throw new Error('CHAUFFEUR_AGENDA_CSV_URL ausente: a rotina não sabe onde está a planilha');
  const r = await fetchImpl(cfg.csvUrl, { signal: AbortSignal.timeout(20000), headers: { accept: 'text/csv,text/plain' } });
  if (!r.ok) throw new Error(`planilha respondeu HTTP ${r.status}`);
  const texto = await r.text();
  if (/<html/i.test(texto.slice(0, 500))) throw new Error('a URL devolveu uma página HTML, não CSV: a aba precisa estar publicada na web como CSV');
  return texto;
}

async function avisar(cfg, dia, situacao, avisarImpl) {
  const r = await avisarImpl(`${cfg.ariaUrl}/webhook/alerta-equipe`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-aria-secret': cfg.segredo },
    body: JSON.stringify({ destinatario: cfg.para, sistema: 'Wanted Chauffeur · agenda', situacao, evento: `agenda:${dia}` }),
    signal: AbortSignal.timeout(20000),
  });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok && j && j.ok === true, status: r.status, desfecho: (j && (j.desfecho || j.motivo)) || `HTTP ${r.status}` };
}

/** Uma rodada. Devolve { codigo, ...detalhes }; codigo 0 = agiu ou nada a fazer, 1 = não conseguiu (o log diz). */
async function rodar({ argv = [], env = process.env, fetchImpl = globalThis.fetch, avisarImpl = globalThis.fetch, log = console.log, store } = {}) {
  const cfg = config(env);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const dryRun = argv.includes('--dry-run');
  const dia = opt('--dia') || hojeParis();
  fs.mkdirSync(STATE, { recursive: true });
  const arqEstado = path.join(STATE, `agenda-${dia}.json`);
  const gravar = (e) => { fs.writeFileSync(arqEstado, JSON.stringify({ dia, em: new Date().toISOString(), ...e }, null, 1), 'utf8'); return e; };

  if (!cfg.ligado && !dryRun) { log('[agenda] CHAUFFEUR_AGENDA está desligada: nada feito'); return { codigo: 0, desligada: true }; }
  let anterior = null; try { anterior = JSON.parse(fs.readFileSync(arqEstado, 'utf8')); } catch { /* primeira vez hoje */ }
  if (anterior && anterior.enviado && !dryRun) { log(`[agenda] ${dia}: já enviada às ${anterior.em}; nada a fazer`); return { codigo: 0, repetida: true }; }

  // Fonte: --csv ou CHAUFFEUR_AGENDA_FONTE=planilha → a aba CSV; senão as reservas da Central.
  const usaPlanilha = !!opt('--csv') || cfg.fonte === 'planilha';
  let dados;
  if (usaPlanilha) {
    try { dados = lerCsv(await lerPlanilha(cfg, { fetchImpl, csvLocal: opt('--csv') })); }
    catch (e) { log(`[agenda] ERRO ao ler a planilha: ${e.message}`); gravar({ enviado: false, erro: `planilha: ${e.message}` }); return { codigo: 1, erro: e.message }; }
  } else {
    try { dados = await lerReservas(cfg, { env, store }); log(`[agenda] fonte: reservas da Central (${dados.modo}), ${dados.linhas.length} reserva(s) no total`); }
    catch (e) { log(`[agenda] ERRO ao ler as reservas: ${e.message}`); gravar({ enviado: false, erro: `reservas: ${e.message}` }); return { codigo: 1, erro: e.message }; }
  }

  let r;
  try { r = montarCompacta(dados, { dia }); }
  catch (e) { log(`[agenda] ERRO nos dados: ${e.message}`); gravar({ enviado: false, erro: e.message }); return { codigo: 1, erro: e.message }; }
  for (const a of r.avisos) log(`[agenda] aviso: ${a}`);
  log(`[agenda] ${dia}: ${r.corridas} corrida(s) confirmada(s), ${r.pendentes} por confirmar`);
  log(`[agenda] mensagem (${r.compacta.length} caracteres): ${r.compacta}`);

  if (!r.corridas && !cfg.avisarVazia) { log('[agenda] dia sem corrida e CHAUFFEUR_AGENDA_VAZIA=off: não envia'); gravar({ enviado: false, motivo: 'dia_sem_corrida', corridas: 0, pendentes: r.pendentes }); return { codigo: 0, corridas: 0, enviado: false }; }
  if (dryRun) { log('[agenda] --dry-run: nada enviado'); return { codigo: 0, dryRun: true, mensagem: r.compacta, corridas: r.corridas }; }
  if (!cfg.segredo) { log('[agenda] ERRO: ARIA_TEAM_ALERT_SECRET ausente; sem ele a Aria não aceita o pedido'); gravar({ enviado: false, erro: 'sem ARIA_TEAM_ALERT_SECRET', corridas: r.corridas }); return { codigo: 1, erro: 'sem segredo' }; }

  let env2;
  try { env2 = await avisar(cfg, dia, r.compacta, avisarImpl); }
  catch (e) { env2 = { ok: false, desfecho: String(e && e.message || e).slice(0, 160) }; }
  if (!env2.ok) { log(`[agenda] ERRO: a Aria não enviou (${env2.desfecho})`); gravar({ enviado: false, erro: `aria: ${env2.desfecho}`, corridas: r.corridas }); return { codigo: 1, erro: env2.desfecho }; }
  gravar({ enviado: true, para: cfg.para, corridas: r.corridas, pendentes: r.pendentes, caracteres: r.compacta.length, desfecho: env2.desfecho });
  log(`[agenda] enviada ao ${cfg.para} pela Aria (${env2.desfecho})`);
  return { codigo: 0, enviado: true, corridas: r.corridas };
}

if (require.main === module) {
  rodar({ argv: process.argv.slice(2) }).then((r) => process.exit(r.codigo)).catch((e) => { console.error('[agenda] exceção:', e && e.stack || e); process.exit(2); });
}
module.exports = { rodar, config, STATE };
