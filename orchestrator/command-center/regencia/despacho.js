'use strict';
/**
 * Regência — o Despacho do MAESTRO ao fundador.
 *
 * REGRA DE LINGUAGEM (2026-09-05, a pedido do fundador): este e-mail é lido por uma PESSOA, não por um engenheiro.
 * Nada de nome de tabela, sigla interna, caminho de arquivo, código de reserva solto ou bloco de dados.
 * Cada item responde três perguntas: o que aconteceu · o que fazer · por quê. O resto não entra.
 *
 * 1) Corpo determinístico (sempre produzido, sem modelo).
 * 2) "Voz do MAESTRO" opcional: abertura curta com modelo — Opus 4.8 por padrão; Fable 5.1 quando há item crítico
 *    ou decisão de marca/legal/dinheiro. Só resume o que já está no corpo: não inventa número, não executa nada.
 * Custo em inteiros (EUR e-4). Sem ANTHROPIC_API_KEY → só o corpo determinístico.
 */
let Anthropic = null; try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

const MODEL = process.env.MAESTRO_MODEL || 'claude-opus-4-8';
const MODEL_COMPLEX = process.env.MAESTRO_MODEL_COMPLEX || 'claude-fable-5-1';
const EFFORT = process.env.MAESTRO_EFFORT || 'high';
const PRECOS = (() => { try { return JSON.parse(process.env.MAESTRO_PRECOS || ''); } catch { return null; } })() || { 'claude-opus-4-8': { in: 500, out: 2500 }, 'claude-fable-5-1': { in: 1000, out: 5000 }, 'claude-fable-5': { in: 1000, out: 5000 } };
const USD_POR_EUR_E4 = Number(process.env.MAESTRO_USD_POR_EUR_E4 || 10800);

const esc = (s) => String(s || '').replace(/\|/g, '/');

// ---------- dicionários de tradução para linguagem de negócio ----------
const AGENTE = {
  dba: 'catálogo e reservas', 'guardiao-reserva': 'acompanhamento de reservas', 'registro-optout': 'pedidos de remoção',
  comercial: 'time comercial', 'suporte-concierge': 'atendimento', editorial: 'conteúdo do site', financeiro: 'financeiro', central: 'central',
};
const EXPERIENCIA = {
  clientes_com_mesa_hoje_sem_resposta: 'Clientes que jantam hoje e o restaurante não respondeu',
  clientes_com_mesa_amanha_sem_resposta: 'Clientes que jantam amanhã na mesma situação',
  clientes_a_avisar_degrau4: 'Clientes que precisam saber que a casa não respondeu',
  fila_humana_whatsapp_telefone: 'Restaurantes para mandar mensagem no WhatsApp (texto pronto no idioma deles)',
  escalacoes_abertas: 'Atendimentos parados esperando uma pessoa',
};
const SINAIS = {
  contas_profissionais_novas_7d: 'Restaurantes que assumiram a própria página (7 dias)',
  reservas_aceitas_7d: 'Reservas confirmadas pelos restaurantes (7 dias)',
  cadastros_concluidos_7d: 'Cadastros de restaurante concluídos (7 dias)',
};
const PRAZO = { hoje: 'hoje', agora: 'agora', '24h': 'nas próximas 24 horas' };

