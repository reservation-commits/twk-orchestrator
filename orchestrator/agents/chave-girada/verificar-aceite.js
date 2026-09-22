#!/usr/bin/env node
'use strict';
/**
 * Verificador dos critérios de aceite do briefing ao desenvolvimento (docs/agentes/BRIEF-DEV-2026-09-07.md).
 * Somente leitura: HTTP GET nas páginas públicas + consultas na réplica read-only. Não envia, não escreve.
 *
 *   node verificar-aceite.js            → roda tudo e imprime o quadro
 *   node verificar-aceite.js --json     → saída em JSON (para gravar histórico)
 *
 * Cada item devolve PASSA / FALHA / MANUAL / INDETERMINADO. Em página que monta por JavaScript, achar a
 * frase prova que ela existe; NÃO achar não prova ausência — daí INDETERMINADO, nunca um PASSA silencioso. "MANUAL" = precisa de ação humana para ser exercido
 * (ex.: aprovar uma candidatura de teste); o script mostra o que observar.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const json = process.argv.includes('--json');
const resultados = [];

const reg = (id, titulo, estado, detalhe) => resultados.push({ id, titulo, estado, detalhe });

function envRO() {
  const p = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

async function pega(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try { const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', ...opts }); return { status: r.status, corpo: await r.text().catch(() => '') }; }
  catch (e) { return { status: 0, corpo: '', erro: e.message }; }
  finally { clearTimeout(t); }
}

/** Baixa a página e todos os scripts que ela carrega, e procura a frase no conjunto. */
async function frasePresente(pagina, frase) {
  const p = await pega(pagina);
  const alvos = [p.corpo];
  const srcs = [...new Set([...p.corpo.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]))].slice(0, 40);
  for (const s of srcs) {
    const u = s.startsWith('http') ? s : new URL(s, pagina).toString();
    alvos.push((await pega(u)).corpo);
  }
  return { achou: alvos.some((t) => t.includes(frase)), scripts: srcs.length, status: p.status };
  // Atenção: estas páginas montam por JavaScript. Encontrar a frase é prova de que ela existe;
  // NÃO encontrar não prova ausência (chunks carregados sob demanda não são varridos daqui).
}

async function main() {
  const { Client } = require(path.join(RAIZ, 'Agente Comercial', 'service', 'node_modules', 'pg'));
  const c = new Client({ connectionString: envRO().DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // ---- P0.3 · despublicado deve dar 404
  const r1 = await pega('https://theworldkeys.com/hospitality/canete/');
  reg('P0.3', 'published=false → 404 na ficha (regressão)', r1.status === 404 ? 'PASSA' : 'FALHA',
    `GET /hospitality/canete/ (seguindo redirect) → ${r1.status}; esperado 404 — resolvido em 07/09, aqui só para pegar regressão`);

  // ---- P0.2 · /r/ de reserva vencida: sem botões e sem contato do cliente
  const q = await c.query(`select reservation_code from public.reservations
     where expired_at is not null and reservation_code is not null
     order by created_date desc limit 1`);
  if (!q.rowCount) {
    reg('P0.2', '/r/ vencido em só leitura', 'MANUAL', 'nenhuma reserva com expired_at para testar');
  } else {
    const cod = q.rows[0].reservation_code;
    const r2 = await pega(`https://theworldkeys.com/r/${cod}`);
    const temBotao = /Decline|Recusar|Propose Reschedule|Accept\b/i.test(r2.corpo);
    const temContato = /[\w.+-]+@[\w.-]+\.\w{2,}/.test(r2.corpo.replace(/(support|reservation|contact)@theworldkeys\.com/gi, ''));
    const ok = r2.status === 200 && !temBotao && !temContato;
    reg('P0.2', '/r/ vencido: sem botões e sem contato', ok ? 'PASSA' : 'FALHA',
      `código ${cod} → ${r2.status}; botões=${temBotao ? 'presentes' : 'ausentes'}; e-mail de cliente=${temContato ? 'presente' : 'ausente'}`);
  }

  // ---- P1.1 · frase falsa na landing do manager
  const f1 = await frasePresente('https://manager.theworldkeys.com/', 'Trusted by hundreds');
  reg('P1.1', '"Trusted by hundreds" ausente', f1.achou ? 'FALHA' : 'INDETERMINADO', `página + ${f1.scripts} scripts varridos; frase ${f1.achou ? 'AINDA presente' : 'não encontrada — NÃO prova ausência, conferir no DOM'}`);

  // ---- marca antiga no /register (já corrigido em 09/2026 — fica como regressão)
  const f2 = await frasePresente('https://manager.theworldkeys.com/register', "World's Kitchen");
  reg('REG', 'sem "World\'s Kitchen" no /register', f2.achou ? 'FALHA' : 'INDETERMINADO', `página + ${f2.scripts} scripts varridos`);

  // ---- P0.1 · o número que o projeto persegue
  const contas = await c.query(`select count(*)::int n from restaurant_users`);
  const conv = await c.query(`select restaurant_name, status, to_char(created_at,'YYYY-MM-DD HH24:MI') criado,
      to_char(expires_at,'YYYY-MM-DD HH24:MI') expira, completed_at is not null concluido
      from restaurant_invitations order by created_at desc limit 5`);
  const externas = contas.rows[0].n - 2; // linha de base 08/09: Le Julien (interna) + teste do BOTECO; Marlon Food excluido em 08/09
  reg('P0.1', 'candidatura → conta concluída', externas > 0 ? 'PASSA' : 'MANUAL',
    `restaurant_users = ${contas.rows[0].n} (${externas > 0 ? externas + ' externa(s)' : 'nenhuma externa'}); últimas candidaturas: ` +
    conv.rows.map((x) => `${x.restaurant_name}[${x.status}${x.concluido ? '·concluída' : ''}]`).join(', '));

  await c.end();

  if (json) { console.log(JSON.stringify({ ts: new Date().toISOString(), resultados }, null, 2)); return; }
  const marca = { PASSA: '  OK  ', FALHA: ' FALHA', MANUAL: 'MANUAL', INDETERMINADO: '  ??  ' };
  console.log(`\nVerificação dos critérios de aceite · ${new Date().toISOString()}\n`);
  for (const r of resultados) console.log(`[${marca[r.estado]}] ${r.id.padEnd(5)} ${r.titulo}\n              ${r.detalhe}`);
  const falhas = resultados.filter((r) => r.estado === 'FALHA').length;
  console.log(`\n${resultados.length} itens · ${resultados.filter((r) => r.estado === 'PASSA').length} passam · ${falhas} falham · ${resultados.filter((r) => r.estado === 'MANUAL').length} dependem de ação humana · ${resultados.filter((r) => r.estado === 'INDETERMINADO').length} indeterminados`);
}
main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
