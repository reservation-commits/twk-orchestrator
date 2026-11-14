#!/usr/bin/env node
'use strict';
/**
 * Renova a chave do login do Instagram (vale 60 dias) e mostra a nova chave e a nova data de vencimento.
 * Não grava nada: a chave nova vai à mão para o Easypanel (IG_ACCESS_TOKEN e IG_TOKEN_EXPIRA_EM).
 *
 *   node renovar-chave.js            → usa IG_ACCESS_TOKEN do ambiente ou de ~/.twk/instagram.env
 *
 * Só serve para IG_LOGIN=instagram. O token de usuário do sistema do login pelo Facebook não vence.
 * A Meta só renova chave com mais de 24 horas e ainda válida: se já venceu, gere outra no painel do app.
 */
const { config } = require('./run');
const { limparMensagem } = require('./api');

(async () => {
  const cfg = config();
  if (cfg.login === 'facebook') { console.log('Login pelo Facebook: a chave de usuário do sistema não vence. Nada a renovar.'); return; }
  if (!cfg.token) { console.error('Sem IG_ACCESS_TOKEN no ambiente nem em ~/.twk/instagram.env.'); process.exitCode = 1; return; }
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(cfg.token)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) { console.error(`A Meta recusou: ${limparMensagem((j.error && j.error.message) || `HTTP ${r.status}`, cfg.token)}`); process.exitCode = 1; return; }
  const vence = new Date(Date.now() + (j.expires_in || 60 * 86400) * 1000).toISOString().slice(0, 10);
  console.log('Chave renovada. Troque no Easypanel (serviço da Central), depois clique em Deploy:\n');
  console.log(`IG_ACCESS_TOKEN=${j.access_token}`);
  console.log(`IG_TOKEN_EXPIRA_EM=${vence}`);
  console.log('\nApague esta saída do terminal depois de copiar.');
})().catch((e) => { console.error('Falhou:', e.message); process.exitCode = 1; });