/** Tira o jargão de qualquer frase vinda dos agentes. Silencioso: o que não conhece, ao menos limpa. */
function limpar(t) {
  return String(t || '')
    .replace(/reservations:\s*expired_at IS NULL,\s*booking_date = hoje/gi, 'pedidos de mesa para hoje que seguem sem resposta')
    .replace(/restaurant_users sem linhas novas/gi, 'nenhuma conta de restaurante foi criada')
    .replace(/published\s*=\s*false com pendência viva[^·]*/gi, 'páginas fora do ar que continuam recebendo pedidos')
    .replace(/front deve responder 404 em[^;]*;?/gi, 'o site precisa tirar essas páginas do ar;')
    .replace(/front ainda responde 200 em (\S+)[^·]*/gi, 'a página $1 continua acessível')
    .replace(/front 404 \+ silenciar Aria \+ notificar CLAVIS\/Quill; fechar sla_done_at só com 404/gi, 'tirar a página do ar, silenciar o atendimento automático nessa conversa e avisar o time')
    .replace(/Pedido de opted_out de (\d+)/gi, 'Pedido de remoção do restaurante $1')
    .replace(/opening_hours:\s*1 intervalo idêntico em ≥6 dias/gi, 'mesmo horário repetido todos os dias da semana')
    .replace(/\/delegar dba: rodar \S+ em lote com proposta e aprovação/gi, 'conferir esses horários com o Google e corrigir em lote, com a sua aprovação')
    .replace(/Guardião em canário \(lote do degrau 1\) — aprovar na Central/gi, 'liberar a cobrança automática para mais restaurantes')
    .replace(/Lote do degrau 1 pronto: (\d+) casas \/ (\d+) reservas aguardam aprovação/gi, '$1 restaurantes com $2 pedidos de mesa parados: posso cobrá-los por e-mail?')
    .replace(/aprovar na Central \(canário[^)]*\)\s*→\s*run\.js[^·]*/gi, 'aprovar o lote em Aprovações na Central; o envio sai na hora')
    // 2026-09-24: ninguém lê respostas por e-mail — toda decisão é botão na Central.
    .replace(/responda\s+`?pode cobrar`?\s+e eu envio[^)]*\)?/gi, 'aprovar o lote em Aprovações na Central; o envio sai na hora')
    .replace(/responder sim ou não a este e-mail/gi, 'aprovar ou negar em Aprovações na Central')
    .replace(/respond(?:a|er)\s+(?:a\s+)?este e-mail/gi, 'decidir na Central')
    .replace(/npm run build \+ redeploy no EasyPanel/gi, 'publicar a nova versão do atendimento')
    .replace(/Aria em produção sem FLUXO 6\/7 \(redeploy pendente\)/gi, 'Atendimento em produção sem as instruções novas')
    .replace(/telefone humano ao restaurante agora/gi, 'mandar a mensagem pronta no WhatsApp')
    .replace(/ligar para (a casa|o restaurante)/gi, 'mandar a mensagem pronta para $1')
    .replace(/fila de liga[çc][õo]es/gi, 'fila de mensagens')
    .replace(/cliente avisado com alternativa \(Aria, aprovação unitária\)/gi, 'avisamos o cliente e oferecemos outra casa, com a sua aprovação')
    .replace(/degrau 4/gi, 'aviso ao cliente').replace(/degrau 1/gi, 'cobrança por e-mail')
    .replace(/Pergunta bloqueante sem resposta:/gi, 'Pergunta esperando sua resposta:')
    .replace(/\bcanário\b/gi, 'teste controlado').replace(/\bledger\b/gi, 'registro')
    .replace(/\b[\w.-]+\.(js|ts|json|csv|md|jsonl)\b/g, '')
    .replace(/\bQ-\d{4}-\d{2}-\d{2}-\d+\b/g, '')
    .replace(/\bAPR-\d+-[a-z0-9]+\b/gi, '')
    .replace(/\bAGENT_[A-Z_]+\b/g, 'a senha de acesso')
    .replace(/\b(expired_at|booking_date|booking_status|restaurant_users|reservations|aria_escalations|aria_contact_consent|opening_hours|sla_done_at|opted_out|published|dry-?run|API|MCP|webhook|placeholder|trigger|front)\b/gi, '')
    .replace(/\bsuposição em vigor\b/gi, 'por enquanto assumimos que')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s*·\s*(·\s*)+/g, ' · ').replace(/\s{2,}/g, ' ').replace(/^[\s·,;—-]+/, '').replace(/[\s·,;]+$/, '').trim();
}

