'use strict';
/**
 * PANORAMA — a leitura unificada de todo o sistema de agentes (SOMENTE LEITURA).
 *
 * Um único instantâneo, com cache, que junta quatro fontes:
 *   1. o banco da plataforma, pela credencial twk_ro (escrita bloqueada no servidor) — as consultas
 *      moram em plataforma-catalogo.js, uma por métrica, todas só de agregados (nunca PII);
 *   2. a saúde de cada agente (o /health público de cada serviço);
 *   3. as APIs dos próprios agentes (kpis.js — só quando a credencial de leitura existe);
 *   4. os arquivos de estado do MAESTRO (fila, aprovações, ações, relatos, auditoria, porta de
 *      qualidade, avaliações, sentinela).
 *
 * Doutrina (constituição, regra 6): checagem que não rodou é lacuna declarada, nunca "ok" e nunca
 * zero. Cada métrica sai como { s: 'ok' | 'erro' | 'lacuna', linhas, erro, em } e a tela mostra o
 * motivo de quem não pôde ser lido.
 */
const fs = require('node:fs');
const path = require('node:path');
const db = require('./regencia/db.js');

let CATALOGO = [];
let erroCatalogo = null;
try { CATALOGO = require('./plataforma-catalogo.js'); } catch (e) { erroCatalogo = String((e && e.message) || e).slice(0, 160); }

const TTL_MS = Number(process.env.PLATAFORMA_CACHE_MS || 5 * 60_000);
const ORQ = path.resolve(__dirname, '..'); // orchestrator/ — só existe quando a Central roda dentro do repositório
const MAX_LINHAS = 500;

/** Endereços públicos dos serviços (os mesmos do .env.example). O /health não exige credencial. */
const URL_PADRAO = {
  comercial: 'https://theworldkeys-clavis-agent.xis4ee.easypanel.host',
  suporte: 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host',
  editorial: 'https://theworldkeys-quill-editorial-agent.xis4ee.easypanel.host',
  financeiro: 'https://theworldkeys-atlas-finance-agent.xis4ee.easypanel.host',
  dba: 'https://theworldkeys-database-agent-manager.xis4ee.easypanel.host',
};

let cache = null;
let emCurso = null;

const agora = () => new Date().toISOString();
const ok = (linhas, extra = {}) => ({ s: 'ok', linhas: Array.isArray(linhas) ? linhas.slice(0, MAX_LINHAS) : [linhas], em: agora(), ...extra });
const lacuna = (motivo) => ({ s: 'lacuna', linhas: [], erro: motivo, em: agora() });
const falha = (e) => ({ s: 'erro', linhas: [], erro: String((e && e.message) || e).slice(0, 180), em: agora() });

// ───────────────────────────── 1. banco ─────────────────────────────
async function lerBanco() {
  const metricas = {};
  if (erroCatalogo) {
    return { metricas, fonte: { nome: 'Banco da plataforma', status: 'erro', detalhe: `catálogo de consultas não carregou: ${erroCatalogo}` } };
  }
  if (!db.disponivel()) {
    for (const m of CATALOGO) metricas[m.id] = lacuna('a Central está sem a credencial de leitura do banco (DATABASE_URL_RO)');
    return { metricas, fonte: { nome: 'Banco da plataforma', status: 'sem_leitura', detalhe: 'Falta a credencial somente leitura (DATABASE_URL_RO) no serviço da Central.' } };
  }
  const t0 = Date.now();
  let falhas = 0;
  let semExclusao = false;
  try {
    await db.comCliente(async (c) => {
      // Casas de teste ficam fora de toda contagem (fundador, 2026-09-06). Sem a lista, conta tudo e DIZ que contou.
      let EX = `''`;
      try { EX = db.sqlExcluidos(); } catch { semExclusao = true; }
      for (const m of CATALOGO) {
        try {
          const r = await c.query(m.sql.replace(/\{\{EX\}\}/g, EX));
          metricas[m.id] = ok(r.rows);
        } catch (e) { falhas++; metricas[m.id] = falha(e); }
      }
    });
  } catch (e) {
    for (const m of CATALOGO) if (!metricas[m.id]) metricas[m.id] = falha(e);
    return { metricas, fonte: { nome: 'Banco da plataforma', status: 'erro', detalhe: `não foi possível conectar: ${String((e && e.message) || e).slice(0, 140)}` } };
  }
  return {
    metricas,
    fonte: {
      nome: 'Banco da plataforma', status: falhas ? 'parcial' : 'ok',
      detalhe: `${CATALOGO.length - falhas} de ${CATALOGO.length} consultas lidas em ${((Date.now() - t0) / 1000).toFixed(1)} s, com a credencial somente leitura (escrita bloqueada no servidor).${semExclusao ? ' Atenção: a lista de casas de teste não foi encontrada — as contagens incluem as casas de teste.' : ''}`,
    },
  };
}

