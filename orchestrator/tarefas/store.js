'use strict';
/**
 * COMPASSO Tarefas — armazenamento do livro único de tarefas.
 *
 * Dois motores com a MESMA interface:
 *   - arquivo (padrão): STATE_DIR/tarefas.json (instantâneo), STATE_DIR/eventos.jsonl (append-only),
 *     STATE_DIR/sugestoes.json. Serve para o dry-run local e para o canário antes da DDL.
 *   - postgres (TAREFAS_DATABASE_URL): tabelas plan_tarefas, plan_eventos, plan_sugestoes (sql/001-plan.sql),
 *     escritas pelo papel twk_plan, que só enxerga essas tabelas. A DDL e o papel exigem a frase do fundador.
 *
 * Regras da casa que o armazenamento impõe (não o prompt):
 *   - todo evento leva quem, quando e trace_id; nada é apagado do ledger de eventos;
 *   - tarefa concluída guarda concluido_em; excluir é um evento, a linha some do instantâneo mas fica no ledger.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ESTADOS = ['todo', 'doing', 'wait', 'done'];
const PESSOAS = { marlon: 'Márlon', lucas: 'Lucas', julien: 'Julien' };
const AREAS = ['Clientes', 'Site', 'Chauffeur', 'Catálogo', 'Operação'];
// Campos do ecossistema (03/11): por onde a conversa acontece, onde a casa/cliente está, qual é o código em jogo.
const CANAIS = ['WhatsApp', 'E-mail', 'Telefone', 'Presencial', 'Sistema'];
const PRIORIDADES = ['alta', 'normal', 'baixa'];

function hoje() { return new Date().toISOString().slice(0, 10); }
/** Próximo id do dia = maior sequência já vista + 1. Nunca conta: uma exclusão não pode fazer o id voltar a ser usado
 *  (o ledger e o histórico do chat apontam para ele). `existentes` deve incluir os ids do ledger do dia. */