const DIVIDA_DIAS = Number(process.env.REGENCIA_DIVIDA_DIAS || 3);
const fmtDia = (iso) => { const d = new Date(iso + 'T12:00:00Z'); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }); };

/**
 * Onde o fundador decide. Sem "responda este e-mail": ninguém lê a resposta. Com MAESTRO_CENTRAL_URL o texto vira link.
 */
function ondeDecidir(meta = {}) {
  const url = meta.centralUrl || process.env.MAESTRO_CENTRAL_URL || '';
  return url ? `na Central (${url}) — Aprovações e Ações` : 'na Central, em Aprovações e Ações';
}

function corpo(est, meta = {}) {
  const md = [];
  // 2026-09-24: separar o novo do crônico. Item que já aparece há mais de DIVIDA_DIAS dias vira "dívida":
  // listado uma vez, com a data desde quando espera, fora de "Urgente". Sem idade conhecida = novo.
  const idades = meta.idades || {}; const desde = meta.desde || {};
  const dividaDias = meta.dividaDias ?? DIVIDA_DIAS;
  const idade = (d) => (d.chave && Number.isFinite(idades[d.chave]) ? idades[d.chave] : 0);
  const novos = est.para_fundador.filter((d) => idade(d) <= dividaDias);
  const dividas = est.para_fundador.filter((d) => idade(d) > dividaDias).sort((a, b) => idade(b) - idade(a));
  const criticos = novos.filter((d) => d.severidade === 'critica');
  const importantes = novos.filter((d) => d.severidade === 'alta');
  const resto = novos.filter((d) => !['critica', 'alta'].includes(d.severidade));
  const exp = Object.fromEntries(est.experiencia.map((s) => [s.tipo, s]));
  const sinal = (t) => (est.sinais.find((s) => s.tipo === t) || {}).valor;
  const dataBr = new Date(est.ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });

  md.push('# O dia da The World Keys');
  md.push(`_${dataBr}_`);

  md.push('', '## Em três linhas');
  const hoje = exp.clientes_com_mesa_hoje_sem_resposta?.valor ?? 0;
  const amanha = exp.clientes_com_mesa_amanha_sem_resposta?.valor ?? 0;
  md.push(hoje > 0
    ? `- **${hoje} cliente(s) jantam hoje** e o restaurante ainda não respondeu${amanha ? `. Outros ${amanha} jantam amanhã na mesma situação` : ''}.`
    : `- Nenhum cliente com mesa hoje está sem resposta${amanha ? `; ${amanha} jantam amanhã e ainda aguardam` : ''}.`);
  if (sinal('reservas_aceitas_7d') !== undefined) md.push(`- **${sinal('reservas_aceitas_7d')} reservas confirmadas** pelos restaurantes nos últimos 7 dias.`);
  md.push(`- **${sinal('contas_profissionais_novas_7d') ?? 0} restaurante(s) assumiram a própria página** nos últimos 7 dias.`);

  md.push('', '## O que precisa de você');
  if (!est.para_fundador.length) md.push('Nada hoje. Pode tocar o dia.');
  else if (!novos.length) md.push(`Nada novo hoje. As decisões pendentes estão em "Esperando decisão" abaixo.`);
  let n = 0;
  const item = (d) => {
    const prazo = d.prazo ? ` **(${PRAZO[d.prazo] || d.prazo})**` : '';
    const porque = limpar(d.evidencia);
    return `${++n}. **${limpar(d.titulo)}**${prazo}  \n   O que fazer: ${limpar(d.acao_proposta)}.${porque ? ` _Por quê: ${porque}._` : ''}`;
  };
  if (criticos.length) { md.push('', '### Urgente'); criticos.forEach((d) => md.push(item(d))); }
  if (importantes.length) { md.push('', '### Importante'); importantes.forEach((d) => md.push(item(d))); }
  if (resto.length) { md.push('', '### Quando puder'); resto.forEach((d) => md.push(`- ${limpar(d.titulo)} — ${limpar(d.acao_proposta)}.`)); }

  if (dividas.length) {
    md.push('', `### Esperando decisão há mais de ${dividaDias} dias (${dividas.length})`);
    md.push('_Já apareceram em Despachos anteriores. Ficam aqui, uma vez, até serem decididos ou resolvidos._');
    dividas.forEach((d) => md.push(`- **${limpar(d.titulo)}** — desde ${fmtDia(desde[d.chave] || '')} (${idade(d)} dias) · ${limpar(d.acao_proposta)}.`));
  }

  const resolvidos = (meta.resolvidos && meta.resolvidos.itens) || [];
  if (resolvidos.length) {
    md.push('', `### Resolvido desde o último Despacho${meta.resolvidos.desde ? ` (${fmtDia(meta.resolvidos.desde)})` : ''}`);
    resolvidos.slice(0, 10).forEach((r) => md.push(`- ${limpar(r.titulo)}`));
  }

  if (est.aprovacoes.length) {
    md.push('', `### Esperando o seu "sim" (${est.aprovacoes.length})`);
    est.aprovacoes.slice(0, 10).forEach((a) => {
      const dias = Math.max(0, Math.round((Date.now() - Date.parse(a.desde)) / 86400000));
      md.push(`- ${limpar(String(a.titulo).replace(/^\[[^\]]+\]\s*/, ''))}${dias ? ` — parado há ${dias} dia(s)` : ''}`);
    });
  }

  if (est.experiencia.length) {
    md.push('', '## Quem está esperando por nós');
    md.push('| Situação | Quantos | Quem |', '|---|---|---|');
    est.experiencia.forEach((s) => {
      const quem = esc(String(s.detalhe || '').replace(/\b[A-Z0-9]{8}\s+/g, '').replace(/\((\d+)h\)/g, '(em $1h)')) || '—';
      md.push(`| ${EXPERIENCIA[s.tipo] || s.tipo.replace(/_/g, ' ')} | **${s.valor}** | ${quem} |`);
    });
  }

  if (est.sinais.length) {
    md.push('', '## Como estamos indo');
    md.push('| Indicador | Hoje |', '|---|---|');
    est.sinais.forEach((s) => md.push(`| ${SINAIS[s.tipo] || s.tipo.replace(/_/g, ' ')} | **${s.valor}**${s.detalhe ? ` · ${esc(s.detalhe)}` : ''} |`));
  }

  const maestro = est.decisoes.filter((d) => d.fila === 'maestro');
  if (est.autonomas.length || maestro.length) {
    md.push('', '## O que o time fez sozinho');
    est.autonomas.forEach((a) => md.push(`- ${AGENTE[a.agente] || a.agente}: ${limpar(a.acao)}${a.n > 1 ? ` (${a.n}×)` : ''}`));
    maestro.forEach((d) => md.push(`- Decidi sem incomodar você: ${limpar(d.titulo)} → ${limpar(d.acao_proposta)}`));
  }

  if (est.cegos.length) {
    md.push('', '## Onde ainda estou no escuro');
    est.cegos.forEach((c) => md.push(`- **${AGENTE[c.agente] || c.agente}**: ${limpar(c.lacunas.join('; ')) || 'sem acesso aos dados'}.`));
  }

  md.push('', '---', `_Todos os números vêm dos nossos sistemas; nenhum foi estimado. Nada foi enviado nem alterado sem a sua autorização. Para decidir qualquer item, ${ondeDecidir(meta)}._`);
  return md.join('\n');
}