// ───────────────────────────── 2. saúde dos serviços ─────────────────────────────
async function sondar(base) {
  const t0 = Date.now();
  for (const p of ['/health', '/healthz', '/api/health', '/']) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12_000); // a Aria às vezes leva ~10 s para responder ao /health
    try {
      const r = await fetch(new URL(p, base), { signal: ctrl.signal, redirect: 'follow' });
      if (r.status < 500) {
        let corpo = null;
        if (p === '/health' && r.ok) { try { corpo = await r.json(); } catch { corpo = null; } }
        return { vivo: true, http: r.status, caminho: p, ms: Date.now() - t0, corpo };
      }
    } catch { /* tenta o próximo caminho */ } finally { clearTimeout(to); }
  }
  return { vivo: false, ms: Date.now() - t0 };
}

async function lerSaude(agents) {
  const saude = {};
  const metricas = {};
  // agentes locais (Guardião) não têm serviço na web: a saúde deles é lida dos arquivos (guardiao.js), não sondada
  const pares = await Promise.all(agents.filter((a) => !a.local).map(async (a) => [a, await sondar(a.url || URL_PADRAO[a.id]).catch(() => ({ vivo: false }))]));
  const linhas = [];
  for (const [a, r] of pares) {
    saude[a.id] = !r.vivo ? { estado: 'fora', texto: 'sem resposta' } : r.ms > 6000 ? { estado: 'atencao', texto: 'no ar · respondendo devagar' } : { estado: 'ok', texto: 'no ar' };
    linhas.push({ agente: a.nome, estado: r.vivo ? 'no ar' : 'sem resposta', resposta_ms: r.ms ?? null, versao: (r.corpo && (r.corpo.build || r.corpo.version)) || null });
    if (a.id === 'financeiro' && r.corpo) {
      const q = r.corpo.queue || {};
      metricas.atlas_servico = ok({ banco: r.corpo.db === 'ok' || r.corpo.db === true ? 'ok' : String(r.corpo.db ?? '—'), fila_pendente: q.pending ?? null, fila_falhou: q.failed ?? null, fila_morta: q.dead ?? null });
    }
    if (a.id === 'suporte' && r.corpo) {
      const et = r.corpo.etapas || {};
      const nomes = Object.keys(et);
      metricas.aria_servico = ok({
        build: r.corpo.build || null,
        no_ar_horas: r.corpo.uptimeSeconds != null ? Math.round((r.corpo.uptimeSeconds / 3600) * 10) / 10 : null,
        etapas_ligadas: nomes.filter((k) => et[k] === true).length,
        etapas_total: nomes.length,
        alerta_operador: et.alertaOperador === true ? 'ligado' : 'desligado',
        idiomas: ((r.corpo.notificacoes && r.corpo.notificacoes.idiomas) || []).length || null,
        teto_diario: r.corpo.notificacoes ? r.corpo.notificacoes.tetoDiario : null,
      });
      const NOME = {
        eventos: 'Avisos a cada mudança da reserva', vigiaReservas: 'Vigia de reservas (a cada 2 min)', lembrete2h: 'Lembrete 2 horas antes',
        vesperaCliente: 'Véspera para o cliente', vesperaComMapa: 'Véspera com endereço e mapa', avaliacao: 'Convite a avaliar depois da visita',
        pendenteCliente24h: 'Pedido sem resposta há 24 h (cliente)', encerramentoHonesto: 'Aviso de que a mesa não foi confirmada',
        pedidoNovoCasa: 'Pedido novo para o restaurante', lembreteCasa24h: 'Lembrete ao restaurante (24 h)', vesperaCasa: 'Véspera para o restaurante',
        agendaCasa: 'Agenda do dia seguinte para o restaurante', alertaOperador: 'Alerta no celular do operador',
      };
      metricas.aria_etapas = ok(nomes.map((k) => ({ etapa: NOME[k] || k, estado: et[k] === true ? 'ligada' : 'desligada' })));
    }
  }
  saude.maestro = { estado: 'ok', texto: 'Central no ar' };
  metricas.frota_saude = ok(linhas);
  metricas.frota_resumo = ok({ no_ar: linhas.filter((l) => l.estado === 'no ar').length, total: linhas.length });
  return { saude, metricas, fonte: { nome: 'Saúde dos serviços', status: 'ok', detalhe: `${linhas.filter((l) => l.estado === 'no ar').length} de ${linhas.length} serviços responderam agora.` } };
}

