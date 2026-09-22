const fs = require('node:fs');
const BS = String.fromCharCode(92);
const env = Object.fromEntries(fs.readFileSync('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.n8n.local', 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const base = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json' };
const RE_URL = /https?:[/][/][^"' <>]{0,140}/g;
const QUEBRA = /=([0-9A-Fa-f]{2}|[{][{])/;
(async () => {
  for (const id of process.argv.slice(2)) {
    const w = await (await fetch(`${base}/api/v1/workflows/${id}`, { headers: H })).json();
    console.log('===', id, '|', w.name, '| ativo =', w.active);
    for (const n of w.nodes || []) {
      if (!/gmail|emailSend/i.test(n.type)) continue;
      const msg = JSON.stringify(n.parameters || {}).split(BS).join('');
      const urls = [...new Set(msg.match(RE_URL) || [])].filter((u) => u.includes('=') && !u.includes('google.com/maps') && QUEBRA.test(u));
      if (urls.length) console.log(`  [${n.name}]\n    ` + urls.join('\n    '));
    }
  }
})().catch((e) => console.error('ERRO', e.message));
