#!/usr/bin/env node
'use strict';
/**
 * COMPASSO — monta o valor de TAREFAS_USUARIOS com um login para cada pessoa.
 *
 *   node orchestrator/tarefas/logins.cjs
 *
 * O que faz, nesta ordem:
 *   1. pede o valor atual de TAREFAS_USUARIOS (EasyPanel → serviço compasso → Ambiente), para manter o admin como está;
 *   2. gera uma senha provisória forte para Márlon, Lucas e Julien (ou só para quem você escolher);
 *   3. imprime o valor novo, pronto para colar, e as senhas provisórias, para entregar a cada um em particular.
 *
 * A senha provisória só aparece neste terminal. No primeiro acesso, o app obriga a pessoa a escolher a dela; a
 * provisória deixa de valer na hora. Para "esqueci a senha": rode de novo só para aquela pessoa e faça o Redeploy.
 * Nada aqui fala com a rede nem grava arquivo.
 */
const crypto = require('node:crypto');
const readline = require('node:readline');
const { hashSenha, conferirSenha, FORMATO_HASH, PESSOAS, LOGINS } = require('./auth.js');

// Sem letras que se confundem ao ditar ou ler (0/o, 1/l/i): mais fácil de digitar no celular.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
function senhaProvisoria() {
  const grupos = [];
  for (let g = 0; g < 4; g++) { let s = ''; for (let i = 0; i < 4; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)]; grupos.push(s); }
  return grupos.join('-'); // 16 sinais de 31: cerca de 79 bits
}

/**
 * Monta a lista nova. `atual` = texto de TAREFAS_USUARIOS (ou vazio). `ids` = pessoas que recebem senha provisória.
 * Devolve { lista, provisorias: {id: senha} }. Quem não está em `ids` fica exatamente como estava.
 */
function montar(atual, ids, gerar = senhaProvisoria) {
  let lista = [];
  const texto = String(atual || '').trim();
  if (texto) {
    try { lista = JSON.parse(texto); } catch { throw new Error('O valor colado não é JSON válido. Copie o conteúdo inteiro de TAREFAS_USUARIOS, do [ até o ].'); }
    if (!Array.isArray(lista)) throw new Error('TAREFAS_USUARIOS precisa ser uma lista: [ … ].');
    for (const u of lista) {
      if (!u || !LOGINS[u.id]) throw new Error(`Login desconhecido no valor atual: ${u && u.id}. Os aceitos são: ${Object.keys(LOGINS).join(', ')}.`);
      if (!FORMATO_HASH.test(String(u.senha || ''))) throw new Error(`O login ${u.id} não tem a senha no formato scrypt:salt:hash. Confira se copiou o valor inteiro.`);
    }
  }
  const provisorias = {};
  for (const id of ids) {
    if (!PESSOAS[id]) throw new Error(`Só Márlon, Lucas e Julien recebem senha provisória aqui (recebido: ${id}).`);
    const senha = gerar();
    provisorias[id] = senha;
    const novo = { id, nome: PESSOAS[id], senha: hashSenha(senha), trocar: true };
    const i = lista.findIndex((u) => u.id === id);
    if (i >= 0) lista[i] = novo; else lista.push(novo);
  }
  const ordem = ['admin', 'marlon', 'lucas', 'julien'];
  lista.sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));
  for (const [id, senha] of Object.entries(provisorias)) if (!conferirSenha(senha, lista.find((u) => u.id === id).senha)) throw new Error('Conferência do hash falhou: nada foi gerado.');
  if (JSON.stringify(lista).includes('$')) throw new Error('O valor tem "$", que o EasyPanel engole. Gere de novo.');
  return { lista, provisorias };
}

async function principal() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const perguntar = (q) => new Promise((ok) => rl.question(q, (r) => ok(r.trim())));
  console.log('\nCOMPASSO: um login para cada pessoa\n');
  console.log('1. No EasyPanel, abra o serviço compasso → Ambiente e copie o valor inteiro de TAREFAS_USUARIOS.');
  let atual = '';
  for (;;) {
    atual = await perguntar('   Cole aqui e aperte Enter (Enter vazio = começar do zero, sem o admin): ');
    try { montar(atual, []); break; } catch (e) { console.log(`   ${e.message}\n`); }
  }
  const existentes = atual ? JSON.parse(atual).map((u) => u.id) : [];
  if (!existentes.includes('admin')) {
    const ok = await perguntar('   Atenção: sem o admin no valor, o login admin deixa de existir. Continuar mesmo assim? (s/N) ');
    if (!/^s/i.test(ok)) { console.log('   Nada foi gerado.'); rl.close(); return; }
  }
  const ids = [];
  console.log('\n2. Quem recebe senha provisória:');
  for (const [id, nome] of Object.entries(PESSOAS)) {
    const ja = existentes.includes(id);
    const r = await perguntar(`   ${nome}${ja ? ' (já tem login; gerar senha nova?)' : ''} (S/n) `);
    if (!/^n/i.test(r)) ids.push(id);
  }
  rl.close();
  if (!ids.length) { console.log('\nNinguém escolhido: nada foi gerado.'); return; }
  const { lista, provisorias } = montar(atual, ids);
  console.log('\n3. Em TAREFAS_USUARIOS, substitua o valor inteiro por esta linha:\n');
  console.log(JSON.stringify(lista));
  console.log('\n   Não mexa em TAREFAS_SECRET. Salve e clique em Implantar (Redeploy).\n');
  console.log('4. Senhas provisórias. Entregue a cada um em particular, nunca em grupo nem em conversa com o Claude:\n');
  for (const [id, senha] of Object.entries(provisorias)) console.log(`   ${PESSOAS[id].padEnd(7)} usuário ${id.padEnd(7)} senha provisória ${senha}`);
  console.log('\n   No primeiro acesso o app pede uma senha nova; a provisória deixa de valer na hora.');
  console.log('   Esqueceu a senha: rode este comando de novo só para aquela pessoa e faça o Redeploy.\n');
}

module.exports = { montar, senhaProvisoria, ALFABETO };
if (require.main === module) principal().catch((e) => { console.error(`\nErro: ${e.message}`); process.exit(1); });