function novoId(prefixo, existentes) {
  const dia = hoje().replace(/-/g, '');
  const re = new RegExp(`^${prefixo}-${dia}-(\\d{4})$`);
  let max = 0;
  for (const id of existentes) { const m = re.exec(String(id || '')); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefixo}-${dia}-${String(max + 1).padStart(4, '0')}`;
}

/** Normaliza e valida um rascunho de tarefa. Lança Error com mensagem legível. */
function normalizar(entrada, base) {
  const t = { ...(base || {}) };
  if (entrada.titulo !== undefined) {
    const s = String(entrada.titulo).trim().replace(/\s+/g, ' ');
    if (s.length < 3 || s.length > 300) throw new Error('O título precisa ter entre 3 e 300 caracteres.');
    t.titulo = s;
  }
  if (entrada.area !== undefined) {
    if (!AREAS.includes(entrada.area)) throw new Error(`Área inválida. Use uma de: ${AREAS.join(', ')}.`);
    t.area = entrada.area;
  }
  if (entrada.dono !== undefined) {
    if (entrada.dono !== null && !PESSOAS[entrada.dono]) throw new Error('Toda tarefa é de Márlon, Lucas ou Julien.');
    t.dono = entrada.dono;
  }
  if (entrada.vence_em !== undefined) {
    if (entrada.vence_em !== null && entrada.vence_em !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(entrada.vence_em)) throw new Error('Data inválida (use AAAA-MM-DD).');
    t.vence_em = entrada.vence_em || null;
  }
  if (entrada.estado !== undefined) {
    if (!ESTADOS.includes(entrada.estado)) throw new Error('Status inválido.');
    t.estado = entrada.estado;
  }
  if (entrada.etapas !== undefined) {
    if (!Array.isArray(entrada.etapas) || entrada.etapas.length > 30) throw new Error('Etapas: lista de até 30 itens.');
    t.etapas = entrada.etapas.map((e) => ({ texto: String(e.texto || '').trim().slice(0, 200), feita: !!e.feita })).filter((e) => e.texto);
  }
  if (entrada.notas !== undefined) t.notas = String(entrada.notas || '').slice(0, 2000);
  if (entrada.prioridade !== undefined) { if (!PRIORIDADES.includes(entrada.prioridade)) throw new Error('Prioridade: alta, normal ou baixa.'); t.prioridade = entrada.prioridade; }
  if (entrada.cidade !== undefined) t.cidade = String(entrada.cidade || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (entrada.canal !== undefined) { const c = String(entrada.canal || ''); if (c && !CANAIS.includes(c)) throw new Error(`Canal: ${CANAIS.join(', ')} ou vazio.`); t.canal = c; }
  if (entrada.referencia !== undefined) t.referencia = String(entrada.referencia || '').trim().replace(/\s+/g, ' ').slice(0, 120); // código da reserva, restaurante, hotel, cliente
  if (entrada.resultado !== undefined) t.resultado = String(entrada.resultado || '').slice(0, 1000); // o que ficou feito, preenchido ao concluir
  if (entrada.origem !== undefined) t.origem = entrada.origem && typeof entrada.origem === 'object' ? { tipo: String(entrada.origem.tipo || 'manual'), ref: String(entrada.origem.ref || '') } : { tipo: 'manual', ref: '' };
  if (!t.titulo) throw new Error('Escreva o que precisa ser feito.');
  if (!t.dono) throw new Error('Toda tarefa precisa de alguém que assuma: Márlon, Lucas ou Julien.');
  t.area = t.area || 'Operação';
  t.estado = t.estado || 'todo';
  t.etapas = t.etapas || [];
  t.notas = t.notas || '';
  t.vence_em = t.vence_em || null;
  t.prioridade = t.prioridade || 'normal';
  t.cidade = t.cidade || '';
  t.canal = t.canal || '';
  t.referencia = t.referencia || '';
  t.resultado = t.resultado || '';
  t.arquivada_em = t.arquivada_em || null; // só o arquivar() escreve aqui; voltar de "done" limpa
  return t;
}
const filtrarArquivo = (lista, arquivadas) => lista.filter((t) => (arquivadas === 'todas' ? true : arquivadas ? !!t.arquivada_em : !t.arquivada_em));
function validarMotivo(motivo) { const m = String(motivo || '').trim().replace(/\s+/g, ' '); if (m.length < 5) throw new Error('Excluir exige um motivo (mínimo 5 caracteres).'); return m.slice(0, 300); }

// ------------------------------------------------------------------ motor de arquivo
function motorArquivo(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const F = { tarefas: path.join(stateDir, 'tarefas.json'), eventos: path.join(stateDir, 'eventos.jsonl'), sug: path.join(stateDir, 'sugestoes.json'), conversas: path.join(stateDir, 'conversas.jsonl') };
  const lerJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
  const gravarJson = (f, v) => { const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 1), 'utf8'); fs.renameSync(tmp, f); };
  let tarefas = lerJson(F.tarefas, []);
  let sugestoes = lerJson(F.sug, { geradas_em: null, itens: [] });

  function evento(ev) {
    const linha = { ts: new Date().toISOString(), ...ev };
    fs.appendFileSync(F.eventos, JSON.stringify(linha) + '\n', 'utf8');
    return linha;
  }
  return {
    motor: 'arquivo',
    async pronto() { return true; },
    /** listar(): só as vivas no quadro (não arquivadas). { arquivadas: true } = só o arquivo; 'todas' = tudo. */
    async listar(opts = {}) { return filtrarArquivo(tarefas, opts.arquivadas).map((t) => ({ ...t })); },
    async obter(id) { const t = tarefas.find((x) => x.id === id); return t ? { ...t } : null; },
    async criar(entrada, quem, trace) {
      const t = normalizar(entrada);
      let doLedger = [];
      try { doLedger = fs.readFileSync(F.eventos, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l).tarefa_id; } catch { return null; } }).filter(Boolean); } catch { /* sem ledger ainda */ }
      t.id = novoId('T', [...tarefas.map((x) => x.id), ...doLedger]);
      t.criado_em = new Date().toISOString(); t.criado_por = quem; t.atualizado_em = t.criado_em;
      t.concluido_em = t.estado === 'done' ? t.criado_em : null;
      tarefas.unshift(t); gravarJson(F.tarefas, tarefas);
      evento({ tarefa_id: t.id, tipo: 'criada', quem, trace_id: trace, para: { titulo: t.titulo, dono: t.dono, estado: t.estado, vence_em: t.vence_em } });
      return { ...t };
    },
    async atualizar(id, patch, quem, trace) {
      const i = tarefas.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const antes = tarefas[i];
      const depois = normalizar(patch, antes);
      depois.atualizado_em = new Date().toISOString();
      if (depois.estado === 'done' && antes.estado !== 'done') { depois.concluido_em = depois.atualizado_em; depois.etapas = depois.etapas.map((e) => ({ ...e, feita: true })); }
      if (depois.estado !== 'done') { depois.concluido_em = null; depois.arquivada_em = null; }
      tarefas[i] = depois; gravarJson(F.tarefas, tarefas);
      const mudou = {};
      for (const k of ['titulo', 'area', 'dono', 'vence_em', 'estado', 'notas']) if (JSON.stringify(antes[k]) !== JSON.stringify(depois[k])) mudou[k] = { de: antes[k], para: depois[k] };
      if (JSON.stringify(antes.etapas) !== JSON.stringify(depois.etapas)) mudou.etapas = { de: antes.etapas.filter((e) => e.feita).length + '/' + antes.etapas.length, para: depois.etapas.filter((e) => e.feita).length + '/' + depois.etapas.length };
      if (Object.keys(mudou).length) evento({ tarefa_id: id, tipo: mudou.estado ? 'estado' : 'atualizada', quem, trace_id: trace, mudou });
      return { ...depois };
    },
    // Excluir (03/11): só antes de concluir, sempre com motivo; o ledger guarda a tarefa inteira e o motivo.
    async excluir(id, quem, trace, motivo) {
      const t = tarefas.find((x) => x.id === id);
      if (!t) return false;
      if (t.estado === 'done') throw new Error('Tarefa concluída não se exclui: arquive.');
      const m = validarMotivo(motivo);
      tarefas = tarefas.filter((x) => x.id !== id); gravarJson(F.tarefas, tarefas);
      evento({ tarefa_id: id, tipo: 'excluida', quem, trace_id: trace, motivo: m, de: { ...t } });
      return true;
    },
    // Arquivar (03/11): só concluída; sai do quadro e do calendário, fica consultável em listar({ arquivadas: true }).
    async arquivar(id, quem, trace) {
      const t = tarefas.find((x) => x.id === id);
      if (!t) return null;
      if (t.estado !== 'done') throw new Error('Só tarefa concluída pode ser arquivada.');
      if (!t.arquivada_em) { t.arquivada_em = new Date().toISOString(); t.atualizado_em = t.arquivada_em; gravarJson(F.tarefas, tarefas); evento({ tarefa_id: id, tipo: 'arquivada', quem, trace_id: trace, de: { titulo: t.titulo, concluido_em: t.concluido_em } }); }
      return { ...t };
    },
    async desarquivar(id, quem, trace) {
      const t = tarefas.find((x) => x.id === id);
      if (!t) return null;
      if (t.arquivada_em) { t.arquivada_em = null; t.atualizado_em = new Date().toISOString(); gravarJson(F.tarefas, tarefas); evento({ tarefa_id: id, tipo: 'desarquivada', quem, trace_id: trace }); }
      return { ...t };
    },
    async eventos(id, limite = 200) {
      let linhas = [];
      try { linhas = fs.readFileSync(F.eventos, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* sem ledger ainda */ }
      return (id ? linhas.filter((e) => e.tarefa_id === id) : linhas).slice(-limite);
    },
    async sugestoesLer() { return { ...sugestoes, itens: sugestoes.itens.map((s) => ({ ...s })) }; },
    async sugestoesGravar(itens, extra) { sugestoes = { geradas_em: new Date().toISOString(), marco_zero: (extra && extra.marco_zero) || null, itens }; gravarJson(F.sug, sugestoes); return sugestoes; },
    async sugestaoDecidir(id, decisao, quem, trace, tarefaId) {
      const s = sugestoes.itens.find((x) => x.id === id);
      if (!s) return null;
      s.decisao = decisao; s.decidida_em = new Date().toISOString(); s.decidida_por = quem; if (tarefaId) s.tarefa_id = tarefaId;
      gravarJson(F.sug, sugestoes);
      evento({ tarefa_id: tarefaId || null, tipo: `sugestao_${decisao}`, quem, trace_id: trace, de: { sugestao: id, titulo: s.titulo } });
      return { ...s };
    },
    // Histórico do chat (03/11): append-only, por pessoa. Cada linha é uma mensagem (pessoa ou planejador),
    // com a proposta devolvida e, quando virou card, o id da tarefa. Nada é apagado.
    async conversaGravar(m) {
      const linha = { id: novaConversaId(), ts: new Date().toISOString(), ...m };
      fs.appendFileSync(F.conversas, JSON.stringify(linha) + '\n', 'utf8');
      return linha;
    },
    async conversaLer({ quem, limite = 50 } = {}) {
      let linhas = [];
      try { linhas = fs.readFileSync(F.conversas, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* sem conversa ainda */ }
      return (quem ? linhas.filter((m) => m.quem === quem) : linhas).slice(-limite);
    },
  };
}
function novaConversaId() { return 'c-' + crypto.randomBytes(6).toString('hex'); }

// ------------------------------------------------------------------ motor postgres
function motorPostgres(url) {
  let pg = null;
  try { pg = require('pg'); } catch { throw new Error('TAREFAS_DATABASE_URL definido mas o pacote pg não está instalado.'); }
  const pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 8000 });
  const q = (sql, params) => pool.query(sql, params);
  const linha = (r) => (r ? { ...r.dados, id: r.id } : null);
  async function evento(ev) {
    await q('INSERT INTO plan_eventos (tarefa_id, tipo, quem, trace_id, detalhe) VALUES ($1,$2,$3,$4,$5)', [ev.tarefa_id || null, ev.tipo, ev.quem || null, ev.trace_id || null, JSON.stringify(ev.detalhe || {})]);
  }
  return {
    motor: 'postgres',
    async pronto() { try { await q('SELECT 1 FROM plan_tarefas LIMIT 1'); return true; } catch (e) { throw new Error(`plan_tarefas indisponível: ${e.message}`); } },
    async listar(opts = {}) {
      const arq = opts.arquivadas;
      const cond = arq === 'todas' ? '' : arq ? " AND (dados->>'arquivada_em') IS NOT NULL" : " AND (dados->>'arquivada_em') IS NULL";
      const r = await q(`SELECT id, dados FROM plan_tarefas WHERE excluida_em IS NULL${cond} ORDER BY criado_em DESC`); return r.rows.map(linha);
    },
    async obter(id) { const r = await q('SELECT id, dados FROM plan_tarefas WHERE id=$1 AND excluida_em IS NULL', [id]); return linha(r.rows[0]); },
    async criar(entrada, quem, trace) {
      const t = normalizar(entrada);
      const ids = (await q("SELECT id FROM plan_tarefas WHERE id LIKE $1", [`T-${hoje().replace(/-/g, '')}-%`])).rows.map((r) => r.id);
      t.id = novoId('T', ids);
      t.criado_em = new Date().toISOString(); t.criado_por = quem; t.atualizado_em = t.criado_em; t.concluido_em = t.estado === 'done' ? t.criado_em : null;
      await q('INSERT INTO plan_tarefas (id, dados, estado, dono, vence_em, criado_em, atualizado_em) VALUES ($1,$2,$3,$4,$5,$6,$6)', [t.id, JSON.stringify(t), t.estado, t.dono, t.vence_em, t.criado_em]);
      await evento({ tarefa_id: t.id, tipo: 'criada', quem, trace_id: trace, detalhe: { titulo: t.titulo, dono: t.dono, estado: t.estado, vence_em: t.vence_em } });
      return t;
    },
    async atualizar(id, patch, quem, trace) {
      const antes = await this.obter(id);
      if (!antes) return null;
      const depois = normalizar(patch, antes);
      depois.atualizado_em = new Date().toISOString();
      if (depois.estado === 'done' && antes.estado !== 'done') { depois.concluido_em = depois.atualizado_em; depois.etapas = depois.etapas.map((e) => ({ ...e, feita: true })); }
      if (depois.estado !== 'done') { depois.concluido_em = null; depois.arquivada_em = null; }
      await q('UPDATE plan_tarefas SET dados=$2, estado=$3, dono=$4, vence_em=$5, atualizado_em=$6 WHERE id=$1', [id, JSON.stringify(depois), depois.estado, depois.dono, depois.vence_em, depois.atualizado_em]);
      const mudou = {};
      for (const k of ['titulo', 'area', 'dono', 'vence_em', 'estado', 'notas']) if (JSON.stringify(antes[k]) !== JSON.stringify(depois[k])) mudou[k] = { de: antes[k], para: depois[k] };
      if (JSON.stringify(antes.etapas) !== JSON.stringify(depois.etapas)) mudou.etapas = true;
      if (Object.keys(mudou).length) await evento({ tarefa_id: id, tipo: mudou.estado ? 'estado' : 'atualizada', quem, trace_id: trace, detalhe: mudou });
      return depois;
    },
    async excluir(id, quem, trace, motivo) {
      const t = await this.obter(id);
      if (!t) return false;
      if (t.estado === 'done') throw new Error('Tarefa concluída não se exclui: arquive.');
      const m = validarMotivo(motivo);
      const r = await q('UPDATE plan_tarefas SET excluida_em=now() WHERE id=$1 AND excluida_em IS NULL', [id]);
      if (!r.rowCount) return false;
      await evento({ tarefa_id: id, tipo: 'excluida', quem, trace_id: trace, detalhe: { motivo: m, tarefa: t } });
      return true;
    },
    async arquivar(id, quem, trace) {
      const t = await this.obter(id);
      if (!t) return null;
      if (t.estado !== 'done') throw new Error('Só tarefa concluída pode ser arquivada.');
      if (t.arquivada_em) return t;
      t.arquivada_em = new Date().toISOString(); t.atualizado_em = t.arquivada_em;
      await q('UPDATE plan_tarefas SET dados=$2, atualizado_em=$3 WHERE id=$1', [id, JSON.stringify(t), t.atualizado_em]);
      await evento({ tarefa_id: id, tipo: 'arquivada', quem, trace_id: trace, detalhe: { titulo: t.titulo, concluido_em: t.concluido_em } });
      return t;
    },
    async desarquivar(id, quem, trace) {
      const t = await this.obter(id);
      if (!t) return null;
      if (!t.arquivada_em) return t;
      t.arquivada_em = null; t.atualizado_em = new Date().toISOString();
      await q('UPDATE plan_tarefas SET dados=$2, atualizado_em=$3 WHERE id=$1', [id, JSON.stringify(t), t.atualizado_em]);
      await evento({ tarefa_id: id, tipo: 'desarquivada', quem, trace_id: trace });
      return t;
    },
    async eventos(id, limite = 200) {
      const r = id ? await q('SELECT * FROM plan_eventos WHERE tarefa_id=$1 ORDER BY ts DESC LIMIT $2', [id, limite]) : await q('SELECT * FROM plan_eventos ORDER BY ts DESC LIMIT $1', [limite]);
      return r.rows.reverse();
    },
    async sugestoesLer() { const r = await q('SELECT id, dados FROM plan_sugestoes ORDER BY criado_em DESC'); return { geradas_em: r.rows[0]?.dados?.gerada_em || null, marco_zero: r.rows[0]?.dados?.marco_zero || null, itens: r.rows.map(linha) }; },
    async sugestoesGravar(itens, extra) {
      const agora = new Date().toISOString();
      const marco = (extra && extra.marco_zero) || null;
      for (const s of itens) await q('INSERT INTO plan_sugestoes (id, dados, criado_em) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET dados = plan_sugestoes.dados || $2::jsonb', [s.id, JSON.stringify({ ...s, gerada_em: agora, marco_zero: marco }), agora]);
      return this.sugestoesLer();
    },
    async sugestaoDecidir(id, decisao, quem, trace, tarefaId) {
      const r = await q('UPDATE plan_sugestoes SET dados = dados || $2::jsonb WHERE id=$1 RETURNING id, dados', [id, JSON.stringify({ decisao, decidida_em: new Date().toISOString(), decidida_por: quem, tarefa_id: tarefaId || null })]);
      if (!r.rowCount) return null;
      await evento({ tarefa_id: tarefaId || null, tipo: `sugestao_${decisao}`, quem, trace_id: trace, detalhe: { sugestao: id } });
      return linha(r.rows[0]);
    },
    async conversaGravar(m) {
      const l = { id: novaConversaId(), ts: new Date().toISOString(), ...m };
      await q('INSERT INTO plan_conversas (id, ts, quem, canal, papel, dados) VALUES ($1,$2,$3,$4,$5,$6)', [l.id, l.ts, l.quem || null, l.canal || 'app', l.papel || 'pessoa', JSON.stringify(l)]);
      return l;
    },
    async conversaLer({ quem, limite = 50 } = {}) {
      const r = quem ? await q('SELECT dados FROM plan_conversas WHERE quem=$1 ORDER BY ts DESC LIMIT $2', [quem, limite]) : await q('SELECT dados FROM plan_conversas ORDER BY ts DESC LIMIT $1', [limite]);
      return r.rows.map((x) => x.dados).reverse();
    },
  };
}

function abrir({ stateDir, databaseUrl }) {
  if (databaseUrl) return motorPostgres(databaseUrl);
  return motorArquivo(stateDir);
}

/** Resumo para o relato à Regência e para o cabeçalho do app. */
function resumo(tarefas, diaRef) {
  const dia = diaRef || hoje();
  const abertas = tarefas.filter((t) => t.estado !== 'done');
  const atrasadas = abertas.filter((t) => t.vence_em && t.vence_em < dia);
  const hojeL = abertas.filter((t) => t.vence_em === dia);
  const seteDias = new Date(Date.parse(dia) - 7 * 864e5).toISOString().slice(0, 10);
  const concluidas7 = tarefas.filter((t) => t.estado === 'done' && t.concluido_em && t.concluido_em.slice(0, 10) >= seteDias);
  const porPessoa = {};
  for (const p of Object.keys(PESSOAS)) porPessoa[p] = { abertas: abertas.filter((t) => t.dono === p).length, atrasadas: atrasadas.filter((t) => t.dono === p).length };
  return { abertas: abertas.length, atrasadas: atrasadas.length, hoje: hojeL.length, concluidas_7d: concluidas7.length, por_pessoa: porPessoa, mais_antiga_atrasada: atrasadas.map((t) => t.vence_em).sort()[0] || null };
}

module.exports = { abrir, normalizar, resumo, ESTADOS, PESSOAS, AREAS, CANAIS, PRIORIDADES, hoje, novoId, _hash: (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10) };
