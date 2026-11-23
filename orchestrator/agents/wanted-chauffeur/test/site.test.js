'use strict';
/** O site /ride (orchestrator/sites/wanted-chauffeur-ride): arquivos citados existem, nada de script embutido, preços batem com o servidor. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PRECO_CENT } = require('../reservas.js');

const SITE = path.join(__dirname, '..', '..', '..', 'sites', 'wanted-chauffeur-ride', 'public');
const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');

test('index.html: todo arquivo local citado existe, por caminho relativo (raiz de ride.theworldkeys.com ou /ride/ na Central); sem script embutido; sem dados de exemplo', () => {
  const refs = [...html.matchAll(/(?:href|src)="((?:css|js|img)\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 8, 'esperava css, js e imagens por caminho relativo');
  assert.ok(!/(?:href|src)="\/(?:ride|css|js|img)\//.test(html), 'caminho absoluto quebra na raiz do subdomínio ou em /ride/');
  assert.ok(html.includes('href="https://ride.theworldkeys.com/"'), 'canonical no subdomínio');
  for (const r of refs) assert.ok(fs.existsSync(path.join(SITE, r)), `falta public/${r}`);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), 'script embutido não roda com a CSP da Central');
  assert.ok(!/\sstyle="[^"]*"/.test(html), 'estilo fica nos arquivos css');
  assert.ok(!/value="Léa Martin"|value="Place du Capitole"|value="2026-/.test(html), 'nada preenchido de exemplo');
  for (const id of ['form', 'produit', 'heures', 'date', 'heure', 'seg', 'jours', 'dispo', 'depart', 'arrivee', 'nom', 'tel', 'msg', 'img', 'total', 'submit', 'bubble', 'wa', 'copy', 'refout', 'numout', 'toast', 'menu', 'menubtn']) {
    assert.ok(html.includes(`id="${id}"`), `index.html precisa do id ${id} (formulario.js usa)`);
  }
});

test('módulos: todo import relativo aponta para um arquivo que existe', () => {
  const js = path.join(SITE, 'js');
  for (const f of fs.readdirSync(js)) {
    for (const m of fs.readFileSync(path.join(js, f), 'utf8').matchAll(/from '(\.\/[^']+)'/g)) assert.ok(fs.existsSync(path.join(js, m[1])), `${f} importa ${m[1]}, que não existe`);
  }
});

test('preços da página = preços que o servidor grava (reservas.js)', async () => {
  const { PRODUTOS, montante } = await import(pathToFileURL(path.join(SITE, 'js', 'precos.js')).href);
  assert.deepEqual(Object.keys(PRODUTOS).sort(), Object.keys(PRECO_CENT).sort());
  for (const [k, p] of Object.entries(PRODUTOS)) assert.equal(p.preco * 100, PRECO_CENT[k], `${k}: página ${p.preco} € × servidor ${PRECO_CENT[k] / 100} €`);
  assert.equal(montante('mad', 3), 270); assert.equal(montante('mad', 1), 180); assert.equal(montante('game'), 350);
});

test('datas da página: AM/PM e dia por extenso iguais aos do servidor', async () => {
  const D = await import(pathToFileURL(path.join(SITE, 'js', 'datas.js')).href);
  const A = require('../agenda.js');
  for (const h of ['12:00 AM', '12:30 PM', '9:00 PM', '11:55 PM', '1:05 AM']) assert.equal(D.horaParaMin(h), A.horaParaMin(h), h);
  assert.equal(D.horarios(5).length, 288); assert.equal(D.horarios(5)[252], '9:00 PM');
  assert.equal(D.dataLonga('2026-11-24'), 'mardi 24 novembre');
  assert.deepEqual(D.rotuloDia('2026-11-24'), { semana: 'mar.', dia: '24', mes: 'nov.' });
});
