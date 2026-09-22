const fs = require('node:fs');
const env = Object.fromEntries(fs.readFileSync('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.n8n.local', 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const base = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json' };
const mask = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');
(async () => {
  for (const id of ['1pc2qJX4kYkBni3s', 'pMm1Qg3FEZY0THzH']) {
    const w = await (await fetch(`${base}/api/v1/workflows/${id}`, { headers: H })).json();
    const wh = (w.nodes || []).find((n) => /webhook/i.test(n.type));
    console.log(`=== ${id} | ${w.name} | POST /webhook/${wh && wh.parameters ? wh.parameters.path : '?'}`);
    const ex = await (await fetch(`${base}/api/v1/executions?workflowId=${id}&limit=6`, { headers: H })).json();
    for (const e of ex.data || []) {
      const full = await (await fetch(`${base}/api/v1/executions/${e.id}?includeData=true`, { headers: H })).json();
      const s = JSON.stringify(full.data || {});
      const urls = [...new Set((s.match(/https?:[/][/][^"' \<>]{0,90}/g) || []))].filter((u) => /reset|invite|token/i.test(u));
      const emails = [...new Set((s.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []))].slice(0, 2).map(mask);
      console.log(`  ${e.startedAt}  ${e.status.padEnd(8)} ${emails.join(',')}`);
      for (const u of urls.slice(0, 2)) console.log(`      ${u.slice(0, 78)}`);
    }
  }
})().catch((e) => console.error('ERRO', e.message));