// ───────────────────────────── 3. APIs dos agentes ─────────────────────────────
async function lerApis(agents, kpisFor) {
  const metricas = {};
  let comDado = 0;
  const faltas = [];
  await Promise.all(agents.filter((a) => !a.local).map(async (a) => {
    let k;
    try { k = await kpisFor({ ...a, url: a.url || URL_PADRAO[a.id] }); } catch (e) { k = { status: 'erro', erro: String((e && e.message) || e) }; }
    if (k && k.status === 'ok') { comDado++; metricas[`api_${a.id}`] = ok(k); }
    else {
      const motivo = k && k.status === 'sem_credencial' ? `a Central está sem a credencial de leitura deste agente (${(k.envs || []).join(', ')})`
        : k && k.status === 'sem_endpoint' ? (k.detalhe || 'o agente ainda não publica este resumo')
        : `o agente não respondeu (${(k && k.erro) || 'erro'})`;
      metricas[`api_${a.id}`] = lacuna(motivo);
      faltas.push(a.nome);
    }
  }));
  return { metricas, fonte: { nome: 'Painéis dos próprios agentes', status: comDado === agents.length ? 'ok' : comDado ? 'parcial' : 'sem_leitura', detalhe: comDado === agents.length ? 'Todos os agentes entregaram o próprio resumo.' : `Sem leitura de: ${faltas.join(', ')} — falta a credencial de leitura de cada um no serviço da Central.` } };
}

// ───────────────────────────── 4. arquivos de estado ─────────────────────────────
const lerJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; } };
const lerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const listar = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const conta = (arr, f) => arr.filter(f).length;

