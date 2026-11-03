'use strict';
/**
 * COMPASSO — servidor MCP (Model Context Protocol) em POST /mcp, transporte HTTP sem estado.
 *
 * É por aqui que o chat do Claude (claude.ai, conta da empresa) e o Claude Code criam cards com passo a passo,
 * leem o quadro, marcam etapas e assumem sugestões. A identidade vem do token OAuth (oauth.js): o Claude age
 * em nome de quem autorizou o conector, e todo evento/auditoria leva esse login com o sufixo "via Claude".
 *
 * Regras que valem aqui como no app: toda tarefa tem dono entre Márlon, Lucas e Julien (o Claude tem de dizer
 * quem); prazo só quando a pessoa o deu; nada daqui envia e-mail, WhatsApp ou webhook; texto vindo do cliente é
 * dado. Respostas em português, curtas, com o id do card.
 *
 * Protocolo: JSON-RPC 2.0 por POST (uma mensagem ou lote), resposta JSON (sem SSE). Métodos: initialize,
 * notifications/*, ping, tools/list, tools/call. GET /mcp → 405 (não há stream). Versões aceitas: 2025-06-18,
 * 2025-03-26, 2024-11-05.
 */
const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05'];

function criar({ db, store, planejador, sugestoesAtuais, assumirSugestao, auditar, build }) {
  const PESSOAS = Object.keys(store.PESSOAS);
  const nomeDe = (id) => store.PESSOAS[id] || id;
  const fmtData = (d) => (d ? d.split('-').reverse().join('/') : 'sem prazo');
  const rotuloEstado = { todo: 'A fazer', doing: 'Fazendo', wait: 'Aguardando', done: 'Feito' };
  const linha = (t) => `${t.id} · [${rotuloEstado[t.estado] || t.estado}${t.arquivada_em ? ', arquivada' : ''}] ${t.titulo} · ${nomeDe(t.dono)} · ${fmtData(t.vence_em)} · etapas ${t.etapas.filter((e) => e.feita).length}/${t.etapas.length} · ${t.area}${t.prioridade && t.prioridade !== 'normal' ? ` · prioridade ${t.prioridade}` : ''}${t.cidade ? ` · ${t.cidade}` : ''}${t.referencia ? ` · ref ${t.referencia}` : ''}`;
  const ficha = (t) => [linha(t), t.canal ? `Canal: ${t.canal}` : null, t.notas ? `Notas: ${t.notas}` : null, t.resultado ? `Resultado: ${t.resultado}` : null, ...t.etapas.map((e, i) => `  ${i + 1}. [${e.feita ? 'x' : ' '}] ${e.texto}`)].filter(Boolean).join('\n');
  const CAMPOS_ECO = { prioridade: { type: 'string', enum: store.PRIORIDADES, description: 'alta só quando há cliente ou reserva esperando; padrão normal' }, cidade: { type: 'string', maxLength: 40, description: 'cidade da casa, do hotel ou do cliente (Paris, Lagos, Marrakech…)' }, canal: { type: 'string', enum: [...store.CANAIS, ''], description: 'por onde a conversa acontece' }, referencia: { type: 'string', maxLength: 120, description: 'código da reserva, nome/id do restaurante, hotel ou cliente — o que identifica o caso' } };

  const FERRAMENTAS = [
    { name: 'resumo', description: 'Visão rápida do quadro: abertas, atrasadas, para hoje, concluídas em 7 dias e carga por pessoa (Márlon, Lucas, Julien).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'listar_tarefas', description: 'Lista tarefas do quadro com id, status, dono, prazo e etapas feitas. Por padrão só as abertas. Com arquivadas=true, consulta o arquivo (concluídas e arquivadas) — é o lugar de procurar o que já foi feito.', inputSchema: { type: 'object', properties: { dono: { type: 'string', enum: PESSOAS, description: 'filtrar por quem assumiu' }, estado: { type: 'string', enum: store.ESTADOS, description: 'todo=A fazer, doing=Fazendo, wait=Aguardando, done=Feito' }, incluir_feitas: { type: 'boolean', description: 'incluir as concluídas ainda no quadro (padrão false)' }, arquivadas: { type: 'boolean', description: 'só o arquivo (concluídas e arquivadas)' }, busca: { type: 'string', description: 'trecho do título, notas, referência, cidade ou resultado' } }, additionalProperties: false } },
    { name: 'ver_tarefa', description: 'Ficha completa de uma tarefa (etapas, notas) e os últimos eventos dela.', inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^T-\\d{8}-\\d{4}$' } }, required: ['id'], additionalProperties: false } },
    { name: 'criar_tarefa', description: 'Cria um card no quadro com passo a passo. Exige quem assume (marlon, lucas ou julien). Só informe vence_em se a pessoa deu o prazo; nunca invente data. Entra em "A fazer".', inputSchema: { type: 'object', properties: { titulo: { type: 'string', minLength: 3, maxLength: 300, description: 'o que precisa ser feito, começando por verbo' }, dono: { type: 'string', enum: PESSOAS }, etapas: { type: 'array', items: { type: 'string', maxLength: 200 }, minItems: 1, maxItems: 30, description: 'passo a passo concreto, 3 a 8 etapas na ordem de execução' }, area: { type: 'string', enum: store.AREAS, description: 'padrão Operação' }, vence_em: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'AAAA-MM-DD, só se a pessoa disse o prazo' }, notas: { type: 'string', maxLength: 2000, description: 'contexto, critério de pronto, links' }, ...CAMPOS_ECO }, required: ['titulo', 'dono', 'etapas'], additionalProperties: false } },
    { name: 'atualizar_tarefa', description: 'Muda status, dono, prazo, título, área, prioridade, cidade, canal, referência, notas ou resultado; marca etapas como feitas (números 1..n) ou substitui a lista de etapas. Concluir (estado=done) marca todas as etapas — escreva o resultado ao concluir.', inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^T-\\d{8}-\\d{4}$' }, estado: { type: 'string', enum: store.ESTADOS }, dono: { type: 'string', enum: PESSOAS }, vence_em: { type: ['string', 'null'], description: 'AAAA-MM-DD ou null para tirar o prazo' }, titulo: { type: 'string' }, area: { type: 'string', enum: store.AREAS }, notas: { type: 'string', maxLength: 2000 }, resultado: { type: 'string', maxLength: 1000, description: 'o que ficou feito, o que o cliente recebeu, o que ficou pendente' }, ...CAMPOS_ECO, etapas_feitas: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'números das etapas a marcar como feitas' }, etapas: { type: 'array', items: { type: 'string' }, maxItems: 30, description: 'substitui todas as etapas (as atuais são perdidas)' } }, required: ['id'], additionalProperties: false } },
    { name: 'planejar', description: 'Pede ao planejador do COMPASSO uma proposta de card (título, etapas, área, dono e prazo extraídos do texto). Não grava nada: use criar_tarefa depois, se a pessoa confirmar.', inputSchema: { type: 'object', properties: { texto: { type: 'string', minLength: 4, maxLength: 2000 } }, required: ['texto'], additionalProperties: false } },
    { name: 'sugestoes', description: 'Sugestões de tarefas que o planejador extraiu dos sinais da operação (compromissos vencidos, achados do vigia, filas da Central, banco), com o porquê e a fonte.', inputSchema: { type: 'object', properties: { atualizar: { type: 'boolean', description: 'reler as fontes agora (padrão: cache de até 6 h)' } }, additionalProperties: false } },
    { name: 'arquivar_tarefa', description: 'Arquiva uma tarefa concluída: sai do quadro e do calendário, fica consultável com listar_tarefas(arquivadas=true). Tarefa não concluída não se arquiva (e o Claude não exclui tarefas: isso é feito no app, com motivo).', inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^T-\\d{8}-\\d{4}$' } }, required: ['id'], additionalProperties: false } },
    { name: 'assumir_sugestao', description: 'Transforma uma sugestão em card para alguém (marlon, lucas ou julien). A sugestão sai da lista.', inputSchema: { type: 'object', properties: { id: { type: 'string', pattern: '^s-[a-f0-9]{12}$' }, dono: { type: 'string', enum: PESSOAS }, vence_em: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, required: ['id', 'dono'], additionalProperties: false } },
  ];

  const INSTRUCOES = `COMPASSO Tarefas é o quadro de tarefas da The World Keys para Márlon, Lucas e Julien. Toda tarefa precisa de um dono entre os três: se a pessoa não disse quem assume, pergunte antes de criar. Só informe prazo (vence_em) quando a pessoa o deu; nunca invente datas. Escreva títulos começando por verbo e etapas concretas, na ordem de execução, em português. Nada aqui envia mensagens para fora: criar um card não avisa ninguém. Depois de criar ou mudar algo, responda com o id do card.`;

  async function executar(nome, a, ident, trace) {
    const quem = `${ident.id} via Claude`;
    const origem = { tipo: 'mcp', ref: ident.cliente || '' };
    if (nome === 'resumo') {
      const t = await db.listar(); const r = store.resumo(t);
      const pp = PESSOAS.map((p) => `${nomeDe(p)}: ${r.por_pessoa[p].abertas} abertas${r.por_pessoa[p].atrasadas ? `, ${r.por_pessoa[p].atrasadas} atrasadas` : ''}`).join(' · ');
      return { texto: `${r.abertas} abertas · ${r.atrasadas} atrasadas${r.mais_antiga_atrasada ? ` (a mais antiga desde ${fmtData(r.mais_antiga_atrasada)})` : ''} · ${r.hoje} para hoje · ${r.concluidas_7d} concluídas em 7 dias\n${pp}`, dados: r };
    }
    if (nome === 'listar_tarefas') {
      let t = await db.listar(a.arquivadas ? { arquivadas: true } : {});
      if (!a.arquivadas && !a.incluir_feitas && !a.estado) t = t.filter((x) => x.estado !== 'done');
      if (a.estado) t = t.filter((x) => x.estado === a.estado);
      if (a.dono) t = t.filter((x) => x.dono === a.dono);
      if (a.busca) { const b = String(a.busca).toLowerCase(); t = t.filter((x) => [x.titulo, x.notas, x.referencia, x.cidade, x.resultado].join(' ').toLowerCase().includes(b)); }
      t.sort((x, y) => String(x.vence_em || '9999').localeCompare(String(y.vence_em || '9999')));
      return { texto: t.length ? t.slice(0, 60).map(linha).join('\n') + (t.length > 60 ? `\n… e mais ${t.length - 60}` : '') : 'Nenhuma tarefa com esses filtros.', dados: { total: t.length, tarefas: t.slice(0, 60).map((x) => ({ id: x.id, titulo: x.titulo, estado: x.estado, dono: x.dono, vence_em: x.vence_em, area: x.area, etapas_feitas: x.etapas.filter((e) => e.feita).length, etapas: x.etapas.length })) } };
    }
    if (nome === 'ver_tarefa') {
      const t = await db.obter(a.id);
      if (!t) return { erro: `Tarefa ${a.id} não existe.` };
      const ev = (await db.eventos(a.id, 20)).map((e) => `${String(e.ts).slice(0, 16).replace('T', ' ')} ${e.tipo} (${e.quem})`);
      return { texto: `${ficha(t)}\n\nÚltimos eventos:\n${ev.join('\n') || '(nenhum)'}`, dados: t };
    }
    if (nome === 'criar_tarefa') {
      const etapas = (a.etapas || []).map((s) => ({ texto: String(s), feita: false }));
      const t = await db.criar({ titulo: a.titulo, dono: a.dono, area: a.area, vence_em: a.vence_em || null, estado: 'todo', etapas, notas: a.notas || '', prioridade: a.prioridade, cidade: a.cidade, canal: a.canal, referencia: a.referencia, origem }, quem, trace);
      await db.conversaGravar({ quem: ident.id, canal: 'mcp', papel: 'planejador', texto: `Card ${t.id} criado pelo Claude para ${nomeDe(t.dono)}: ${t.titulo}`, tarefa_id: t.id, trace_id: trace });
      return { texto: `Criado ${t.id} em "A fazer" para ${nomeDe(t.dono)}${t.vence_em ? `, até ${fmtData(t.vence_em)}` : ''}, com ${t.etapas.length} etapas.\n${ficha(t)}`, dados: t };
    }
    if (nome === 'atualizar_tarefa') {
      const antes = await db.obter(a.id);
      if (!antes) return { erro: `Tarefa ${a.id} não existe.` };
      const patch = {};
      for (const k of ['estado', 'dono', 'vence_em', 'titulo', 'area', 'notas', 'resultado', 'prioridade', 'cidade', 'canal', 'referencia']) if (a[k] !== undefined) patch[k] = a[k];
      if (Array.isArray(a.etapas)) patch.etapas = a.etapas.map((s) => ({ texto: String(s), feita: false }));
      if (Array.isArray(a.etapas_feitas) && a.etapas_feitas.length) {
        const base = patch.etapas || antes.etapas.map((e) => ({ ...e }));
        for (const n of a.etapas_feitas) { if (!base[n - 1]) return { erro: `Etapa ${n} não existe (a tarefa tem ${base.length}).` }; base[n - 1].feita = true; }
        patch.etapas = base;
      }
      if (!Object.keys(patch).length) return { erro: 'Nada para mudar: informe ao menos um campo.' };
      const t = await db.atualizar(a.id, patch, quem, trace);
      return { texto: `Atualizado.\n${ficha(t)}`, dados: t };
    }
    if (nome === 'planejar') {
      const texto = String(a.texto || '').trim();
      const p = await planejador.decompor(texto, { donoPadrao: store.PESSOAS[ident.id] ? ident.id : null });
      await db.conversaGravar({ quem: ident.id, canal: 'mcp', papel: 'pessoa', texto, trace_id: trace });
      await db.conversaGravar({ quem: ident.id, canal: 'mcp', papel: 'planejador', proposta: p, trace_id: trace });
      return { texto: `Proposta (não gravada):\nTítulo: ${p.titulo}\nÁrea: ${p.area}\nQuem: ${p.dono ? nomeDe(p.dono) : 'não dito — pergunte'}${p.pessoa_citada ? '' : p.dono ? ' (padrão, confirme)' : ''}\nPrazo: ${p.vence_em ? fmtData(p.vence_em) : 'não dito'}\nEtapas:\n${p.etapas.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}${p.motivo ? `\nMotivo: ${p.motivo}` : ''}\nOrigem: ${p.origem_modelo ? 'modelo' : 'padrão da área'}`, dados: p };
    }
    if (nome === 'sugestoes') {
      const s = await sugestoesAtuais(!!a.atualizar);
      const vivas = s.itens.filter((x) => !x.decisao);
      const lac = (s.cobertura || []).filter((c) => !c.ok).map((c) => `${c.fonte}${c.lacuna ? ` (${c.lacuna})` : ''}`);
      return { texto: (vivas.length ? vivas.map((x) => `${x.id} · ${x.titulo} · ${x.area}${x.prioridade_fixa ? ' · PRIORIDADE' : ''}\n   por quê: ${x.porque} [${x.fonte}]`).join('\n') : 'Nenhuma sugestão pendente.') + (s.marco_zero ? `\nMarco zero: só sinais a partir de ${fmtData(s.marco_zero)}.` : '') + (lac.length ? `\nFontes não lidas agora: ${lac.join(', ')}` : ''), dados: { itens: vivas, marco_zero: s.marco_zero || null, cobertura: s.cobertura } };
    }
    if (nome === 'arquivar_tarefa') {
      let t;
      try { t = await db.arquivar(a.id, quem, trace); } catch (e) { return { erro: e.message }; }
      if (!t) return { erro: `Tarefa ${a.id} não existe.` };
      return { texto: `Arquivada ${t.id} (concluída em ${String(t.concluido_em || '').slice(0, 10)}). Consultável com listar_tarefas(arquivadas=true).`, dados: t };
    }
    if (nome === 'assumir_sugestao') {
      const r = await assumirSugestao(a.id, a.dono, quem, trace, a.vence_em);
      if (r.erro) return { erro: r.erro };
      return { texto: `Sugestão virou o card ${r.tarefa.id} para ${nomeDe(r.tarefa.dono)}, até ${fmtData(r.tarefa.vence_em)}.\n${ficha(r.tarefa)}`, dados: r.tarefa };
    }
    return { erro: `Ferramenta desconhecida: ${nome}` };
  }

  function resposta(id, result) { return { jsonrpc: '2.0', id, result }; }
  function falha(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }

  async function umaMensagem(m, ident, trace) {
    if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return falha(m && m.id, -32600, 'requisição inválida');
    const notificacao = m.id === undefined || m.id === null;
    if (m.method.startsWith('notifications/')) return null;
    if (notificacao) return null;
    if (m.method === 'initialize') {
      const pedida = String(m.params?.protocolVersion || '');
      return resposta(m.id, { protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'compasso-tarefas', title: 'COMPASSO Tarefas', version: build }, instructions: INSTRUCOES });
    }
    if (m.method === 'ping') return resposta(m.id, {});
    if (m.method === 'tools/list') return resposta(m.id, { tools: FERRAMENTAS });
    if (m.method === 'tools/call') {
      const nome = String(m.params?.name || ''); const args = m.params?.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {};
      if (!FERRAMENTAS.some((f) => f.name === nome)) return falha(m.id, -32602, `ferramenta desconhecida: ${nome}`);
      let r;
      try { r = await executar(nome, args, ident, trace); } catch (e) { r = { erro: String(e && e.message || e).slice(0, 300) }; }
      auditar({ tipo: 'mcp', ferramenta: nome, quem: ident.id, cliente: ident.cliente, ok: !r.erro, trace });
      if (r.erro) return resposta(m.id, { content: [{ type: 'text', text: r.erro }], isError: true });
      return resposta(m.id, { content: [{ type: 'text', text: r.texto }], structuredContent: r.dados && typeof r.dados === 'object' && !Array.isArray(r.dados) ? r.dados : undefined });
    }
    if (['resources/list', 'prompts/list', 'resources/templates/list'].includes(m.method)) return resposta(m.id, m.method.startsWith('resources/templates') ? { resourceTemplates: [] } : m.method.startsWith('resources') ? { resources: [] } : { prompts: [] });
    return falha(m.id, -32601, `método não suportado: ${m.method}`);
  }

  /** Trata POST/GET/DELETE /mcp. `ident` já validada pelo servidor. */
  async function tratar(req, res, corpo, ident, trace) {
    const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    if (req.method === 'DELETE') return json(200, { ok: true });
    if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST, DELETE' }); return res.end(); }
    const lote = Array.isArray(corpo);
    const msgs = lote ? corpo : [corpo];
    if (!msgs.length) return json(400, falha(null, -32600, 'lote vazio'));
    const saidas = [];
    for (const m of msgs) { const r = await umaMensagem(m, ident, trace); if (r) saidas.push(r); }
    if (!saidas.length) return json(202);
    return json(200, lote ? saidas : saidas[0]);
  }

  return { tratar, FERRAMENTAS, executar, VERSOES };
}

module.exports = { criar, VERSOES };
