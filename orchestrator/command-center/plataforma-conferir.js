#!/usr/bin/env node
'use strict';
/**
 * PANORAMA — conferência: todo número que uma página cita precisa existir no instantâneo.
 *
 *   node plataforma-conferir.js [http://localhost:8787] [chave]
 *
 * Lê /api/plataforma/registro (as páginas) e /api/plataforma (os números) e confere, para cada
 * referência "metrica.campo" ou "metrica": a métrica existe? foi lida (s = ok)? o campo existe?
 * Sem leitura por falta de credencial de um agente (api_*) é LACUNA declarada, não erro.
 * Sai com 1 se alguma referência estiver quebrada — página que cita número inexistente não sobe.
 */
const base = (process.argv[2] || 'http://localhost:8787').replace(/\/+$/, '');
const chave = process.argv[3] || process.env.CENTER_TOKEN || '';
const cab = chave ? { 'x-center-key': chave } : {};

function refsDe(pg) {
  const out = [];
  const tile = (t, onde) => out.push({ ref: t.ref, onde, tipo: 'numero' });
  const item = (b, onde) => {
    if (b.tipo === 'numeros') (b.tiles || []).forEach((t) => tile(t, onde));
    else if (b.tipo === 'dupla') (b.itens || []).forEach((x) => item(x, onde));
    else if (['linha', 'ranking', 'funil', 'tabela'].includes(b.tipo)) {
      const campos = b.tipo === 'linha' ? [b.x || 'periodo', ...(b.series || [{ campo: 'valor' }]).map((s) => s.campo)]
        : b.tipo === 'ranking' ? [b.rotulo || 'rotulo', b.valor || 'valor', ...(b.extra ? [b.extra.campo] : [])]
        : b.tipo === 'funil' ? (b.passos || []).map((p) => p.campo)
        : (b.colunas || []).map((c) => c.campo);
      out.push({ ref: b.id, onde, tipo: b.tipo, campos });
    }
  };
  (pg.resumo || []).forEach((t) => tile(t, `${pg.id} · cartão`));
  (pg.blocos || []).forEach((bl) => (bl.itens || []).forEach((b) => item(b, `${pg.id} · ${bl.titulo}`)));
  return out;
}

(async () => {
  const reg = await (await fetch(`${base}/api/plataforma/registro`, { headers: cab })).json();
  const snap = await (await fetch(`${base}/api/plataforma`, { headers: cab })).json();
  if (!reg.paginas || !snap.metricas) { console.error('FALHA: a Central não devolveu registro ou instantâneo', reg.error || snap.error || ''); process.exit(2); }
  let ok = 0; const quebradas = []; const lacunas = []; const vazias = [];
  for (const pg of reg.paginas) {
    for (const r of refsDe(pg)) {
      const [id, campo] = String(r.ref).split('.');
      const m = snap.metricas[id];
      if (!m) { quebradas.push(`${r.onde}: métrica "${id}" não existe`); continue; }
      if (m.s !== 'ok') { (id.startsWith('api_') || m.s === 'lacuna' ? lacunas : quebradas).push(`${r.onde}: "${r.ref}" sem leitura — ${m.erro}`); continue; }
      const l0 = m.linhas[0];
      if (r.tipo === 'numero') {
        if (!l0) { vazias.push(`${r.onde}: "${r.ref}" sem linhas`); continue; }
        if (!(campo in l0)) { quebradas.push(`${r.onde}: campo "${campo}" não existe em "${id}" (tem: ${Object.keys(l0).join(', ')})`); continue; }
        if (l0[campo] === null) vazias.push(`${r.onde}: "${r.ref}" veio vazio`);
        ok++;
      } else {
        if (!l0) { vazias.push(`${r.onde}: "${id}" (${r.tipo}) sem linhas`); ok++; continue; }
        const faltam = (r.campos || []).filter((c) => !(c in l0));
        if (faltam.length) quebradas.push(`${r.onde}: "${id}" sem o(s) campo(s) ${faltam.join(', ')} (tem: ${Object.keys(l0).join(', ')})`);
        else ok++;
      }
    }
  }
  const usadas = new Set(reg.paginas.flatMap((pg) => refsDe(pg).map((r) => String(r.ref).split('.')[0])));
  const semUso = Object.keys(snap.metricas).filter((k) => !usadas.has(k));
  console.log(`\nPanorama · ${reg.paginas.length} páginas${reg.faltando && reg.faltando.length ? ` (faltando: ${reg.faltando.join(', ')})` : ''} · ${Object.keys(snap.metricas).length} métricas no instantâneo`);
  console.log(`referências corretas: ${ok} · quebradas: ${quebradas.length} · sem leitura declarada: ${lacunas.length} · vazias: ${vazias.length}`);
  for (const q of quebradas) console.log('  QUEBRADA  ' + q);
  for (const v of vazias) console.log('  vazia     ' + v);
  const porMotivo = lacunas.reduce((o, l) => { const k = l.split(' sem leitura — ')[1] || '?'; o[k] = (o[k] || 0) + 1; return o; }, {});
  for (const [k, n] of Object.entries(porMotivo)) console.log(`  lacuna    ${n} referência(s): ${k}`);
  if (semUso.length) console.log(`  métricas lidas e não mostradas em nenhuma página: ${semUso.join(', ')}`);
  for (const f of Object.values(snap.fontes || {})) console.log(`  fonte     ${f.nome}: ${f.status} — ${String(f.detalhe).slice(0, 150)}`);
  process.exitCode = quebradas.length ? 1 : 0;
})().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });
