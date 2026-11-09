'use strict';
/** O leitor de frases e o foco do dia: o mesmo arquivo roda no navegador (prévia ao vivo) e no servidor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../public/nucleo.js');

const DIA = '2026-11-05'; // quinta-feira

test('prazo: frases reais em português e francês', () => {
  const casos = [
    ['Responder os hotéis até sexta', '2026-11-06'], ['Ligar para o Monak amanhã', '2026-11-06'], ['Fechar o orçamento até 15/11', '2026-11-15'],
    ['Enviar proposta para 20/11', '2026-11-20'], ['Revisar o contrato dia 12', '2026-11-12'], ['Revisar o contrato no dia 12/11', '2026-11-12'],
    ['Entregar em 3 dias', '2026-11-08'], ['Publicar daqui a 2 dias', '2026-11-07'], ['Terminar até 15 de novembro', '2026-11-15'],
    ['Mandar até o fim do mês', '2026-11-30'], ['Rever na próxima terça', '2026-11-10'], ['Enviar segunda que vem', '2026-11-09'],
    ['Fazer em duas semanas', '2026-11-19'], ['Fazer hoje à tarde', '2026-11-05'], ['Confirmar até amanhã 18h', '2026-11-06'],
    ['Ligar sexta para o Monak', '2026-11-06'], ['Ligar para o Monak sexta @julien !alta', '2026-11-06'], ['Entregar em 1 mês', '2026-12-05'],
    ['Répondre vendredi', '2026-11-06'], ['Appeler le 12 novembre', '2026-11-12'], ['Finir dans 3 jours', '2026-11-08'],
    ['Avant la fin du mois', '2026-11-30'], ['Rappeler demain matin', '2026-11-06'], ["Confirmer d'ici lundi", '2026-11-09'],
    ['Ver o contrato no dia 3', '2026-12-03'], // dia 3 já passou neste mês: é o do mês que vem
  ];
  for (const [t, esperado] of casos) assert.equal(n.analisar(t, { hoje: DIA }).vence_em, esperado, t);
});

test('prazo: o que NÃO é prazo nunca vira data', () => {
  for (const t of ['Reservar mesa para 4/5 pessoas', 'Atender 2/3 dos pedidos em Paris', 'Conferir o pedido em 12/2024 do cliente', 'Marcar para 31/02', 'Ligar para o Hotel de la Paix', 'Revisar a agenda do cliente agora que ele chegou', 'Não é urgente: rever o texto', 'Reservar a Quinta do Lago para o cliente', 'Escolher a segunda opção do cardápio', 'É urgente responder', 'Conferir a fatura de 03/10/2024']) {
    assert.equal(n.analisar(t, { hoje: DIA }).vence_em, null, t);
  }
});

test('prazo: data como assunto, número que parece data e palavras ambíguas', () => {
  const a = (t, dia = DIA) => n.analisar(t, { hoje: dia });
  assert.equal(a('Rever o contrato do dia 12 até sexta').vence_em, '2026-11-06', 'depois do "até" vem o prazo');
  assert.equal(a('Rever o contrato do dia 12 até sexta').titulo, 'Rever o contrato do dia 12');
  assert.equal(a('Confirmar o jantar de 20/11 amanhã').vence_em, '2026-11-06', 'o jantar de 20/11 é assunto');
  for (const t of ['Atender 24/7', 'Visitar 2/3 casas', 'Comprar 12 set de velas', 'Pagar a fatura de 12 de novembro de 2025', 'Conferir a reserva do dia 12']) assert.equal(a(t).vence_em, null, t);
  assert.equal(a('Fechar até 20/11 de manhã').vence_em, '2026-11-20');
  assert.equal(a('Entregar até 15 nov para o cliente').vence_em, '2026-11-15');
  assert.equal(a('Entregar em 3 dias úteis').vence_em, '2026-11-10', 'quinta + 3 úteis = terça');
  assert.equal(a('Entregar em 3 dias úteis').repete, '', 'prazo em dias úteis não é repetição');
  const m = a('Fechar o caixa todo dia 5');
  assert.deepEqual([m.repete, m.vence_em], ['mensal', '2026-12-05']);
  assert.equal(a('Conferir a fila todos os dias úteis').repete, 'dias_uteis');
});

test('prazo: semana e dia da semana em cada dia da semana', () => {
  const v = (t, dia) => n.analisar(t, { hoje: dia }).vence_em;
  const SEX = '2026-11-06', SAB = '2026-11-07', DOM = '2026-11-08', SEG = '2026-11-09';
  for (const dia of [DIA, SEX, SAB, DOM]) assert.equal(v('Enviar semana que vem', dia), '2026-11-13', `semana que vem, a partir de ${dia}`);
  assert.equal(v('Enviar semana que vem', SEG), '2026-11-20');
  assert.equal(v('Fechar esta semana', SEX), SEX, 'esta semana, na sexta: hoje');
  assert.equal(v('Fechar esta sexta', SEX), SEX, 'esta sexta, na sexta: hoje');
  assert.equal(v('Fechar até sexta', SEX), '2026-11-13', 'até sexta, na sexta: a próxima');
  assert.equal(v('Enviar sexta que vem', DIA), '2026-11-13', 'na quinta, não é amanhã');
  assert.equal(v('Enviar segunda que vem', DIA), SEG);
  assert.equal(v('Envoyer vendredi prochain', DIA), '2026-11-13');
});

test('frase inteira: campos saem do título; assunto continua nele', () => {
  const a = n.analisar('Ligar para o Monak sexta @julien !alta #nice', { hoje: DIA });
  assert.deepEqual([a.titulo, a.dono, a.vence_em, a.prioridade, a.cidade, a.canal], ['Ligar para o Monak', 'julien', '2026-11-06', 'alta', 'Nice', 'Telefone']);
  const b = n.analisar('Precisamos responder os 4 hotéis de Paris que pediram chauffeur até sexta, Julien cuida', { hoje: DIA });
  assert.equal(b.titulo, 'Responder os 4 hotéis de Paris que pediram chauffeur'); assert.equal(b.dono, 'julien'); assert.equal(b.cidade, 'Paris'); assert.equal(b.area, 'Chauffeur');
  const c = n.analisar('Perguntar ao Lucas sobre o contrato', { hoje: DIA });
  assert.equal(c.titulo, 'Perguntar ao Lucas sobre o contrato', 'nome como assunto fica'); assert.equal(c.dono, 'lucas');
  const d = n.analisar('Confirmar a reserva ABCD1234 por WhatsApp amanhã urgente', { hoje: DIA });
  assert.deepEqual([d.referencia, d.canal, d.prioridade, d.area], ['ABCD1234', 'WhatsApp', 'alta', 'Clientes']);
  assert.equal(n.analisar('Márlon liga e Lucas corrige', { hoje: DIA }).dono, null, 'dois nomes = ninguém decide sozinho');
  assert.equal(n.analisar('Márlon liga e Lucas corrige', { hoje: DIA }).dono_ambiguo, true);
  assert.equal(n.analisar('sem pressa: rever o texto', { hoje: DIA }).prioridade, 'baixa');
});

test('repetição: dita na frase, com a próxima data certa', () => {
  const a = n.analisar('Toda segunda rever a fila do Guardião @lucas', { hoje: DIA });
  assert.deepEqual([a.repete, a.vence_em, a.titulo], ['semanal', '2026-11-09', 'Rever a fila do Guardião']);
  assert.equal(n.analisar('Conferir as escalações todo dia', { hoje: DIA }).repete, 'diaria');
  assert.equal(n.analisar('Fechar o caixa todo mês', { hoje: DIA }).repete, 'mensal');
  assert.equal(n.analisar('Vérifier chaque lundi', { hoje: DIA }).repete, 'semanal');
  assert.equal(n.proximaData('2026-11-06', 'dias_uteis', DIA), '2026-11-09', 'sexta → segunda');
  assert.equal(n.proximaData('2026-01-31', 'mensal', '2026-01-31'), '2026-02-28', 'mês curto não estoura');
  assert.equal(n.proximaData('2026-10-01', 'semanal', DIA), '2026-11-05', 'card atrasado: a próxima nunca nasce no passado');
});

test('hoje é o dia em Paris, não em UTC', () => {
  assert.equal(n.hoje('Europe/Paris', new Date('2026-11-05T23:30:00Z')), '2026-11-06');
  assert.equal(n.hoje('Europe/Paris', new Date('2026-07-05T22:30:00Z')), '2026-07-06', 'horário de verão');
  assert.equal(n.dataValida('2026-13-45'), false); assert.equal(n.dataValida('2026-02-29'), false); assert.equal(n.dataValida('2028-02-29'), true);
});

test('pedido em lista vira vários; cabeçalho vale para todos', () => {
  const p = n.dividirPedido('Para Julien até sexta:\n- Ligar para o Monak\n- Confirmar o carro\n- Avisar o hotel');
  assert.equal(p.length, 3);
  const a = n.analisar(p[0], { hoje: DIA });
  assert.deepEqual([a.titulo, a.dono, a.vence_em], ['Ligar para o Monak', 'julien', '2026-11-06']);
  assert.equal(n.dividirPedido('Ligar para a casa de manhã').length, 1);
  assert.equal(n.dividirPedido('Ligar para o Monak hoje; responder o hotel Lutetia amanhã').length, 2);
});

test('foco: cada card uma vez, na ordem que importa; aguardando volta na data', () => {
  const t = [
    { id: '1', estado: 'todo', dono: 'julien', vence_em: '2026-11-01', prioridade: 'normal', etapas: [] },
    { id: '2', estado: 'todo', dono: 'julien', vence_em: DIA, prioridade: 'normal', etapas: [] },
    { id: '3', estado: 'wait', dono: 'julien', vence_em: null, cobrar_em: DIA, prioridade: 'normal', etapas: [] },
    { id: '4', estado: 'wait', dono: 'julien', vence_em: null, cobrar_em: '2026-11-20', prioridade: 'normal', etapas: [] },
    { id: '5', estado: 'wait', dono: 'julien', vence_em: null, cobrar_em: null, prioridade: 'normal', etapas: [] },
    { id: '6', estado: 'doing', dono: 'julien', vence_em: '2026-12-01', prioridade: 'normal', etapas: [] },
    { id: '7', estado: 'todo', dono: 'julien', vence_em: null, prioridade: 'alta', etapas: [] },
    { id: '8', estado: 'todo', dono: 'julien', vence_em: '2026-11-07', prioridade: 'normal', etapas: [] },
    { id: '9', estado: 'done', dono: 'julien', vence_em: DIA, prioridade: 'normal', etapas: [] },
    { id: '10', estado: 'todo', dono: 'lucas', vence_em: DIA, prioridade: 'normal', etapas: [] },
    { id: '11', estado: 'todo', dono: 'julien', vence_em: '2026-12-30', prioridade: 'normal', etapas: [] },
  ];
  const f = n.foco(t, 'julien', DIA);
  const ids = (l) => l.map((x) => x.id);
  assert.deepEqual(ids(f.agora), ['7', '1']); assert.deepEqual(ids(f.cobrar), ['3', '5'], 'cobrança de hoje e espera sem data');
  assert.deepEqual(ids(f.hoje), ['2']); assert.deepEqual(ids(f.andamento), ['6']); assert.deepEqual(ids(f.aSeguir), ['8']);
  assert.deepEqual(ids(f.esperando), ['4'], 'aguardando com data futura não polui o dia');
  assert.ok(!ids(f.agora).includes('10'), 'filtro por pessoa'); assert.equal(n.foco(t, 'all', DIA).hoje.length, 2);
});

test('perguntas ao quadro: resposta sem modelo; pedido de trabalho não é pergunta', () => {
  const t = [{ id: 'A', titulo: 'x', estado: 'todo', dono: 'julien', vence_em: '2026-11-01', prioridade: 'normal' }, { id: 'B', titulo: 'y', estado: 'todo', dono: 'lucas', vence_em: DIA, prioridade: 'alta' }, { id: 'C', titulo: 'z', estado: 'wait', dono: 'lucas', vence_em: null, prioridade: 'normal' }];
  assert.deepEqual(n.responder('O que está atrasado?', t, DIA).ids, ['A']);
  assert.deepEqual(n.responder('o que o Lucas tem hoje?', t, DIA).ids, ['B']);
  assert.deepEqual(n.responder('Qu’est-ce qui est en attente ?', t, DIA).ids, ['C']);
  assert.equal(n.responder('Quem está sobrecarregado?', t, DIA).tipo, 'carga');
  assert.equal(n.responder('Ligar para o hotel até sexta', t, DIA), null);
  assert.equal(n.responder('Quem pode ligar para o Monak?', t, DIA), null, 'sem filtro reconhecido: não finge que entendeu');
});