/**
 * Alerta curto por e-mail (a única coisa que ainda pode ir para a caixa do fundador, 2026-09-24):
 * só os itens críticos NOVOS, o que fazer, e onde decidir. O Despacho completo fica na Central.
 */
function alerta(novos, meta = {}) {
  const md = ['# Alerta do MAESTRO', `_${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}_`, ''];
  md.push(`${novos.length === 1 ? 'Um item crítico novo' : `${novos.length} itens críticos novos`} desde o último aviso:`, '');
  novos.forEach((d, i) => {
    const prazo = d.prazo ? ` **(${PRAZO[d.prazo] || d.prazo})**` : '';
    const porque = limpar(d.evidencia);
    md.push(`${i + 1}. **${limpar(d.titulo)}**${prazo}  \n   O que fazer: ${limpar(d.acao_proposta)}.${porque ? ` _Por quê: ${porque}._` : ''}`);
  });
  md.push('', '---', `_Para decidir, ${ondeDecidir(meta)}. O Despacho completo do dia está em Missões. Este aviso sai no máximo uma vez por dia e só para item novo._`);
  return md.join('\n');
}

function escolherModelo(est) {
  const complexo = est.contagens.criticos > 0 || est.para_fundador.some((d) => /legal|gdpr|remo|marca|reembolso|€|eur/i.test(d.titulo + d.acao_proposta));
  return complexo ? MODEL_COMPLEX : MODEL;
}

