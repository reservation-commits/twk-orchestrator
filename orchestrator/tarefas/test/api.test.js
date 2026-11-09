'use strict';
/** A API da 1.0 de ponta a ponta: conflito, tempo real, segurança, compressão, sugestões que chegam antes. Estado temporário, sem modelo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-tarefas-api-'));
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.STATE_DIR = dir;
process.env.NODE_ENV = 'development';
process.env.TAREFAS_SEM_BANCO = '1'; // nenhum teste toca no banco real
process.env.CENTER_TOKEN = 'chave-da-central-de-teste';
process.env.TAREFAS_SECRET = SEGREDO;
process.env.COMPROMISSOS_PATH = path.join(dir, 'compromissos.jsonl');
process.env.CENTRAL_STATE_DIR = path.join(dir, 'central');
delete process.env.ANTHROPIC_API_KEY; delete process.env.TAREFAS_DATABASE_URL; delete process.env.CENTER_URL; delete process.env.DATABASE_URL_RO;
fs.mkdirSync(process.env.CENTRAL_STATE_DIR, { recursive: true });
const { server, conexoes } = require('../server.js');

let base = '';
function cliente() {
  let cookie = '';
  const call = async (m, rota, corpo, extra) => {
    const r = await fetch(base + rota, { method: m, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie, ...(extra || {}) }, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    let j = null; try { j = await r.clone().json(); } catch { /* sem corpo */ }
    return { status: r.status, j, h: r.headers };
  };
  return { call, entrar: (u) => call('POST', '/api/login', { usuario: u, senha: 'twk' }), get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}
