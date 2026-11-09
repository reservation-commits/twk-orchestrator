'use strict';
/**
 * COMPASSO Tarefas — o livro único de tarefas.
 *
 * Duas camadas, para os motores nunca mais divergirem:
 *   - LIVRO (criarLivro): todas as regras da casa. Normaliza, versiona, compara, decide o evento, aplica recorrência,
 *     detecta conflito de edição e avisa quem está ouvindo. É um só, para os dois motores.
 *   - PERSISTÊNCIA: só guarda e devolve.
 *       · arquivo (padrão): STATE_DIR/eventos.jsonl é a VERDADE (append-only, gravado e sincronizado antes de qualquer
 *         resposta); tarefas.json é um instantâneo atômico para abrir rápido. Ao subir: instantâneo + ledger. Arquivo
 *         corrompido é guardado como prova e o livro é reconstruído; se nada servir, o serviço para e diz por quê.
 *         Nunca abre um quadro vazio em cima de dados que existiam.
 *       · postgres (TAREFAS_DATABASE_URL): tabelas plan_* (sql/001-plan.sql), papel twk_plan. A DDL exige a frase do fundador.
 *
 * Regras que o armazenamento impõe (não o prompt):
 *   - toda mudança de qualquer campo vira evento com quem, quando e trace_id; nada é apagado do ledger;
 *   - dois editando o mesmo card nunca se sobrescrevem em silêncio: mudanças em campos diferentes se somam;
 *     no mesmo campo, a segunda recebe conflito (409) com o valor atual;
 *   - concluir marca as etapas e guarda o que estava marcado; voltar atrás restaura.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const nucleo = require('./public/nucleo.js');

const ESTADOS = ['todo', 'doing', 'wait', 'done'];
const PESSOAS = { marlon: 'Márlon', lucas: 'Lucas', julien: 'Julien' };
const AREAS = ['Clientes', 'Site', 'Chauffeur', 'Catálogo', 'Operação'];
const CANAIS = ['WhatsApp', 'E-mail', 'Telefone', 'Presencial', 'Sistema'];
const PRIORIDADES = ['alta', 'normal', 'baixa'];
const REPETICOES = ['', 'diaria', 'dias_uteis', 'semanal', 'mensal'];
// Fuso da empresa. "Hoje" é sempre o dia em Paris, nunca o dia em UTC (das 23h à meia-noite o app errava a data).
const FUSO = process.env.TAREFAS_FUSO || nucleo.FUSO_PADRAO;
const CAMPOS_RASTREADOS = ['titulo', 'area', 'dono', 'vence_em', 'estado', 'notas', 'prioridade', 'cidade', 'canal', 'referencia', 'resultado', 'aguardando_quem', 'cobrar_em', 'repete'];
const CAMPOS_COM_BASE = [...CAMPOS_RASTREADOS, 'etapas'];
const LIMITE_ETAPAS = 30;

function hoje(agora) { return nucleo.hoje(FUSO, agora); }

/** Próximo id do dia = maior sequência já vista + 1. Uma exclusão não faz o id voltar a ser usado (o ledger aponta para ele). */
function novoId(prefixo, existentes) {
  const dia = hoje().replace(/-/g, '');
  const re = new RegExp(`^${prefixo}-${dia}-(\\d{4})$`);
  let max = 0;
  for (const id of existentes) { const m = re.exec(String(id || '')); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefixo}-${dia}-${String(max + 1).padStart(4, '0')}`;
}
const idEtapa = () => 'e' + crypto.randomBytes(4).toString('hex');
const idComentario = () => 'm' + crypto.randomBytes(5).toString('hex');
const semValor = (v) => v === undefined || v === null || v === '';
/** Campo que não existia e campo vazio são a mesma coisa: card antigo não pode gerar evento nem conflito por isso. */
const igual = (a, b) => (semValor(a) && semValor(b)) || JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Etapas antigas não têm id: ganham um estável pela posição até a próxima escrita. */
function comIds(t) {
  if (!t) return t;
  if (Array.isArray(t.etapas) && t.etapas.some((e) => !e.id)) t.etapas = t.etapas.map((e, i) => (e.id ? e : { ...e, id: `i${i}` }));
  return t;
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
    if (entrada.vence_em !== null && entrada.vence_em !== '' && !nucleo.dataValida(entrada.vence_em)) throw new Error('Data inválida (use AAAA-MM-DD).');
    t.vence_em = entrada.vence_em || null;
  }
  if (entrada.estado !== undefined) {
    if (!ESTADOS.includes(entrada.estado)) throw new Error('Status inválido.');
    t.estado = entrada.estado;
  }
  if (entrada.etapas !== undefined) {
    if (!Array.isArray(entrada.etapas) || entrada.etapas.length > LIMITE_ETAPAS) throw new Error(`Etapas: lista de até ${LIMITE_ETAPAS} itens.`);
    t.etapas = entrada.etapas.map((e) => {
      if (!e || typeof e !== 'object') throw new Error('Etapa inválida: cada uma precisa de texto.');
      return { id: String(e.id || idEtapa()).slice(0, 20), texto: String(e.texto || '').trim().slice(0, 200), feita: !!e.feita };
    }).filter((e) => e.texto);
  }
  if (entrada.notas !== undefined) t.notas = String(entrada.notas || '').slice(0, 4000);
  if (entrada.prioridade !== undefined) { if (!PRIORIDADES.includes(entrada.prioridade)) throw new Error('Prioridade: alta, normal ou baixa.'); t.prioridade = entrada.prioridade; }
  if (entrada.cidade !== undefined) t.cidade = String(entrada.cidade || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (entrada.canal !== undefined) { const c = String(entrada.canal || ''); if (c && !CANAIS.includes(c)) throw new Error(`Canal: ${CANAIS.join(', ')} ou vazio.`); t.canal = c; }
  if (entrada.referencia !== undefined) t.referencia = String(entrada.referencia || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (entrada.resultado !== undefined) t.resultado = String(entrada.resultado || '').slice(0, 1000);
  if (entrada.aguardando_quem !== undefined) t.aguardando_quem = String(entrada.aguardando_quem || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (entrada.cobrar_em !== undefined) {
    if (entrada.cobrar_em !== null && entrada.cobrar_em !== '' && !nucleo.dataValida(entrada.cobrar_em)) throw new Error('Data de cobrança inválida (use AAAA-MM-DD).');
    t.cobrar_em = entrada.cobrar_em || null;
  }
  if (entrada.repete !== undefined) { if (!REPETICOES.includes(entrada.repete || '')) throw new Error('Repetição: diaria, dias_uteis, semanal, mensal ou vazio.'); t.repete = entrada.repete || ''; }
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
  t.aguardando_quem = t.aguardando_quem || '';
  t.cobrar_em = t.cobrar_em || null;
  t.repete = t.repete || '';
  t.comentarios = t.comentarios || [];
  t.arquivada_em = t.arquivada_em || null; // só o arquivar() escreve aqui; voltar de "done" limpa
  return t;
}
const filtrarArquivo = (lista, arquivadas) => lista.filter((t) => (arquivadas === 'todas' ? true : arquivadas ? !!t.arquivada_em : !t.arquivada_em));
function validarMotivo(motivo) { const m = String(motivo || '').trim().replace(/\s+/g, ' '); if (m.length < 5) throw new Error('Excluir exige um motivo (mínimo 5 caracteres).'); return m.slice(0, 300); }

/** Operações sobre etapas: duas pessoas marcando etapas diferentes nunca entram em conflito. */
function aplicarOpsEtapas(etapas, ops) {
  let lista = (etapas || []).map((e) => ({ ...e }));
  for (const op of ops || []) {
    if (!op || typeof op !== 'object') continue;
    const i = lista.findIndex((e) => e.id === op.id);
    if (op.op === 'marcar' && i >= 0) lista[i].feita = !!op.feita;
    else if (op.op === 'texto' && i >= 0) { const s = String(op.texto || '').trim().slice(0, 200); if (s) lista[i].texto = s; }
    else if (op.op === 'del' && i >= 0) lista.splice(i, 1);
    else if (op.op === 'add') {
      const s = String(op.texto || '').trim().slice(0, 200);
      if (!s) continue;
      if (lista.length >= LIMITE_ETAPAS) throw new Error(`Etapas: lista de até ${LIMITE_ETAPAS} itens.`);
      const nova = { id: op.novo_id && /^[a-z0-9-]{4,20}$/i.test(op.novo_id) ? op.novo_id : idEtapa(), texto: s, feita: false };
      const apos = lista.findIndex((e) => e.id === op.apos);
      if (apos >= 0) lista.splice(apos + 1, 0, nova); else lista.push(nova);
    } else if (op.op === 'mover' && i >= 0) {
      const [e] = lista.splice(i, 1);
      lista.splice(Math.max(0, Math.min(lista.length, Number(op.para) || 0)), 0, e);
    }
  }
  return lista;
}

class ErroConflito extends Error {
  constructor(campos, tarefa) { super(`Outra pessoa acabou de mudar: ${campos.join(', ')}.`); this.conflito = campos; this.tarefa = tarefa; }
}

function diffEventos(antes, depois) {
  const mudou = {};
  for (const k of CAMPOS_RASTREADOS) if (!igual(antes[k], depois[k])) mudou[k] = { de: antes[k] ?? null, para: depois[k] ?? null };
  if (!igual(antes.etapas, depois.etapas)) mudou.etapas = { de: `${(antes.etapas || []).filter((e) => e.feita).length}/${(antes.etapas || []).length}`, para: `${depois.etapas.filter((e) => e.feita).length}/${depois.etapas.length}` };
  return mudou;
}

// ------------------------------------------------------------------ o livro (regras, um só para os dois motores)
function criarLivro(p) {
  const ouvintes = new Set();
  // Tudo que muda passa por esta fila: uma escrita por vez, na ordem em que chegou (instância única).
  let fila = Promise.resolve();
  const emSerie = (fn) => { const r = fila.then(fn); fila = r.catch(() => {}); return r; };
  const avisar = (ev, tarefa) => { for (const f of ouvintes) { try { f({ seq: ev.seq, ts: ev.ts, tipo: ev.tipo, tarefa_id: ev.tarefa_id, quem: ev.quem, tarefa: tarefa || null, mudou: ev.mudou || null, mencoes: ev.mencoes || null }); } catch { /* ouvinte nunca derruba escrita */ } } };

  async function inserir(t, quem, trace, extra) {
    const ids = await p.idsDoDia(`T-${hoje().replace(/-/g, '')}-`);
    t.id = novoId('T', ids);
    t.versao = 1;
    t.criado_em = new Date().toISOString(); t.criado_por = quem; t.atualizado_em = t.criado_em;
    t.concluido_em = t.estado === 'done' ? t.criado_em : null;
    const ev = await p.inserir(t, { tarefa_id: t.id, tipo: 'criada', quem, trace_id: trace, para: { titulo: t.titulo, dono: t.dono, estado: t.estado, vence_em: t.vence_em }, ...(extra || {}) });
    avisar(ev, t);
    return { ...t };
  }

  async function aplicarMudanca(id, patch, quem, trace, opts) {
    const antes = comIds(await p.obter(id));
    if (!antes) return null;
    const base = (opts && opts.base) || null;
    if (base) {
      const campos = CAMPOS_COM_BASE.filter((k) => patch[k] !== undefined && k in base && !igual(antes[k], base[k]) && !igual(antes[k], patch[k]));
      if (campos.length) throw new ErroConflito(campos, { ...antes });
    }
    const entrada = { ...patch };
    delete entrada.etapas_ops; delete entrada.base; delete entrada.versao;
    if (Array.isArray(patch.etapas_ops) && patch.etapas_ops.length) entrada.etapas = aplicarOpsEtapas(antes.etapas, patch.etapas_ops);
    const depois = normalizar(entrada, antes);
    const agora = new Date().toISOString();
    depois.atualizado_em = agora;
    depois.versao = (antes.versao || 0) + 1;
    if (depois.estado === 'done' && antes.estado !== 'done') {
      depois.concluido_em = agora;
      depois.etapas_antes_concluir = depois.etapas.filter((e) => e.feita).map((e) => e.id);
      depois.etapas = depois.etapas.map((e) => ({ ...e, feita: true }));
    }
    if (depois.estado !== 'done') {
      depois.concluido_em = null; depois.arquivada_em = null;
      if (antes.estado === 'done' && Array.isArray(antes.etapas_antes_concluir) && entrada.etapas === undefined) {
        const feitas = new Set(antes.etapas_antes_concluir);
        depois.etapas = depois.etapas.map((e) => ({ ...e, feita: feitas.has(e.id) }));
      }
      delete depois.etapas_antes_concluir;
    }
    if (depois.estado !== 'wait' && antes.estado === 'wait') {
      if (patch.aguardando_quem === undefined) depois.aguardando_quem = '';
      if (patch.cobrar_em === undefined) depois.cobrar_em = null;
    }
    // Recorrência: concluir cria a próxima, uma vez só (reabrir e concluir de novo não duplica).
    let proxima = null;
    if (depois.estado === 'done' && antes.estado !== 'done' && depois.repete && !depois.proxima_id) {
      const venc = nucleo.proximaData(antes.vence_em || hoje(), depois.repete, hoje());
      const nova = normalizar({ titulo: depois.titulo, area: depois.area, dono: depois.dono, vence_em: venc, estado: 'todo', etapas: depois.etapas.map((e) => ({ texto: e.texto, feita: false })), notas: depois.notas, prioridade: depois.prioridade, cidade: depois.cidade, canal: depois.canal, referencia: depois.referencia, repete: depois.repete, origem: { tipo: 'recorrencia', ref: id } });
      proxima = await inserir(nova, quem, trace, { recorrencia_de: id });
      depois.proxima_id = proxima.id;
    }
    const mudou = diffEventos(antes, depois);
    if (!Object.keys(mudou).length && !proxima) return { ...antes };
    const ev = await p.gravar(depois, { tarefa_id: id, tipo: mudou.estado ? 'estado' : 'atualizada', quem, trace_id: trace, mudou, ...(proxima ? { proxima_id: proxima.id } : {}) });
    avisar(ev, depois);
    return { ...depois };
  }

  return {
    get motor() { return p.motor; },
    pronto: () => p.pronto(),
    saude: () => (p.saude ? p.saude() : {}),
    copiar: (destino) => (p.copiar ? p.copiar(destino) : null),
    gravarAgora: () => (p.gravarAgora ? p.gravarAgora() : null),
    assinar(f) { ouvintes.add(f); return () => ouvintes.delete(f); },
    ultimoSeq: () => p.ultimoSeq(),
    /** listar(): só as vivas no quadro (não arquivadas). { arquivadas: true } = só o arquivo; 'todas' = tudo. */
    async listar(opts = {}) { return filtrarArquivo((await p.todas()).map(comIds), opts.arquivadas).map((t) => ({ ...t })); },
    async obter(id) { const t = comIds(await p.obter(id)); return t ? { ...t } : null; },
    criar(entrada, quem, trace) { return emSerie(() => inserir(normalizar(entrada), quem, trace)); },
    atualizar(id, patch, quem, trace, opts) { return emSerie(() => aplicarMudanca(id, patch, quem, trace, opts)); },
    // Excluir: só antes de concluir, sempre com motivo; o ledger guarda a tarefa inteira e o motivo.
    excluir(id, quem, trace, motivo) {
      return emSerie(async () => {
        const t = await p.obter(id);
        if (!t) return false;
        if (t.estado === 'done') throw new Error('Tarefa concluída não se exclui: arquive.');
        const m = validarMotivo(motivo);
        const ev = await p.remover(id, { tarefa_id: id, tipo: 'excluida', quem, trace_id: trace, motivo: m, de: { ...t } });
        if (!ev) return false;
        avisar(ev, null);
        return true;
      });
    },
    arquivar(id, quem, trace) {
      return emSerie(async () => {
        const t = await p.obter(id);
        if (!t) return null;
        if (t.estado !== 'done') throw new Error('Só tarefa concluída pode ser arquivada.');
        if (t.arquivada_em) return { ...t };
        const n = { ...t, arquivada_em: new Date().toISOString(), versao: (t.versao || 0) + 1 }; n.atualizado_em = n.arquivada_em;
        const ev = await p.gravar(n, { tarefa_id: id, tipo: 'arquivada', quem, trace_id: trace, de: { titulo: t.titulo, concluido_em: t.concluido_em } });
        avisar(ev, n);
        return { ...n };
      });
    },
    desarquivar(id, quem, trace) {
      return emSerie(async () => {
        const t = await p.obter(id);
        if (!t) return null;
        if (!t.arquivada_em) return { ...t };
        const n = { ...t, arquivada_em: null, atualizado_em: new Date().toISOString(), versao: (t.versao || 0) + 1 };
        const ev = await p.gravar(n, { tarefa_id: id, tipo: 'desarquivada', quem, trace_id: trace });
        avisar(ev, n);
        return { ...n };
      });
    },
    // Comentário: fica no card e no ledger, nunca se edita nem se apaga. @nome marca a pessoa nas novidades dela.
    comentar(id, texto, quem, trace) {
      return emSerie(async () => {
        const t = comIds(await p.obter(id));
        if (!t) return null;
        const s = String(texto || '').trim().slice(0, 2000);
        if (s.length < 1) throw new Error('Escreva o comentário.');
        const mencoes = Object.keys(PESSOAS).filter((k) => new RegExp(`@${k === 'marlon' ? 'm[áa]rlon' : k}\\b`, 'i').test(s));
        const c = { id: idComentario(), quem, ts: new Date().toISOString(), texto: s };
        const n = { ...t, comentarios: [...(t.comentarios || []), c], atualizado_em: c.ts, versao: (t.versao || 0) + 1 };
        const ev = await p.gravar(n, { tarefa_id: id, tipo: 'comentario', quem, trace_id: trace, texto: s, mencoes });
        avisar(ev, n);
        return { ...n };
      });
    },
    eventos: (id, limite = 200) => p.eventos(id, limite),
    sugestoesLer: () => p.sugestoesLer(),
    sugestoesGravar: (itens, extra) => p.sugestoesGravar(itens, extra),
    async sugestaoDecidir(id, decisao, quem, trace, tarefaId) {
      const s = await p.sugestaoGravarDecisao(id, { decisao, decidida_em: new Date().toISOString(), decidida_por: quem, ...(tarefaId ? { tarefa_id: tarefaId } : {}) });
      if (!s) return null;
      await p.registrar({ tarefa_id: tarefaId || null, tipo: `sugestao_${decisao}`, quem, trace_id: trace, de: { sugestao: id, titulo: s.titulo } });
      return s;
    },
    conversaGravar: (m) => p.conversaGravar(m),
    conversaLer: (o) => p.conversaLer(o),
  };
}

// ------------------------------------------------------------------ persistência em arquivo
function lerJsonEstrito(f) {
  if (!fs.existsSync(f)) return { existe: false };
  try { return { existe: true, valor: JSON.parse(fs.readFileSync(f, 'utf8')) }; }
  catch (e) { return { existe: true, erro: e.message }; }
}

function persistenciaArquivo(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const F = { tarefas: path.join(stateDir, 'tarefas.json'), eventos: path.join(stateDir, 'eventos.jsonl'), sug: path.join(stateDir, 'sugestoes.json'), conversas: path.join(stateDir, 'conversas.jsonl'), backups: path.join(stateDir, 'backups'), recuperacao: path.join(stateDir, 'recuperacao.json') };
  const gravarJson = (f, v) => { const tmp = `${f}.${process.pid}.tmp`; const fd = fs.openSync(tmp, 'w'); try { fs.writeFileSync(fd, JSON.stringify(v)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, f); };

  const mapa = new Map();
  const indice = new Map(); // tarefa_id → eventos (sem o card inteiro), para o histórico responder sem varrer o disco
  const idsVistos = new Set();
  let geral = [];
  let seq = 0;
  let fatal = null;
  let ledgerSujo = false;
  const saudeLivro = { recuperado: null, linhas_ilegiveis: 0, corrompido_em: null };
  let sugestoes = { geradas_em: null, itens: [] };

  function indexar(ev) {
    const { depois: _d, ...leve } = ev;
    geral.push(leve);
    if (ev.tarefa_id) { idsVistos.add(ev.tarefa_id); if (!indice.has(ev.tarefa_id)) indice.set(ev.tarefa_id, []); indice.get(ev.tarefa_id).push(leve); }
  }

  /** Abre o livro: instantâneo + ledger. O ledger sempre vence, porque foi gravado antes de qualquer resposta. */
  function abrirLivro() {
    let base = [];
    let bruto = null;
    try { bruto = fs.readFileSync(F.eventos, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') { fatal = `eventos.jsonl ilegível: ${e.message}`; return; } }
    const inst = lerJsonEstrito(F.tarefas);
    const instantaneoBom = inst.existe && !inst.erro && Array.isArray(inst.valor);
    // Instantâneo ruim, ou sumiu com o ledger ainda ali: reconstruir. Sem nada disso, é um livro novo de verdade.
    const recuperando = !instantaneoBom && (inst.existe || !!(bruto && bruto.trim()));
    let copiaUsada = null;
    if (instantaneoBom) base = inst.valor;
    else if (recuperando) {
      const copias = fs.existsSync(F.backups) ? fs.readdirSync(F.backups).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
      for (const d of copias) {
        const c = lerJsonEstrito(path.join(F.backups, d, 'tarefas.json'));
        if (c.existe && !c.erro && Array.isArray(c.valor)) { base = c.valor; copiaUsada = d; break; }
      }
    }
    for (const t of [...base].reverse()) if (t && t.id) { mapa.set(t.id, comIds(t)); idsVistos.add(t.id); }

    const linhas = bruto === null ? [] : bruto.split(/\r?\n/);
    let tinhaLedger = false;
    for (const l of linhas) {
      if (!l.trim()) continue;
      let ev;
      try { ev = JSON.parse(l); } catch { saudeLivro.linhas_ilegiveis += 1; continue; } // linha cortada por queda: o resto do ledger segue valendo
      tinhaLedger = true;
      seq = Math.max(seq + 1, Number(ev.seq) || 0);
      ev.seq = seq;
      indexar(ev);
      if (ev.depois && ev.depois.id) {
        // Mais novo vence: protege o caso de um instantâneo escrito por uma versão anterior depois deste evento.
        const atual = mapa.get(ev.depois.id);
        if (!atual || !atual.atualizado_em || !ev.depois.atualizado_em || ev.depois.atualizado_em >= atual.atualizado_em) mapa.set(ev.depois.id, comIds(ev.depois));
      } else if (ev.tipo === 'excluida') mapa.delete(ev.tarefa_id);
      else if (recuperando) reconstruirDeEventoAntigo(ev);
    }
    if (recuperando) {
      // Nada de onde reconstruir: o arquivo fica intacto e o serviço segue parado a cada reinício, até alguém restaurar.
      if (!copiaUsada && !tinhaLedger) { fatal = 'tarefas.json ilegível, sem cópia válida e sem ledger: nada a reconstruir. O arquivo original está intacto; restaure à mão.'; return; }
      const quando = new Date().toISOString();
      const registro = { em: quando, de: copiaUsada ? `cópia de ${copiaUsada} + ledger` : 'ledger', motivo: inst.existe ? (inst.erro || 'não é uma lista') : 'tarefas.json ausente', prova: null };
      if (inst.existe) { registro.prova = `tarefas.json.corrompido-${quando.replace(/[:.]/g, '-')}`; fs.copyFileSync(F.tarefas, path.join(stateDir, registro.prova)); }
      console.error(`[livro] ERRO: ${registro.motivo}. Livro reconstruído de: ${registro.de}.${registro.prova ? ` Original guardado em ${registro.prova}.` : ''}`);
      // O aviso sobrevive a reinícios por 7 dias: uma recuperação não pode sumir porque o serviço subiu de novo.
      gravarJson(F.recuperacao, registro);
      gravarJson(F.tarefas, [...mapa.values()].reverse());
    }
    const r = lerJsonEstrito(F.recuperacao);
    if (r.existe && !r.erro && r.valor && Date.now() - Date.parse(r.valor.em) < 7 * 864e5) { saudeLivro.recuperado = r.valor.de; saudeLivro.corrompido_em = r.valor.prova; saudeLivro.recuperado_em = r.valor.em; }
    // Queda no meio de uma escrita deixa a última linha sem fim: sem esta quebra, o próximo evento se colaria nela e se perderia.
    if (bruto && !bruto.endsWith('\n')) fs.appendFileSync(F.eventos, '\n', 'utf8');
  }
  /** Eventos gravados antes do ledger completo (até 0.4.0) têm só parte do card: melhor o esqueleto do que nada. */
  function reconstruirDeEventoAntigo(ev) {
    if (ev.tipo === 'criada' && ev.para && !mapa.has(ev.tarefa_id)) {
      mapa.set(ev.tarefa_id, { id: ev.tarefa_id, titulo: ev.para.titulo || ev.tarefa_id, dono: ev.para.dono || 'marlon', estado: ev.para.estado || 'todo', vence_em: ev.para.vence_em || null, area: 'Operação', etapas: [], notas: 'Reconstruída do ledger depois de uma pane: conferir etapas e notas.', prioridade: 'normal', cidade: '', canal: '', referencia: '', resultado: '', comentarios: [], arquivada_em: null, criado_em: ev.ts, criado_por: ev.quem, atualizado_em: ev.ts, concluido_em: ev.para.estado === 'done' ? ev.ts : null, versao: 1, recuperada: true });
    } else if (mapa.has(ev.tarefa_id)) {
      const t = mapa.get(ev.tarefa_id);
      if (ev.mudou) {
        for (const [k, v] of Object.entries(ev.mudou)) if (k !== 'etapas' && v && 'para' in v) t[k] = v.para;
        if (ev.mudou.estado) { t.concluido_em = ev.mudou.estado.para === 'done' ? ev.ts : null; if (ev.mudou.estado.para !== 'done') t.arquivada_em = null; }
      }
      if (ev.tipo === 'arquivada') t.arquivada_em = ev.ts;
      if (ev.tipo === 'desarquivada') t.arquivada_em = null;
    }
  }
  abrirLivro();
  const sg = lerJsonEstrito(F.sug);
  if (sg.existe && !sg.erro && sg.valor && Array.isArray(sg.valor.itens)) sugestoes = sg.valor;

  // Instantâneo: logo depois da escrita, sem segurar a resposta. Sempre a partir da memória, que já passou pelo ledger.
  let pendente = null;
  const gravarInstantaneo = () => { if (pendente) { clearTimeout(pendente); pendente = null; } if (!fatal) gravarJson(F.tarefas, [...mapa.values()].reverse()); };
  const agendar = () => { if (pendente) return; pendente = setTimeout(() => { pendente = null; try { gravarInstantaneo(); } catch (e) { console.error('[livro] instantâneo falhou (o ledger está íntegro):', e.message); } }, 250); if (pendente.unref) pendente.unref(); };

  function anexar(ev) {
    seq += 1;
    const linha = { seq, ts: new Date().toISOString(), ...ev };
    const fd = fs.openSync(F.eventos, 'a');
    // Escrita que falhou no meio (disco cheio) pode deixar meia linha: a seguinte começa numa linha nova.
    try { fs.writeFileSync(fd, (ledgerSujo ? '\n' : '') + JSON.stringify(linha) + '\n'); fs.fdatasyncSync(fd); ledgerSujo = false; }
    catch (e) { ledgerSujo = true; seq -= 1; throw e; }
    finally { fs.closeSync(fd); }
    indexar(linha);
    const { depois: _d, ...leve } = linha;
    return leve;
  }
  const exigirVivo = () => { if (fatal) throw new Error(`Livro indisponível: ${fatal}`); };

  return {
    motor: 'arquivo',
    async pronto() { if (fatal) throw new Error(fatal); return true; },
    saude: () => ({ tarefas: mapa.size, eventos: seq, recuperado: saudeLivro.recuperado, recuperado_em: saudeLivro.recuperado_em || null, linhas_ilegiveis: saudeLivro.linhas_ilegiveis, corrompido_em: saudeLivro.corrompido_em || null, fatal }),
    gravarAgora: gravarInstantaneo,
    ultimoSeq: async () => seq,
    idsDoDia: async (prefixo) => [...idsVistos].filter((i) => i.startsWith(prefixo)),
    todas: async () => [...mapa.values()].reverse(),
    obter: async (id) => { const t = mapa.get(id); return t ? { ...t } : null; },
    async inserir(t, ev) { exigirVivo(); const e = anexar({ ...ev, depois: t }); mapa.set(t.id, t); idsVistos.add(t.id); agendar(); return e; },
    async gravar(t, ev) { exigirVivo(); const e = anexar({ ...ev, depois: t }); mapa.set(t.id, t); agendar(); return e; },
    async remover(id, ev) { exigirVivo(); const e = anexar(ev); mapa.delete(id); agendar(); return e; },
    async registrar(ev) { exigirVivo(); return anexar(ev); },
    eventos: async (id, limite = 200) => (id ? (indice.get(id) || []) : geral).slice(-limite).map((e) => ({ ...e })),
    /** Cópia do livro. Só copia o que sabe que está íntegro: grava o instantâneo da memória antes de copiar. */
    copiar(dia) {
      if (fatal) return null;
      gravarInstantaneo();
      const dir = path.join(F.backups, dia);
      fs.mkdirSync(dir, { recursive: true });
      let n = 0;
      for (const f of ['tarefas.json', 'eventos.jsonl', 'conversas.jsonl', 'sugestoes.json', 'oauth-clients.json']) { const o = path.join(stateDir, f); if (fs.existsSync(o)) { fs.copyFileSync(o, path.join(dir, f)); n++; } }
      const todas = fs.readdirSync(F.backups).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      for (const velha of todas.slice(0, Math.max(0, todas.length - 14))) fs.rmSync(path.join(F.backups, velha), { recursive: true, force: true });
      return { dia, arquivos: n };
    },
    async sugestoesLer() { return { ...sugestoes, itens: sugestoes.itens.map((s) => ({ ...s })) }; },
    async sugestoesGravar(itens, extra) { sugestoes = { geradas_em: new Date().toISOString(), marco_zero: (extra && extra.marco_zero) || null, itens }; gravarJson(F.sug, sugestoes); return sugestoes; },
    async sugestaoGravarDecisao(id, dados) {
      const s = sugestoes.itens.find((x) => x.id === id);
      if (!s) return null;
      Object.assign(s, dados);
      gravarJson(F.sug, sugestoes);
      return { ...s };
    },
    // Histórico do chat: append-only, por pessoa. Nada é apagado.
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

// ------------------------------------------------------------------ persistência em Postgres
/** `opts.pool` existe para os testes rodarem o mesmo contrato num Postgres embutido. */
function persistenciaPostgres(url, opts = {}) {
  let pool = opts.pool;
  if (!pool) {
    let pg = null;
    try { pg = require('pg'); } catch { throw new Error('TAREFAS_DATABASE_URL definido mas o pacote pg não está instalado.'); }
    pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 8000 });
  }
  const q = (sql, params) => pool.query(sql, params);
  const linha = (r) => (r ? { ...r.dados, id: r.id } : null);
  /** Card e evento gravados juntos: ou os dois, ou nenhum. */
  async function transacao(fn) {
    const c = pool.connect ? await pool.connect() : { query: q, release() {} };
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) { try { await c.query('ROLLBACK'); } catch { /* já caiu */ } throw e; }
    finally { c.release(); }
  }
  const SEM = (ev) => { const { tarefa_id, tipo, quem, trace_id, ...detalhe } = ev; return [tarefa_id || null, tipo, quem || null, trace_id || null, JSON.stringify(detalhe)]; };
  async function evento(c, ev) {
    const r = await c.query('INSERT INTO plan_eventos (tarefa_id, tipo, quem, trace_id, detalhe) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id, ts', SEM(ev));
    return { seq: Number(r.rows[0].id), ts: new Date(r.rows[0].ts).toISOString(), ...ev };
  }
  /** Mesmo formato para quem lê: detalhe aberto no próprio evento, como no motor de arquivo. */
  const eventoDe = (r) => ({ seq: Number(r.id), ts: new Date(r.ts).toISOString(), tarefa_id: r.tarefa_id, tipo: r.tipo, quem: r.quem, trace_id: r.trace_id, ...(r.detalhe || {}) });
  const META = 's-meta';
  return {
    motor: 'postgres',
    async pronto() { try { await q('SELECT 1 FROM plan_tarefas LIMIT 1'); return true; } catch (e) { throw new Error(`plan_tarefas indisponível: ${e.message}`); } },
    saude: () => ({}),
    ultimoSeq: async () => Number((await q('SELECT COALESCE(max(id),0) AS s FROM plan_eventos')).rows[0].s),
    idsDoDia: async (prefixo) => (await q('SELECT id FROM plan_tarefas WHERE id LIKE $1', [`${prefixo}%`])).rows.map((r) => r.id),
    todas: async () => (await q('SELECT id, dados FROM plan_tarefas WHERE excluida_em IS NULL ORDER BY criado_em DESC, id DESC')).rows.map(linha),
    obter: async (id) => linha((await q('SELECT id, dados FROM plan_tarefas WHERE id=$1 AND excluida_em IS NULL', [id])).rows[0]),
    inserir: (t, ev) => transacao(async (c) => {
      await c.query('INSERT INTO plan_tarefas (id, dados, estado, dono, vence_em, criado_em, atualizado_em) VALUES ($1,$2::jsonb,$3,$4,$5,$6,$6)', [t.id, JSON.stringify(t), t.estado, t.dono, t.vence_em, t.criado_em]);
      return evento(c, ev);
    }),
    gravar: (t, ev) => transacao(async (c) => {
      await c.query('UPDATE plan_tarefas SET dados=$2::jsonb, estado=$3, dono=$4, vence_em=$5, atualizado_em=$6 WHERE id=$1', [t.id, JSON.stringify(t), t.estado, t.dono, t.vence_em, t.atualizado_em]);
      return evento(c, ev);
    }),
    remover: (id, ev) => transacao(async (c) => {
      const r = await c.query('UPDATE plan_tarefas SET excluida_em=now() WHERE id=$1 AND excluida_em IS NULL', [id]);
      if (!(r.rowCount ?? r.affectedRows)) return null;
      return evento(c, ev);
    }),
    registrar: (ev) => evento({ query: q }, ev),
    async eventos(id, limite = 200) {
      const r = id ? await q('SELECT * FROM plan_eventos WHERE tarefa_id=$1 ORDER BY id DESC LIMIT $2', [id, limite]) : await q('SELECT * FROM plan_eventos ORDER BY id DESC LIMIT $1', [limite]);
      return r.rows.reverse().map(eventoDe);
    },
    // Sugestões: a lista é substituída a cada geração (o papel não tem DELETE, então marca-se ativa=false), e a linha
    // s-meta guarda quando foi gerada: sem ela, uma geração sem itens regeraria a cada leitura.
    async sugestoesLer() {
      const r = await q('SELECT id, dados FROM plan_sugestoes ORDER BY criado_em DESC');
      const meta = r.rows.find((x) => x.id === META);
      return { geradas_em: meta?.dados?.geradas_em || null, marco_zero: meta?.dados?.marco_zero || null, itens: r.rows.filter((x) => x.id !== META && x.dados?.ativa !== false).map(linha) };
    },
    async sugestoesGravar(itens, extra) {
      const agora = new Date().toISOString();
      const marco = (extra && extra.marco_zero) || null;
      await transacao(async (c) => {
        await c.query("UPDATE plan_sugestoes SET dados = dados || '{\"ativa\":false}'::jsonb WHERE id <> $1", [META]);
        for (const s of itens) await c.query('INSERT INTO plan_sugestoes (id, dados, criado_em) VALUES ($1,$2::jsonb,$3) ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados', [s.id, JSON.stringify({ ...s, ativa: true }), agora]);
        await c.query('INSERT INTO plan_sugestoes (id, dados, criado_em) VALUES ($1,$2::jsonb,$3) ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados', [META, JSON.stringify({ geradas_em: agora, marco_zero: marco, ativa: false }), agora]);
      });
      return this.sugestoesLer();
    },
    async sugestaoGravarDecisao(id, dados) {
      const r = await q('UPDATE plan_sugestoes SET dados = dados || $2::jsonb WHERE id=$1 RETURNING id, dados', [id, JSON.stringify(dados)]);
      return (r.rowCount ?? r.affectedRows) ? linha(r.rows[0]) : null;
    },
    async conversaGravar(m) {
      const l = { id: novaConversaId(), ts: new Date().toISOString(), ...m };
      await q('INSERT INTO plan_conversas (id, ts, quem, canal, papel, dados) VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [l.id, l.ts, l.quem || null, l.canal || 'app', l.papel || 'pessoa', JSON.stringify(l)]);
      return l;
    },
    async conversaLer({ quem, limite = 50 } = {}) {
      const r = quem ? await q('SELECT dados FROM plan_conversas WHERE quem=$1 ORDER BY ts DESC LIMIT $2', [quem, limite]) : await q('SELECT dados FROM plan_conversas ORDER BY ts DESC LIMIT $1', [limite]);
      return r.rows.map((x) => x.dados).reverse();
    },
  };
}

function abrir({ stateDir, databaseUrl, pool }) {
  return criarLivro(databaseUrl || pool ? persistenciaPostgres(databaseUrl, { pool }) : persistenciaArquivo(stateDir));
}

/** Resumo para o relato à Regência e para o rodapé do app. Recebe TODAS as tarefas: arquivar não apaga produtividade. */
function resumo(tarefas, diaRef) {
  const dia = diaRef || hoje();
  const abertas = tarefas.filter((t) => t.estado !== 'done');
  const atrasadas = abertas.filter((t) => t.vence_em && t.vence_em < dia);
  const hojeL = abertas.filter((t) => t.vence_em === dia);
  const seteDias = nucleo.somarDias(dia, -7);
  const trintaDias = nucleo.somarDias(dia, -30);
  const feitas = tarefas.filter((t) => t.estado === 'done' && t.concluido_em);
  const concluidas7 = feitas.filter((t) => t.concluido_em.slice(0, 10) >= seteDias);
  const recentes = feitas.filter((t) => t.concluido_em.slice(0, 10) >= trintaDias);
  const comPrazo = recentes.filter((t) => t.vence_em);
  const noPrazo = comPrazo.filter((t) => t.concluido_em.slice(0, 10) <= t.vence_em).length;
  const ciclos = recentes.filter((t) => t.criado_em).map((t) => (Date.parse(t.concluido_em) - Date.parse(t.criado_em)) / 864e5).sort((a, b) => a - b);
  const mediana = ciclos.length ? ciclos[Math.floor(ciclos.length / 2)] : null;
  const cobrar = abertas.filter((t) => t.estado === 'wait' && (!t.cobrar_em || t.cobrar_em <= dia));
  const limiteParada = new Date(Date.parse(dia) - 7 * 864e5).toISOString();
  const paradas = abertas.filter((t) => t.atualizado_em && t.atualizado_em < limiteParada);
  const porPessoa = {};
  for (const p of Object.keys(PESSOAS)) porPessoa[p] = { abertas: abertas.filter((t) => t.dono === p).length, atrasadas: atrasadas.filter((t) => t.dono === p).length };
  return { abertas: abertas.length, atrasadas: atrasadas.length, hoje: hojeL.length, cobrar: cobrar.length, paradas_7d: paradas.length, concluidas_7d: concluidas7.length, no_prazo_30d_pct: comPrazo.length ? Math.round((noPrazo / comPrazo.length) * 100) : null, ciclo_mediano_dias: mediana === null ? null : Math.round(mediana * 10) / 10, por_pessoa: porPessoa, mais_antiga_atrasada: atrasadas.map((t) => t.vence_em).sort()[0] || null };
}

module.exports = { abrir, normalizar, resumo, aplicarOpsEtapas, ErroConflito, ESTADOS, PESSOAS, AREAS, CANAIS, PRIORIDADES, REPETICOES, FUSO, hoje, novoId, nucleo, _hash: (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10) };