async function voz(est) {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY || process.env.MAESTRO_VOZ === 'off') return null;
  const model = escolherModelo(est);
  const client = new Anthropic();
  const system = `Você é o MAESTRO, coordenador da operação da The World Keys (plataforma de reservas em restaurantes premium, sede em Paris). Escreve ao fundador como um diretor de operações que respeita o tempo dele.
REGRAS DE LINGUAGEM (as mais importantes): escreva para uma pessoa que NÃO é técnica. É PROIBIDO usar nome de tabela, sigla interna, nome de arquivo, termo em inglês evitável, código de reserva ou jargão ("canário", "degrau", "opt-out", "deploy", "API", "front"). Diga o que aconteceu e o que fazer, em português comum.
OUTRAS REGRAS: (1) use SOMENTE números que estejam nos dados recebidos; nunca invente; (2) você não executa nada — apenas prioriza e pede decisões; (3) máximo 120 palavras; (4) sem emojis; (5) estrutura: uma frase dizendo o que mais importa hoje, depois no máximo três frases sobre o que precisa da decisão dele, e uma frase final sobre quem está esperando. Nada de listas com marcadores.`;
  const user = `DADOS DE HOJE:\n${JSON.stringify({ manchete: est.manchete, para_fundador: est.para_fundador.slice(0, 8), sinais: est.sinais, experiencia: est.experiencia }).slice(0, 40000)}`;
  const params = { model, max_tokens: 1000, system, messages: [{ role: 'user', content: user }], output_config: { effort: EFFORT } };
  let resp;
  try {
    if (/fable|mythos/.test(model)) resp = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    else resp = await client.messages.create({ ...params, thinking: { type: 'adaptive' } });
  } catch (e) {
    if (model !== MODEL) { try { resp = await client.messages.create({ ...params, model: MODEL, thinking: { type: 'adaptive' } }); } catch (e2) { return { erro: e2.message, modelo: model }; } }
    else return { erro: e.message, modelo: model };
  }
  if (resp.stop_reason === 'refusal') return { erro: 'refusal', modelo: resp.model };
  const texto = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  const p = PRECOS[resp.model] || PRECOS[model] || { in: 500, out: 2500 };
  const usd_e4 = Math.round((resp.usage.input_tokens * p.in + resp.usage.output_tokens * p.out) * 100 / 1_000_000);
  return { texto, modelo: resp.model, tokens: { in: resp.usage.input_tokens, out: resp.usage.output_tokens }, custo_eur_e4: Math.round(usd_e4 * 10000 / USD_POR_EUR_E4) };
}