const marlon = cliente(); const julien = cliente();
test.before(async () => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`;
  await marlon.entrar('marlon'); await julien.entrar('julien');
});
test.after(() => { for (const c of conexoes) c.destroy(); server.close(); server.closeAllConnections?.(); });

test('dois editando pela API: campos diferentes somam; mesmo campo devolve 409 com o valor atual', async () => {
  const t = (await marlon.call('POST', '/api/tarefas', { titulo: 'Card disputado', dono: 'lucas', notas: 'original' })).j.tarefa;
  assert.equal(t.versao, 1);
  assert.equal((await julien.call('PATCH', `/api/tarefas/${t.id}`, { notas: 'do Julien', base: { notas: 'original' } })).status, 200);
  const ok = await marlon.call('PATCH', `/api/tarefas/${t.id}`, { prioridade: 'alta', base: { prioridade: 'normal' } });
  assert.equal(ok.status, 200); assert.equal(ok.j.tarefa.notas, 'do Julien'); assert.equal(ok.j.tarefa.prioridade, 'alta');
  const c = await marlon.call('PATCH', `/api/tarefas/${t.id}`, { notas: 'do Márlon', base: { notas: 'original' } });
  assert.equal(c.status, 409); assert.deepEqual(c.j.conflito, ['notas']); assert.equal(c.j.tarefa.notas, 'do Julien');
});

test('erros de entrada são 400 com mensagem legível, nunca 500', async () => {
  const j = await marlon.call('POST', '/api/tarefas', '{json quebrado');
  assert.equal(j.status, 400); assert.equal(j.j.erro, 'JSON inválido');
  assert.equal((await marlon.call('POST', '/api/tarefas', { titulo: 'Data absurda', dono: 'lucas', vence_em: '2026-13-45' })).status, 400);
  const e = await marlon.call('POST', '/api/tarefas', { titulo: 'Etapa nula', dono: 'lucas', etapas: [null] });
  assert.equal(e.status, 400); assert.match(e.j.erro, /Etapa inválida/);
  assert.equal((await marlon.call('GET', '/api/tarefas/T-20000101-0001')).status, 404);
});

test('KPI: arquivar não apaga o que foi concluído', async () => {
  const t = (await marlon.call('POST', '/api/tarefas', { titulo: 'Throughput real', dono: 'lucas' })).j.tarefa;
  await marlon.call('PATCH', `/api/tarefas/${t.id}`, { estado: 'done', resultado: 'ok' });
  const antes = (await marlon.call('GET', '/api/tarefas')).j.resumo.concluidas_7d;
  await marlon.call('POST', `/api/tarefas/${t.id}/arquivar`, {});
  const lista = (await marlon.call('GET', '/api/tarefas')).j;
  assert.equal(lista.resumo.concluidas_7d, antes); assert.ok(!lista.tarefas.some((x) => x.id === t.id));
  const rel = (await marlon.call('GET', '/api/relato', undefined, { 'x-center-key': 'chave-da-central-de-teste' })).j;
  assert.equal(rel.kpis.concluidas_7d, antes); assert.equal(typeof rel.kpis.tarefas_cobrar, 'number');
});

test('cada requisição tem o próprio trace; o de fora é respeitado', async () => {
  const a = (await marlon.call('POST', '/api/tarefas', { titulo: 'Trace um', dono: 'lucas' })).j.tarefa;
  const b = (await julien.call('POST', '/api/tarefas', { titulo: 'Trace dois', dono: 'lucas' })).j.tarefa;
  const c = (await julien.call('POST', '/api/tarefas', { titulo: 'Trace três', dono: 'lucas' }, { 'x-trace-id': 'trc-regencia-abc123' })).j.tarefa;
  const ta = (await marlon.call('GET', `/api/tarefas/${a.id}/eventos`)).j.eventos[0].trace_id;
  const tb = (await marlon.call('GET', `/api/tarefas/${b.id}/eventos`)).j.eventos[0].trace_id;
  assert.notEqual(ta, tb); assert.match(ta, /^trc-tarefas-\d{8}-[0-9a-f]{6}$/);
  assert.equal((await marlon.call('GET', `/api/tarefas/${c.id}/eventos`)).j.eventos[0].trace_id, 'trc-regencia-abc123');
});

test('tempo real: quem está com o app aberto recebe a mudança de outra pessoa', async () => {
  const eventos = [];
  const req = http.request(`${base}/api/stream`, { headers: { cookie: marlon.cookie } });
  await new Promise((pronto, falhou) => {
    req.on('response', (res) => {
      assert.equal(res.statusCode, 200); assert.match(res.headers['content-type'], /event-stream/);
      res.setEncoding('utf8');
      res.on('data', (d) => { eventos.push(d); if (/event: ola/.test(d)) pronto(); });
    });
    req.on('error', falhou); req.end();
  });
  const t = (await julien.call('POST', '/api/tarefas', { titulo: 'Criado ao vivo pelo Julien', dono: 'marlon' })).j.tarefa;
  for (let i = 0; i < 100 && !eventos.join('').includes(t.id); i++) await new Promise((k) => setTimeout(k, 20));
  const bruto = eventos.join('');
  assert.match(bruto, /event: mudanca/); assert.ok(bruto.includes(t.id));
  const dados = JSON.parse(/event: mudanca\ndata: (.*)\n/.exec(bruto)[1]);
  assert.equal(dados.tipo, 'criada'); assert.equal(dados.quem, 'julien'); assert.equal(dados.tarefa.titulo, 'Criado ao vivo pelo Julien');
  req.destroy();
  assert.equal((await fetch(`${base}/api/stream`)).status, 401, 'sem sessão não ouve nada');
});

test('sincronia econômica: nada mudou = resposta de poucos bytes', async () => {
  const l = (await marlon.call('GET', '/api/tarefas')).j;
  assert.ok(l.seq > 0);
  const r = await marlon.call('GET', `/api/tarefas?desde=${l.seq}`);
  assert.equal(r.j.inalterado, true); assert.equal(r.j.tarefas, undefined);
  await marlon.call('POST', '/api/tarefas', { titulo: 'Mudou agora', dono: 'lucas' });
  assert.ok((await marlon.call('GET', `/api/tarefas?desde=${l.seq}`)).j.tarefas.length > 0);
});

test('comentar e novidades: cada pessoa vê o que outra fez nos cards dela, e a menção', async () => {
  const t = (await marlon.call('POST', '/api/tarefas', { titulo: 'Card para o Julien', dono: 'julien' })).j.tarefa;
  const c = await marlon.call('POST', `/api/tarefas/${t.id}/comentarios`, { texto: 'Falei com o concierge' });
  assert.equal(c.status, 201); assert.equal(c.j.tarefa.comentarios[0].quem, 'marlon');
  assert.equal((await marlon.call('POST', `/api/tarefas/${t.id}/comentarios`, { texto: ' ' })).status, 400);
  const outro = (await julien.call('POST', '/api/tarefas', { titulo: 'Card do Lucas com menção', dono: 'lucas' })).j.tarefa;
  await julien.call('POST', `/api/tarefas/${outro.id}/comentarios`, { texto: '@marlon pode olhar?' });
  const nj = (await julien.call('GET', '/api/novidades')).j;
  assert.equal(nj.pessoa, 'julien');
  assert.ok(nj.itens.some((i) => i.tarefa_id === t.id && i.tipo === 'comentario'), 'comentário no meu card');
  assert.ok(nj.itens.some((i) => i.tarefa_id === t.id && i.tipo === 'criada'), 'alguém me deu um card');
  assert.ok(!nj.itens.some((i) => i.quem === 'julien'), 'o que eu mesmo fiz não é novidade');
  const nm = (await marlon.call('GET', '/api/novidades')).j;
  assert.ok(nm.itens.some((i) => i.tarefa_id === outro.id && /@marlon/.test(i.texto)), 'menção chega mesmo em card de outra pessoa');
  assert.ok(!nm.itens.some((i) => i.tarefa_id === t.id), 'card do Julien, sem menção: não é comigo');
});

test('chat: lista vira várias propostas; pergunta se responde com o quadro, sem gastar modelo', async () => {
  const p = (await marlon.call('POST', '/api/planejar', { texto: 'Para Lucas até sexta:\n- Ligar para o Monak\n- Confirmar o carro do hotel' })).j;
  assert.equal(p.propostas.length, 2); assert.deepEqual(p.propostas.map((x) => x.dono), ['lucas', 'lucas']); assert.ok(p.propostas.every((x) => x.vence_em));
  assert.equal(p.proposta.titulo, p.propostas[0].titulo);
  const r = (await marlon.call('POST', '/api/planejar', { texto: 'O que está atrasado?' })).j;
  assert.equal(r.resposta.tipo, 'lista'); assert.equal(r.proposta, undefined);
  const hist = (await marlon.call('GET', '/api/chat')).j.mensagens;
  assert.ok(hist.some((m) => m.resposta), 'a resposta entra no histórico');
});

test('segurança: token do conector não é sessão; identidade nunca fica vazia', async () => {
  const assinar = (pl) => { const corpo = Buffer.from(JSON.stringify(pl)).toString('base64url'); return `${corpo}.${crypto.createHmac('sha256', SEGREDO).update(corpo).digest('base64url')}`; };
  const x = cliente();
  for (const t of ['refresh', 'acesso']) {
    x.cookie = `twk_tarefas=${encodeURIComponent(assinar({ t, sub: 'marlon', nome: 'Márlon', cid: 'c_x', exp: Date.now() + 864e5 }))}`;
    assert.equal((await x.call('GET', '/api/tarefas')).status, 401, `token ${t} não vale como cookie`);
  }
  x.cookie = `twk_tarefas=${encodeURIComponent(assinar({ id: 'fulano', nome: 'Fulano', exp: Date.now() + 864e5 }))}`;
  assert.equal((await x.call('GET', '/api/tarefas')).status, 401, 'login que não existe mais não entra');
});

test('segurança: cabeçalhos, superfície sem login, força bruta com freio', async () => {
  const ix = await fetch(`${base}/`);
  assert.match(ix.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(ix.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(ix.headers.get('x-frame-options'), 'DENY'); assert.equal(ix.headers.get('x-content-type-options'), 'nosniff');
  const anon = cliente();
  const eu = (await anon.call('GET', '/api/eu')).j;
  assert.equal(eu.build, undefined); assert.equal(eu.motor, undefined); assert.ok(eu.usuarios.length, 'só o necessário para a tela de login');
  const h = (await anon.call('GET', '/health')).j;
  assert.equal(h.durabilidade, undefined); assert.equal(h.ok, true);
  const atacante = cliente();
  const cabec = { 'x-forwarded-for': '203.0.113.9' };
  const status = [];
  for (let i = 0; i < 12; i++) status.push((await atacante.call('POST', '/api/login', { usuario: 'alguem', senha: `t${i}` }, cabec)).status);
  assert.deepEqual(status.slice(0, 8), Array(8).fill(401)); assert.deepEqual(status.slice(8), Array(4).fill(429));
  assert.equal((await atacante.call('POST', '/api/login', { usuario: 'lucas', senha: 'twk' }, cabec)).status, 429, 'o IP segue freado mesmo com a senha certa');
  assert.equal((await cliente().call('POST', '/api/login', { usuario: 'lucas', senha: 'twk' }, { 'x-forwarded-for': '198.51.100.7' })).status, 200, 'outro IP e outro usuário entram normalmente');
  assert.equal((await atacante.call('POST', '/api/login', { usuario: 'lucas', senha: 'twk' }, { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' })).status, 429, 'forjar o começo da lista não engana: vale o último salto');
});

test('nada malformado derruba o servidor, sem precisar de login', async () => {
  const cru = (path, headers) => new Promise((ok, falha) => { const r = http.request(`${base}/health`, { path, headers: headers || {} }, (res) => { res.resume(); res.on('end', () => ok(res.statusCode)); }); r.on('error', falha); r.end(); });
  assert.equal(await cru('//'), 400, 'endereço que o URL não aceita');
  assert.equal(await cru('/health', { cookie: 'twk_tarefas=%' }), 200, 'cookie que não decodifica');
  assert.equal(await cru('/api/tarefas', { cookie: 'twk_tarefas=%E0%A4%A' }), 401);
  assert.equal(await cru('/mcp', { authorization: `Bearer x.${'é'.repeat(43)}`, 'content-type': 'application/json' }), 401, 'token com letra acentuada');
  assert.equal(await cru('/health', { cookie: `twk_tarefas=${encodeURIComponent(`x.${'é'.repeat(43)}`)}` }), 200);
  assert.equal((await fetch(`${base}/health`)).status, 200, 'e continua de pé');
});

test('freio: 40 senhas erradas em paralelo não passam juntas; erros de outros IPs não trancam a dona', async () => {
  const c = cliente();
  const lote = await Promise.all(Array.from({ length: 40 }, (_, i) => c.call('POST', '/api/login', { usuario: 'ninguem', senha: `p${i}` }, { 'x-forwarded-for': '203.0.113.77' })));
  assert.equal(lote.filter((r) => r.status === 401).length, 8); assert.equal(lote.filter((r) => r.status === 429).length, 32);
  for (let i = 0; i < 12; i++) await c.call('POST', '/api/login', { usuario: 'julien', senha: 'errada' }, { 'x-forwarded-for': `198.18.0.${i + 1}` });
  assert.equal((await c.call('POST', '/api/login', { usuario: 'julien', senha: 'twk' }, { 'x-forwarded-for': '198.18.1.1' })).status, 200, 'a pessoa certa, de outro IP, entra');
});

test('quem decide enquanto as fontes são lidas não perde a decisão; duplo clique não cria dois cards', async () => {
  const hoje = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(process.env.COMPROMISSOS_PATH, JSON.stringify({ id: 'C-CORRIDA', status: 'aberto', vence_em: hoje, dono: 'Lucas', tipo: 'produto', o_que: 'Corrida de decisão', criado_em: hoje }));
  const s = (await marlon.call('GET', '/api/sugestoes?atualizar=1')).j.itens.find((x) => x.chave === 'compromisso:C-CORRIDA');
  assert.ok(s);
  // Fontes lentas: a releitura só termina depois que a pessoa decidiu
  const mod = require('../sugestoes.js'); const real = mod.gerar;
  let soltar; const portao = new Promise((k) => { soltar = k; });
  mod.gerar = async (...a) => { const r = await real(...a); await portao; return r; };
  try {
    const leitura = marlon.call('GET', '/api/sugestoes?atualizar=1');
    await new Promise((k) => setTimeout(k, 40));
    const [a, b] = await Promise.all([marlon.call('POST', `/api/sugestoes/${s.id}/assumir`, { dono: 'lucas' }), julien.call('POST', `/api/sugestoes/${s.id}/assumir`, { dono: 'lucas' })]);
    assert.deepEqual([a.status, b.status].sort(), [201, 400], 'dois cliques, um card');
    soltar(); await leitura;
  } finally { mod.gerar = real; }
  const depois = (await marlon.call('GET', '/api/sugestoes')).j;
  assert.ok(!depois.itens.some((x) => x.id === s.id), 'a leitura antiga não ressuscita a sugestão decidida');
  assert.equal((await marlon.call('POST', `/api/sugestoes/${s.id}/assumir`, { dono: 'lucas' })).status, 400, 'nem deixa criar o segundo card');
  assert.equal((await marlon.call('GET', '/api/tarefas')).j.tarefas.filter((x) => x.titulo === 'Corrida de decisão').length, 1);
});

test('interface: comprimida, com etag, versionada e cacheável para sempre quando tem versão', async () => {
  const a = await fetch(`${base}/app.js`, { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(a.headers.get('content-encoding'), 'gzip'); assert.ok(a.headers.get('etag'));
  const repetida = await fetch(`${base}/app.js`, { headers: { 'if-none-match': a.headers.get('etag') } });
  assert.equal(repetida.status, 304);
  const html = await (await fetch(`${base}/`)).text();
  const v = /app\.js\?v=([0-9a-f]+)/.exec(html);
  assert.ok(v, 'o index referencia os arquivos com versão'); assert.ok(!html.includes('__V__'));
  assert.match((await fetch(`${base}/app.js?v=${v[1]}`)).headers.get('cache-control'), /immutable/);
  assert.match((await fetch(`${base}/`)).headers.get('cache-control'), /no-cache/);
  assert.equal((await fetch(`${base}/../server.js`)).status, 404, 'nada fora de public/');
  assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);
  assert.equal((await fetch(`${base}/icon.svg`)).status, 200);
  assert.equal((await fetch(`${base}/sw.js`)).status, 200);
});

test('sugestão: chega antes de vencer, com prazo e prioridade do sinal; card fechado com sinal aberto faz voltar', async () => {
  const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const hoje = new Date().toISOString().slice(0, 10);
  const amanha = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  const longe = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  fs.writeFileSync(process.env.COMPROMISSOS_PATH, [
    { id: 'C-AMANHA', status: 'aberto', vence_em: amanha, dono: 'Julien', tipo: 'cliente', o_que: 'Voltar à cliente com alternativas', criado_em: hoje },
    { id: 'C-LONGE', status: 'aberto', vence_em: longe, dono: 'Lucas', tipo: 'produto', o_que: 'Publicar a página nova', criado_em: hoje },
    { id: 'C-VENCIDO', status: 'aberto', vence_em: ontem, dono: 'Lucas', tipo: 'produto', o_que: 'Corrigir o formulário', criado_em: hoje },
  ].map((x) => JSON.stringify(x)).join('\n'));
  const s = (await marlon.call('GET', '/api/sugestoes?atualizar=1')).j;
  const am = s.itens.find((x) => x.chave === 'compromisso:C-AMANHA');
  assert.ok(am, 'aparece antes de vencer'); assert.equal(am.vence_sugerido, amanha); assert.equal(am.dono_sugerido, 'julien'); assert.match(am.porque, /vence em/);
  assert.ok(!s.itens.some((x) => x.chave === 'compromisso:C-LONGE'), 'o que vence longe ainda não incomoda');
  const venc = s.itens.find((x) => x.chave === 'compromisso:C-VENCIDO'); assert.match(venc.porque, /vencido em/);
  const a = (await marlon.call('POST', `/api/sugestoes/${am.id}/assumir`, {})).j.tarefa;
  assert.equal(a.dono, 'marlon'); assert.equal(a.vence_em, amanha, 'prazo vem do compromisso, não de +4 dias'); assert.equal(a.prioridade, 'alta', 'cliente esperando é prioridade'); assert.equal(a.referencia, 'C-AMANHA');
  const v = (await marlon.call('POST', `/api/sugestoes/${venc.id}/assumir`, { dono: 'lucas' })).j.tarefa;
  assert.ok(v.vence_em, 'compromisso vencido: o prazo é hoje, para o card não nascer atrasado');

  let s2 = (await marlon.call('GET', '/api/sugestoes?atualizar=1')).j;
  assert.ok(!s2.itens.some((x) => x.id === am.id), 'com o card aberto, fica fora');
  await marlon.call('PATCH', `/api/tarefas/${a.id}`, { estado: 'done', resultado: 'liguei' });
  s2 = (await marlon.call('GET', '/api/sugestoes?atualizar=1')).j;
  const voltou = s2.itens.find((x) => x.id === am.id);
  assert.ok(voltou && voltou.voltou, 'card fechado e sinal aberto: volta'); assert.match(voltou.porque, /^Voltou: o card/);

  // O compromisso foi fechado na origem: o card aberto dele fica marcado para fechar com um clique
  fs.writeFileSync(process.env.COMPROMISSOS_PATH, JSON.stringify({ id: 'C-AMANHA', status: 'aberto', vence_em: amanha, dono: 'Julien', tipo: 'cliente', o_que: 'x', criado_em: hoje }));
  const s3 = (await marlon.call('GET', '/api/sugestoes?atualizar=1')).j;
  assert.ok(s3.normalizados.includes(v.id), 'sinal sumiu: o card sabe');
  assert.ok((await marlon.call('GET', '/api/tarefas')).j.normalizados.includes(v.id));
});