function lerArquivos(stateDir) {
  const m = {};
  // fila do MAESTRO
  const tarefas = lerJsonl(path.join(stateDir, 'tasks.jsonl')) || [];
  const aprov = lerJsonl(path.join(stateDir, 'aprovacoes.jsonl')) || [];
  const acoes = lerJsonl(path.join(stateDir, 'acoes.jsonl')) || [];
  const backlog = lerJsonl(path.join(stateDir, 'backlog.jsonl')) || [];
  const despachos = listar(path.join(stateDir, 'despachos')).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  const abertas = acoes.filter((a) => a.status === 'aberta' || a.status === 'adiada');
  const pendAprov = aprov.filter((a) => !a.status || a.status === 'pendente');
  m.maestro_fila = ok({
    tarefas: tarefas.length,
    tarefas_concluidas: conta(tarefas, (t) => t.status === 'concluida'),
    aprovacoes_pendentes: pendAprov.length,
    aprovacoes_total: aprov.length,
    acoes_abertas: abertas.length,
    acoes_criticas: conta(abertas, (a) => a.severidade === 'critica'),
    conversas: conta(listar(path.join(stateDir, 'threads')), (f) => f.endsWith('.json')),
    missoes: conta(listar(path.join(stateDir, 'missoes')), (f) => f.endsWith('.md')),
    despachos: despachos.length,
    ultimo_despacho: despachos.length ? despachos[despachos.length - 1].slice(0, 10) : null,
    backlog_abertos: conta(backlog, (b) => b.status && b.status !== 'concluido' && b.status !== 'rejeitado'),
  });
  const ordemSev = { critica: 0, alta: 1, media: 2, baixa: 3 };
  m.maestro_acoes = ok(abertas.sort((a, b) => (ordemSev[a.severidade] ?? 9) - (ordemSev[b.severidade] ?? 9)).slice(0, 20)
    .map((a) => ({ severidade: a.severidade || '—', agente: a.agente || '—', titulo: String(a.titulo || '').slice(0, 140), desde: a.criado_em || null, ocorrencias: a.ocorrencias || 1 })));
  m.maestro_aprovacoes = ok(aprov.slice(-12).reverse().map((a) => ({ titulo: String(a.titulo || '').slice(0, 120), tipo: a.tipo || '—', agente: a.agente || '—', situacao: a.status || 'pendente' })));
  m.maestro_acoes_por_agente = ok(Object.entries(abertas.reduce((o, a) => { const k = a.agente || 'sem agente'; o[k] = (o[k] || 0) + 1; return o; }, {})).map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor));

  // relatos dos agentes ao MAESTRO (Regência)
  const dirRel = path.join(stateDir, 'relatos');
  const diasRel = listar(dirRel).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (diasRel.length) {
    const dia = diasRel[diasRel.length - 1];
    const linhas = listar(path.join(dirRel, dia)).filter((f) => f.endsWith('.json')).map((f) => {
      const j = lerJson(path.join(dirRel, dia, f)) || {};
      return { agente: j.agente || f.replace('.json', ''), situacao: j.status || '—', achados: Array.isArray(j.achados) ? j.achados.length : 0, quando: j.ts || null };
    });
    m.maestro_relatos = ok(linhas);
    m.maestro_relatos_resumo = ok({ dia, agentes: linhas.length, achados: linhas.reduce((s, l) => s + l.achados, 0), dias_com_relato: diasRel.length });
  } else {
    m.maestro_relatos = lacuna('nenhum relato de agente foi gravado nesta Central');
    m.maestro_relatos_resumo = lacuna('nenhum relato de agente foi gravado nesta Central');
  }

  // trilha de auditoria (hooks): local = orchestrator/logs; hospedada = o que foi sincronizado
  const dirLog = fs.existsSync(path.join(ORQ, 'logs')) ? path.join(ORQ, 'logs') : path.join(stateDir, 'logs');
  const logs = listar(dirLog).filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  if (logs.length) {
    const ult = logs.slice(-14);
    const serie = ult.map((f) => {
      const ev = lerJsonl(path.join(dirLog, f)) || [];
      const n = (k) => conta(ev, (e) => e.evento === k);
      return { periodo: f.slice(6, 16), total: ev.length, acoes: n('tool_use'), bloqueios: n('guardrail_block'), escritas_banco: n('sql_escrita'), envios: n('email_envio') };
    });
    m.auditoria_serie = ok(serie);
    const s7 = serie.slice(-7);
    const soma = (k) => s7.reduce((s, l) => s + l[k], 0);
    m.auditoria_resumo = ok({ eventos: soma('total'), bloqueios: soma('bloqueios'), escritas_banco: soma('escritas_banco'), envios: soma('envios'), dias_com_registro: logs.length, ultimo_dia: logs[logs.length - 1].slice(6, 16) });
  } else {
    m.auditoria_serie = lacuna('a trilha de auditoria não está disponível nesta Central (ela vive na máquina do Orquestrador)');
    m.auditoria_resumo = lacuna('a trilha de auditoria não está disponível nesta Central (ela vive na máquina do Orquestrador)');
  }

  // porta de qualidade, avaliações, sentinela, guardião — só existem quando a Central roda no repositório
  const soLocal = 'este número é gerado na máquina do Orquestrador e ainda não é sincronizado para a Central hospedada';
  const porta = lerJson(path.join(ORQ, 'state', 'porta-qualidade.json'));
  const NOME_ETAPA = { aria: 'Aria', clavis: 'CLAVIS', atlas: 'Atlas', quill: 'Quill', dba: 'DB Architect', regencia: 'Regência (MAESTRO)', evals: 'Avaliações', hooks: 'Travas de segurança' };
  if (porta) {
    m.porta = ok({ situacao: porta.verde ? 'verde' : 'vermelha', checagens_ok: porta.checagens_ok, rodou_em: porta.rodou_em, duracao_min: Math.round((porta.duracao_s || 0) / 6) / 10, etapas: (porta.etapas || []).length, etapas_ok: conta(porta.etapas || [], (e) => e.ok) });
    m.porta_etapas = ok((porta.etapas || []).map((e) => ({ rotulo: NOME_ETAPA[e.chave] || e.chave, valor: e.passaram || 0, situacao: e.ok ? 'passou' : 'falhou' })));
  } else { m.porta = lacuna(soLocal); m.porta_etapas = lacuna(soLocal); }

  const dirEv = path.join(ORQ, 'evals', 'relatorios');
  const rels = listar(dirEv).filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f)).sort();
  if (rels.length) {
    const ultimo = {};
    for (const f of rels) ultimo[f.slice(11, -3)] = f;
    const linhas = Object.entries(ultimo).map(([suite, f]) => {
      let casos = null, resultado = '—';
      try {
        const t = fs.readFileSync(path.join(dirEv, f), 'utf8').slice(0, 600);
        const c = t.match(/casos:\s*(\d+)/); if (c) casos = Number(c[1]);
        resultado = /\*\*APROVADO\*\*/.test(t) ? 'aprovado' : /REPROVADO/.test(t) ? 'reprovado' : '—';
      } catch { /* arquivo ilegível: fica sem resultado */ }
      return { rotulo: suite, valor: casos, situacao: resultado, quando: f.slice(0, 10) };
    });
    m.avaliacoes = ok(linhas);
    m.avaliacoes_resumo = ok({ suites: linhas.length, casos: linhas.reduce((s, l) => s + (l.valor || 0), 0), aprovadas: conta(linhas, (l) => l.situacao === 'aprovado') });
  } else { m.avaliacoes = lacuna(soLocal); m.avaliacoes_resumo = lacuna(soLocal); }

  const dirSen = path.join(ORQ, 'agents', 'sentinela-silencio', 'state');
  const relSen = listar(dirSen).filter((f) => /^relato-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (relSen.length) {
    const j = lerJson(path.join(dirSen, relSen[relSen.length - 1])) || {};
    const k = j.kpis || {};
    m.sentinela = ok({ achados: k.achados ?? (j.achados || []).length, criticos: k.criticos ?? null, fontes_vivas: k.fontes_vivas ?? null, lacunas: ((j.cobertura && j.cobertura.lacunas) || []).length, fontes: ((j.cobertura && j.cobertura.fontes) || []).length, quando: j.ts || null });
    m.sentinela_achados = ok((j.achados || []).slice(0, 25).map((a) => ({ severidade: a.severidade || '—', titulo: String(a.titulo || '').slice(0, 120), evidencia: String(a.evidencia || '').slice(0, 160) })));
  } else { m.sentinela = lacuna(soLocal); m.sentinela_achados = lacuna(soLocal); }

  const dirGua = path.join(ORQ, 'agents', 'guardiao-reserva', 'state');
  const relGua = listar(dirGua).filter((f) => /^relatorio-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  m.guardiao_arquivo = relGua.length
    ? ok({ ultimo_relatorio: relGua[relGua.length - 1].slice(10, 20), relatorios: relGua.length })
    : lacuna(soLocal);

  // Guardião: o que a última execução decidiu (sem enviar — é ensaio até a aprovação de cada lote)
  const decs = listar(dirGua).filter((f) => /^decisoes-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const ultDec = decs.length ? lerJson(path.join(dirGua, decs[decs.length - 1])) : null;
  if (Array.isArray(ultDec)) {
    const NOME_ACAO = { email_restaurante: 'Cobrar a casa por e-mail', fila_whatsapp: 'Cobrar a casa por WhatsApp ou telefone', mensagem_cliente: 'Avisar o cliente (pela Aria)', aguardar: 'Aguardar: ainda é cedo', fora_janela: 'Fora do horário de contato', bloqueado: 'Casa pediu para não ser contatada', vencida: 'Pedido já vencido' };
    const cont = ultDec.reduce((o, d) => { const k = NOME_ACAO[d.acao] || String(d.acao || '—'); o[k] = (o[k] || 0) + 1; return o; }, {});
    m.guardiao_decisoes = ok(Object.entries(cont).map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor));
    m.guardiao_execucao = ok({ avaliadas: ultDec.length, dia: decs[decs.length - 1].slice(9, 19), cobrar_casa: conta(ultDec, (d) => d.acao === 'email_restaurante' || d.acao === 'fila_whatsapp'), avisar_cliente: conta(ultDec, (d) => d.acao === 'mensagem_cliente'), execucoes: decs.length });
  } else { m.guardiao_decisoes = lacuna(soLocal); m.guardiao_execucao = lacuna(soLocal); }

  // Ciclo do cliente: e-mails de véspera, pós-visita e boas-vindas (só contagens; nome e domínio não saem daqui)
  const envios = lerJsonl(path.join(ORQ, 'agents', 'ciclo-cliente', 'state', 'envios.jsonl'));
  if (envios) {
    const NOME_TIPO = { vespera: 'Lembrete de véspera', pos_visita: 'Pedido de opinião depois da visita', 'pos-visita': 'Pedido de opinião depois da visita', boas_vindas: 'Boas-vindas a restaurante novo', 'boas-vindas': 'Boas-vindas a restaurante novo' };
    const bons = envios.filter((e) => e.ok);
    const cont = bons.reduce((o, e) => { const k = NOME_TIPO[e.tipo] || String(e.tipo || '—'); o[k] = (o[k] || 0) + 1; return o; }, {});
    m.ciclo_tipos = ok(Object.entries(cont).map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor));
    m.ciclo_resumo = ok({ enviados: bons.length, falharam: envios.length - bons.length, ultimo: envios.length ? envios[envios.length - 1].ts : null, hoje: conta(bons, (e) => String(e.ts || '').slice(0, 10) === agora().slice(0, 10)) });
  } else { m.ciclo_tipos = lacuna(soLocal); m.ciclo_resumo = lacuna(soLocal); }

  // Zelador de privilégios: último relato
  const dirZel = path.join(ORQ, 'agents', 'zelador-privilegios', 'state');
  const relZel = listar(dirZel).filter((f) => /^relato-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (relZel.length) {
    const j = lerJson(path.join(dirZel, relZel[relZel.length - 1])) || {};
    m.zelador = ok({ achados: (j.kpis && j.kpis.achados) ?? (j.achados || []).length, criticos: (j.kpis && j.kpis.criticos) ?? null, quando: j.ts || relZel[relZel.length - 1].slice(7, 17) });
    m.zelador_achados = ok((j.achados || []).slice(0, 12).map((a) => ({ severidade: a.severidade || '—', titulo: String(a.titulo || '').slice(0, 140) })));
  } else { m.zelador = lacuna(soLocal); m.zelador_achados = lacuna(soLocal); }

  // Compromissos com data (ADR-015: promessa ao cliente é compromisso)
  const comp = lerJsonl(path.join(ORQ, 'state', 'compromissos.jsonl'));
  if (comp) {
    const hoje = agora().slice(0, 10);
    const abertos = comp.filter((c) => c.status === 'aberto' || c.status === 'em_curso');
    m.compromissos = ok({ abertos: abertos.length, vencidos: conta(abertos, (c) => String(c.vence_em || '').slice(0, 10) < hoje), total: comp.length, concluidos: conta(comp, (c) => c.status === 'concluido') });
  } else { m.compromissos = lacuna(soLocal); }

  // Convites a restaurantes: o livro único dos envios reais (só contagens; destinatário e nome não saem daqui)
  try {
    const bruto = fs.readFileSync(path.join(ORQ, 'state', 'envios-fundadores-2026-08.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
    const cab = bruto[0].split(';');
    const col = (k) => cab.indexOf(k);
    const linhas = bruto.slice(1).map((l) => l.split(';')).filter((p) => p[col('touch_no')] && p[col('touch_no')] !== '0');
    const NOME_CAMP = (k) => (/lagos/i.test(k) ? 'Operação Lagos' : /chave|extrato/i.test(k) ? 'Chave Girada (extrato de resposta)' : /fundador/i.test(k) ? 'Convite aos fundadores' : (k || 'outra'));
    const cont = linhas.reduce((o, p) => { const k = NOME_CAMP(p[col('campaign_key')] || ''); o[k] = (o[k] || 0) + 1; return o; }, {});
    const datas = linhas.map((p) => String(p[col('sent_at')] || '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    m.convites_resumo = ok({ envios: linhas.length, casas: new Set(linhas.map((p) => p[col('restaurant_id')])).size, ultimo: datas.length ? datas[datas.length - 1] : null, primeiro: datas.length ? datas[0] : null });
    m.convites_campanhas = ok(Object.entries(cont).map(([rotulo, valor]) => ({ rotulo, valor })).sort((a, b) => b.valor - a.valor));
    const porMes = datas.reduce((o, d) => { const k = d.slice(0, 7); o[k] = (o[k] || 0) + 1; return o; }, {});
    m.convites_mes = ok(Object.entries(porMes).sort().map(([periodo, envios]) => ({ periodo, envios })));
  } catch { m.convites_resumo = lacuna(soLocal); m.convites_campanhas = lacuna(soLocal); m.convites_mes = lacuna(soLocal); }

  // Decisões de arquitetura e manuais de operação (contagem dos documentos)
  const adrs = listar(path.join(ORQ, '..', 'docs', 'adr')).filter((f) => /^ADR-\d+/i.test(f));
  const runs = listar(path.join(ORQ, '..', 'docs', 'runbooks')).filter((f) => f.endsWith('.md'));
  m.documentos = adrs.length || runs.length ? ok({ decisoes: adrs.length, manuais: runs.length }) : lacuna(soLocal);

  const temLocal = fs.existsSync(path.join(ORQ, 'state'));
  if (temLocal) {
    return {
      metricas: m,
      fonte: { nome: 'Arquivos do MAESTRO', status: 'ok', detalhe: 'Fila, aprovações, relatos, auditoria, porta de qualidade e avaliações lidos do repositório do Orquestrador.' },
    };
  }
  // Central hospedada: o que é gerado na máquina do Orquestrador chega por sincronização
  // (push-state.ps1 → /api/ingest → state/plataforma-local.json). Métrica sincronizada substitui a lacuna.
  const sinc = lerJson(path.join(stateDir, 'plataforma-local.json'));
  if (sinc && sinc.metricas) {
    let n = 0;
    for (const k of CHAVES_LOCAIS) if (sinc.metricas[k] && sinc.metricas[k].s === 'ok') { m[k] = { ...sinc.metricas[k], sincronizado: true }; n++; }
    const idadeH = sinc.exportadoEm ? Math.round((Date.now() - new Date(sinc.exportadoEm).getTime()) / 3_600_000) : null;
    return {
      metricas: m,
      fonte: { nome: 'Arquivos do MAESTRO', status: idadeH !== null && idadeH > 48 ? 'parcial' : 'ok', detalhe: `Fila, aprovações e relatos lidos aqui; ${n} métrica(s) da máquina do Orquestrador (porta de qualidade, avaliações, sentinela, Guardião, convites) sincronizadas${idadeH !== null ? ` há ${idadeH} h` : ''}.` },
    };
  }
  return {
    metricas: m,
    fonte: { nome: 'Arquivos do MAESTRO', status: 'parcial', detalhe: 'Fila, aprovações e relatos lidos; porta de qualidade, avaliações, sentinela, Guardião e convites só existem na máquina do Orquestrador — rode push-state.ps1 para sincronizá-los.' },
  };
}

/** As métricas que só nascem na máquina do Orquestrador — as que a sincronização leva à Central hospedada. */
const CHAVES_LOCAIS = ['porta', 'porta_etapas', 'avaliacoes', 'avaliacoes_resumo', 'sentinela', 'sentinela_achados', 'guardiao_arquivo', 'guardiao_decisoes', 'guardiao_execucao',
  'ciclo_tipos', 'ciclo_resumo', 'zelador', 'zelador_achados', 'compromissos', 'convites_resumo', 'convites_campanhas', 'convites_mes', 'documentos', 'auditoria_serie', 'auditoria_resumo'];

/** Pacote para a sincronização: só as métricas locais, calculadas agora (chamado por plataforma-exportar.js). */
function exportarLocais(stateDir) {
  const { metricas } = lerArquivos(stateDir);
  const saida = {};
  for (const k of CHAVES_LOCAIS) if (metricas[k]) saida[k] = metricas[k];
  return { exportadoEm: agora(), metricas: saida };
}

// ───────────────────────────── instantâneo ─────────────────────────────
async function montar({ stateDir, agents, kpisFor }) {
  const [banco, saude, apis] = await Promise.all([
    lerBanco().catch((e) => ({ metricas: {}, fonte: { nome: 'Banco da plataforma', status: 'erro', detalhe: String(e.message || e) } })),
    lerSaude(agents).catch((e) => ({ saude: {}, metricas: {}, fonte: { nome: 'Saúde dos serviços', status: 'erro', detalhe: String(e.message || e) } })),
    lerApis(agents, kpisFor).catch((e) => ({ metricas: {}, fonte: { nome: 'Painéis dos próprios agentes', status: 'erro', detalhe: String(e.message || e) } })),
  ]);
  let arquivos;
  try { arquivos = lerArquivos(stateDir); } catch (e) { arquivos = { metricas: {}, fonte: { nome: 'Arquivos do MAESTRO', status: 'erro', detalhe: String(e.message || e) } }; }
  const metricas = { ...arquivos.metricas, ...apis.metricas, ...saude.metricas, ...banco.metricas };

  // A saúde de um serviço não é só "respondeu HTTP": a Aria no ar com o modelo fora está muda.
  const pulso = metricas.aria_pulso && metricas.aria_pulso.s === 'ok' ? metricas.aria_pulso.linhas[0] : null;
  if (pulso && saude.saude.suporte && saude.saude.suporte.estado !== 'fora') {
    if (pulso.modelo_ok === false) saude.saude.suporte = { estado: 'fora', texto: 'no ar, mas sem o modelo de IA' };
    else if (Number(pulso.escalacoes_urgentes) > 0) saude.saude.suporte = { estado: 'atencao', texto: 'no ar · há escalação urgente' };
  }
  const gua = metricas.guardiao_arquivo && metricas.guardiao_arquivo.s === 'ok' ? metricas.guardiao_arquivo.linhas[0] : null;
  if (gua) {
    const dias = Math.floor((Date.now() - new Date(gua.ultimo_relatorio + 'T00:00:00Z').getTime()) / 86_400_000);
    saude.saude.guardiao = dias <= 3 ? { estado: 'ok', texto: dias <= 0 ? 'rodou hoje' : `rodou há ${dias} dia(s)` } : { estado: 'atencao', texto: `sem rodar há ${dias} dias` };
  }
  return {
    geradoEm: agora(),
    cacheSeg: Math.round(TTL_MS / 1000),
    fontes: { banco: banco.fonte, saude: saude.fonte, apis: apis.fonte, arquivos: arquivos.fonte },
    saude: saude.saude,
    metricas,
  };
}

/**
 * Entrega o instantâneo. A primeira leitura espera (≈20 s: são dezenas de consultas e as sondas de
 * saúde); daí em diante quem pede recebe NA HORA o último instantâneo, e se ele já passou do prazo
 * uma leitura nova começa em segundo plano. `fresco` força a leitura e espera por ela.
 */
let ultimoPedido = 0;
function renovar(opts) {
  if (!emCurso) emCurso = montar(opts).then((data) => { cache = { at: Date.now(), data }; return data; }).finally(() => { emCurso = null; });
  return emCurso;
}
async function snapshot(opts) {
  ultimoPedido = Date.now();
  if (opts.fresco || !cache) return renovar(opts);
  if (Date.now() - cache.at >= TTL_MS) renovar(opts).catch(() => {});
  return cache.data;
}

/** Mantém o instantâneo quente enquanto alguém estiver usando a plataforma (pedido na última hora). */
function manterQuente(opts) {
  setTimeout(() => { renovar(opts).catch(() => {}); }, 3000).unref();
  setInterval(() => { if (Date.now() - ultimoPedido < 3_600_000) renovar(opts).catch(() => {}); }, TTL_MS).unref();
}

// ───────────────────────────── o conteúdo das páginas ─────────────────────────────
/**
 * O texto de cada página (o que cada agente faz, as ferramentas, as limitações) descreve o sistema
 * por dentro. Por isso NÃO fica em public/: é servido por /api/plataforma/registro, atrás da mesma
 * chave dos números. Um arquivo por página em plataforma-conteudo/paginas/; página que não carregar
 * é omitida e listada em `faltando`.
 */
const CONTEUDO = path.join(__dirname, 'plataforma-conteudo');
function registro() {
  const base = lerJson(path.join(CONTEUDO, 'registro.json'));
  if (!base) throw new Error('plataforma-conteudo/registro.json ausente ou inválido');
  const paginas = [];
  const faltando = [];
  for (const id of base.partes || []) {
    if (!/^[a-z0-9-]+$/.test(id)) continue;
    const pg = lerJson(path.join(CONTEUDO, 'paginas', id + '.json'));
    if (pg) paginas.push(pg); else faltando.push(id);
  }
  return { versao: base.versao, glossario: base.glossario || [], paginas, faltando };
}

module.exports = { snapshot, manterQuente, registro, exportarLocais, TTL_MS };