async function gerar(est, meta = {}) {
  const v = await voz(est);
  if (v && !v.erro) Object.assign(meta, { custo_voz_e4: v.custo_eur_e4, modelo: v.modelo });
  let md = corpo(est, meta);
  // A voz entra como abertura, sem anunciar modelo nem erro técnico ao leitor.
  if (v && v.texto) md = md.replace('## Em três linhas', `## O essencial\n\n${v.texto}\n\n## Em três linhas`);
  return { markdown: md, voz: v, modelo: v?.modelo || null, custo_voz_e4: v?.custo_eur_e4 || 0 };
}

function html(md) {
  const e = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linhas = md.split('\n'); const out = []; let inTable = false;
  const P = { bg: '#0B0A08', card: '#12100C', line: '#26200F', gold: '#CE9E3C', goldSoft: '#E6C87A', text: '#F5EFE3', muted: '#B5AB93', dim: '#8F8368' };
  for (const l of linhas) {
    if (l.startsWith('|')) {
      if (/^\|?\s*-+/.test(l)) continue;
      const cells = l.split('|').slice(1, -1).map((c) => c.trim());
      if (!inTable) { out.push(`<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin:10px 0">`); inTable = true; out.push('<tr>' + cells.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid ${P.line};color:${P.dim};font-size:11px;letter-spacing:.12em;text-transform:uppercase">${fmt(e(c))}</td>`).join('') + '</tr>'); continue; }
      out.push('<tr>' + cells.map((c, i) => `<td style="padding:9px 10px;border-bottom:1px solid ${P.line};color:${i === 0 ? P.text : P.muted};vertical-align:top">${fmt(e(c))}</td>`).join('') + '</tr>');
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    if (/^# /.test(l)) out.push(`<h1 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:28px;line-height:1.2;color:${P.text};margin:0 0 4px">${fmt(e(l.slice(2)))}</h1>`);
    else if (/^## /.test(l)) out.push(`<h2 style="font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:19px;color:${P.goldSoft};margin:26px 0 8px;padding-bottom:6px;border-bottom:1px solid ${P.line}">${fmt(e(l.slice(3)))}</h2>`);
    else if (/^### /.test(l)) out.push(`<h3 style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${P.gold};margin:18px 0 6px">${fmt(e(l.slice(4)))}</h3>`);
    else if (/^---$/.test(l)) out.push(`<div style="border-top:1px solid ${P.line};margin:22px 0 12px"></div>`);
    else if (/^_.*_$/.test(l)) out.push(`<p style="margin:4px 0;color:${P.dim};font-size:12px">${fmt(e(l.replace(/^_|_$/g, '')))}</p>`);
    else if (/^(\d+\.|-) /.test(l)) out.push(`<div style="margin:8px 0 8px 4px;color:${P.muted};line-height:1.6">${fmt(e(l))}</div>`);
    else if (l.trim() === '') out.push('<div style="height:4px"></div>');
    else out.push(`<p style="margin:8px 0;color:${P.muted};line-height:1.6">${fmt(e(l))}</p>`);
  }
  if (inTable) out.push('</table>');
  return `<div style="background:${P.bg};padding:24px 0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:${P.muted};background:${P.card};border:1px solid ${P.line};border-radius:14px;max-width:660px;margin:0 auto;padding:28px 26px">
<div style="font-family:Georgia,serif;font-size:11px;letter-spacing:.3em;color:${P.dim};text-transform:uppercase;margin-bottom:18px">The World Keys · Paris</div>
${out.join('\n')}
</div></div>`;
  function fmt(s) {
    return s.replace(/\*\*(.+?)\*\*/g, `<b style="color:${P.text};font-weight:600">$1</b>`)
      .replace(/_(.+?)_/g, `<i style="color:${P.dim}">$1</i>`)
      .replace(/`(.+?)`/g, '$1');
  }
}

module.exports = { corpo, alerta, gerar, html, escolherModelo, limpar, ondeDecidir, MODEL, MODEL_COMPLEX, DIVIDA_DIAS };
