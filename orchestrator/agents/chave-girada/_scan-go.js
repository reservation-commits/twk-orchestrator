const fs = require('node:fs');
const env = Object.fromEntries(fs.readFileSync('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.n8n.local', 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const base = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json' };
(async () => {
  const j = await (await fetch(`${base}/api/v1/workflows?limit=250`, { headers: H })).json();
  const alvos = [];
  for (const w of j.data || []) {
    const full = await (await fetch(`${base}/api/v1/workflows/${w.id}`, { headers: H })).json();
    const wh = (full.nodes || []).find((n) => /webhook/i.test(n.type) && /^go$/i.test(String((n.parameters || {}).path || '')));
    if (wh) alvos.push({ id: w.id, name: w.name, active: w.active });
  }
  console.log('workflow(s) do /go:', JSON.stringify(alvos));
  for (const a of alvos) {
    const ex = await (await fetch(`${base}/api/v1/executions?workflowId=${a.id}&limit=100`, { headers: H })).json();
    const lista = ex.data || [];
    console.log(`\nexecucoes de /go retornadas: ${lista.length}`);
    let ok = 0, quebrados = 0;
    for (const e of lista) {
      const full = await (await fetch(`${base}/api/v1/executions/${e.id}?includeData=true`, { headers: H })).json();
      const s = JSON.stringify(full.data || {});
      const q = (s.match(/"query":\{[^}]*\}/) || [])[0] || '';
      const temRidOk = /"rid":"\d+"/.test(q);
      const temRidQuebrado = /"rid[^"]/.test(q) || (/"c":/.test(q) && !temRidOk);
      if (temRidOk) ok++; else if (temRidQuebrado) quebrados++;
      console.log(`  ${e.startedAt}  ${String(e.status).padEnd(8)} ${q.slice(0, 120)}`);
    }
    console.log(`\n  rid intacto: ${ok} | rid ausente/quebrado: ${quebrados}`);
  }
})().catch((e) => console.error('ERRO', e.message));
