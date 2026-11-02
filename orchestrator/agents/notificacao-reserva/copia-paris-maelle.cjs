#!/usr/bin/env node
'use strict';
/**
 * Cópia paralela de toda reserva de Paris para Maelle Lautard (representante Admin de Paris).
 * Pedido do fundador em 2026-11-02.
 *
 *   node copia-paris-maelle.cjs                 → DRY-RUN: mostra o sub-fluxo e o gancho que entrariam no n8n
 *   node copia-paris-maelle.cjs --criar         → cria (ou atualiza, pelo nome) o sub-fluxo "Paris — cópia para Maelle Lautard".
 *                                                 Sozinho ele NÃO envia nada: só roda quando chamado pelo fluxo 1.
 *   node copia-paris-maelle.cjs --apply         → liga o gancho no fluxo ATIVO "1 - nova reserva (site novo)":
 *                                                 nó "Paris → Maelle (cópia)" saindo de "Code in JavaScript", em paralelo
 *                                                 aos e-mails de cliente e casa (waitForSubWorkflow=false).
 *                                                 ENVIO EXTERNO + NOVO FLUXO EM OPERAÇÃO → só com a frase do fundador no chat.
 *   node copia-paris-maelle.cjs --desligar      → remove o gancho do fluxo 1 (o sub-fluxo fica, inerte).
 *
 * FATOS (02/11, twk_ro + API do n8n):
 *  - Maelle Lautard existe em dois lugares: nextauth."User" (cliente, maelle.lautard@gmail.com, criada 16/10, 1 pedido
 *    no BOUM BOUM) e public.sales_representatives (id a2NTp000000gCWDMA2, role "Admin", cidade "Paris",
 *    66 rue LaFayette 75009). Nenhum rastro em contacts_pro, rest_contacts, restaurant_users, StaffUser, aria_*.
 *  - O payload do webhook /nova-reserva NÃO traz a cidade: o sub-fluxo consulta db_restaurants.city pelo restaurant_id.
 *  - Volume: 12 a 31 reservas de Paris por mês nos últimos 6 meses.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const WF1 = '1 - nova reserva (site novo)';
const NO_ORIGEM = 'Code in JavaScript';
const NO_GANCHO = 'Paris → Maelle (cópia)';
const SUB_NOME = 'Paris — cópia para Maelle Lautard';
const DESTINO = 'maelle.lautard@gmail.com';
const CIDADE = 'Paris';
const GMAIL_CRED = { id: 'hkcgjRyX7AH55iMJ', name: 'Gmail account' };
const PG_CRED = { id: 'QSEOM0Wb5DzGkuXy', name: 'Postgres account 2' };
const TRACE = 'trc-copia-paris-maelle-20261102';

function envN8n() {
  const f = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.n8n.local');
  const env = Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
  if (!env.N8N_API_KEY) throw new Error('N8N_API_KEY ausente em ' + f);
  return { url: (env.N8N_URL || env.N8N_BASE_URL || 'https://theworldkeys-n8n.xis4ee.easypanel.host').replace(/\/$/, ''), H: { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json', 'content-type': 'application/json' } };
}

const T = "$('When Executed by Another Workflow').item.json"; // saída do nó "Code in JavaScript" do fluxo 1, passada inteira
const C = "$('Preparar contatos').item.json"; // tudo pronto para o e-mail (dados + links de contato)
// ícones dourados em PNG (traço fino, fundo transparente), já hospedados para os e-mails da Aria; o de telefone é servido pelo n8n
const ICONE_WA = 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host/icons/whatsapp.png';
const ICONE_MAIL = 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host/icons/email.png';
const ICONE_SITE = 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host/icons/site.png';
const ICONE_TEL = 'https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/twk-icon-phone';

/**
 * Nó "Preparar contatos": junta reserva, casa e cliente e monta os links de contato direto
 * (tel:, https://wa.me/<dígitos>?text=…, mailto:?subject=&body=) com mensagem já preenchida.
 * Roda dentro do n8n; não depende de nada externo.
 */
function codigoContatos() {
  return `const t = $('When Executed by Another Workflow').item.json || {};
const r = $('Restaurante (cidade)').item.json || {};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const digitos = (p) => { let s = String(p || '').replace(/[^\\d+]/g, ''); if (s.startsWith('+')) s = s.slice(1); if (s.startsWith('00')) s = s.slice(2); return s; };
const waOk = (d) => d.length >= 8 && !d.startsWith('0');
const n = { ...t };
n.restaurantAddress = r.address_of_establishment || '';
n.restaurantPhone = t.restaurantPhone || r.telephone_of_the_establishment || '';
n.restaurantEmail = t.restaurantEmail || r.email_for_reservations || '';
n.restaurantUrl = r.url_page_twk || '';
n.restaurantUrlCurta = n.restaurantUrl.replace(/^https?:\\/\\/(www\\.)?/, '').replace(/\\/$/, '');
n.userPhone = t.userPhone || '';
n.userEmail = t.userEmail || '';
n.userName = t.userName || '';
n.managementUrl = t.managementUrl || '';
const resumo = \`\${t.reservationCode} · \${t.formattedDate} · \${t.formattedTime} · \${t.formattedPeople}\`;
const msgCasa = \`Bonjour, Maelle Lautard de The World Keys (Paris). Nous vous avons transmis une demande de réservation au nom de \${n.userName} : \${resumo}. Pouvez-vous me confirmer si vous pouvez l'accueillir ? Merci beaucoup.\`;
const msgCliente = \`Hello \${n.userName}, this is Maelle from The World Keys concierge in Paris, regarding your request \${t.reservationCode} at \${t.restaurantName} (\${t.formattedDate}, \${t.formattedTime}).\`;
const assCasa = \`The World Keys — demande de réservation \${t.reservationCode} (\${t.formattedDate}, \${t.formattedTime})\`;
const assCliente = \`The World Keys — your request \${t.reservationCode} at \${t.restaurantName}\`;
const dCasa = digitos(n.restaurantPhone), dCliente = digitos(n.userPhone);
n.telCasa = n.restaurantPhone ? 'tel:' + (dCasa ? '+' + dCasa : n.restaurantPhone) : '';
n.telCliente = n.userPhone ? 'tel:' + (dCliente ? '+' + dCliente : n.userPhone) : '';
n.waCasa = waOk(dCasa) ? 'https://wa.me/' + dCasa + '?text=' + encodeURIComponent(msgCasa) : '';
n.waCliente = waOk(dCliente) ? 'https://wa.me/' + dCliente + '?text=' + encodeURIComponent(msgCliente) : '';
n.mailCasa = n.restaurantEmail ? 'mailto:' + n.restaurantEmail + '?subject=' + encodeURIComponent(assCasa) + '&body=' + encodeURIComponent(msgCasa) : '';
n.mailCliente = n.userEmail ? 'mailto:' + n.userEmail + '?subject=' + encodeURIComponent(assCliente) + '&body=' + encodeURIComponent(msgCliente) : '';
n.avisoCliente = n.userPhone && !waOk(dCliente) ? 'numéro sans indicatif international — WhatsApp indisponible' : '';
n.avisoCasa = n.restaurantPhone && !waOk(dCasa) ? 'numéro sans indicatif international — WhatsApp indisponible' : '';
// Barra de ações no pé do bloco: filete, depois cada ação num círculo dourado (PNG hospedado; Gmail não aceita SVG)
// com rótulo discreto embaixo. 3 ações × 64 px cabem em tela de celular sem quebrar.
const ICONES = { tel: '${ICONE_TEL}', wa: '${ICONE_WA}', mail: '${ICONE_MAIL}' };
const FILETE = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin-top:12px;"><tr><td style="border-top:1px solid #26200F; font-size:0; line-height:0;">&nbsp;</td></tr></table>';
const acao = (href, src, rotulo) => href ? \`<td width="64" align="center" valign="top" style="width:64px; padding:12px 6px 0 0;">
<a href="\${esc(href)}" target="_blank" title="\${rotulo}" style="text-decoration:none;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate; margin:0 auto;"><tr><td width="38" height="38" align="center" valign="middle" style="width:38px; height:38px; border:1px solid #4A3F24; border-radius:19px; background-color:#1C1811;"><img src="\${src}" width="22" height="22" alt="\${rotulo}" style="display:block; width:22px; height:22px; border:0;" border="0" /></td></tr></table>
<div style="padding-top:6px; font-family:Arial,Helvetica,sans-serif; font-size:9px; letter-spacing:1.5px; text-transform:uppercase; color:#B5AB93; white-space:nowrap;">\${rotulo}</div>
</a></td>\` : '';
const barra = (tel, wa, mail) => { const b = acao(tel, ICONES.tel, 'Appeler') + acao(wa, ICONES.wa, 'WhatsApp') + acao(mail, ICONES.mail, 'E-mail'); return FILETE + (b ? \`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>\${b}</tr></table>\` : '<p style="margin:10px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8F8368;">Aucun contact disponible.</p>'); };
n.botoesCasa = barra(n.telCasa, n.waCasa, n.mailCasa);
n.botoesCliente = barra(n.telCliente, n.waCliente, n.mailCliente);
n.botoesReserva = FILETE + \`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; margin-top:12px;"><tr><td align="center" style="background-color:#CE9E3C; border-radius:6px;"><a href="\${esc(n.managementUrl)}" target="_blank" style="display:inline-block; padding:11px 22px; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; color:#0B0A08; text-decoration:none;">Suivre la demande</a></td></tr></table>\`;
for (const k of ['restaurantName','restaurantAddress','restaurantPhone','restaurantEmail','userName','userEmail','userPhone','formattedDetails','reservationStatus']) n[k + 'Html'] = esc(n[k]);
return [{ json: n }];`;
}

function emailHtml() {
  // rótulo com largura fixa e sem quebra; valor com quebra forçada em URLs e e-mails longos (celular)
  const linha = (rotulo, valor) => `<tr><td width="112" style="width:112px; padding:5px 12px 5px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8F8368; vertical-align:top; white-space:nowrap;">${rotulo}</td><td style="padding:5px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#F5EFE3; vertical-align:top; word-break:break-word; overflow-wrap:anywhere;">${valor}</td></tr>`;
  // bloco: título, dados, e no pé a barra de ações (filete + ícones com rótulo) ou o botão
  const bloco = (titulo, linhas, rodape) => `<tr><td style="padding:12px 20px 0 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate; background-color:#17140E; border:1px solid #26200F; border-radius:12px;"><tr><td style="padding:14px 16px 14px 16px;">
<div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:3px; color:#CE9E3C; padding-bottom:6px;">${titulo}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
${linhas.join('\n')}
</table>
${rodape}
</td></tr></table></td></tr>`;
  const tel = (campo, aviso) => `{{ ${C}.${campo} ? ${C}.${campo} : '—' }}{{ ${C}.${aviso} ? ' <span style="color:#8F8368; font-size:12px;">(' + ${C}.${aviso} + ')</span>' : '' }}`;
  return `=<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="dark" /><title>Nouvelle demande — Paris</title></head>
<body style="margin:0; padding:0; background-color:#0B0A08;">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">Paris — {{ ${C}.restaurantName }} — {{ ${C}.formattedDate }}, {{ ${C}.formattedTime }}, {{ ${C}.formattedPeople }}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0B0A08; border-collapse:collapse;"><tr><td align="center" style="padding:12px 6px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#12100C; border:1px solid #26200F; border-radius:16px; border-collapse:separate; overflow:hidden;">
<tr><td align="center" style="padding:32px 20px 0 20px;">
<img src="https://img.mailinblue.com/6331555/images/content_library/original/661430b29475332809dc25ad.png" width="200" alt="THE WORLD KEYS" style="display:block; margin:0 auto; width:200px; height:auto; border:0;" border="0" />
<div style="font-family:Arial,Helvetica,sans-serif; font-size:10px; letter-spacing:4px; color:#8F8368; padding-top:10px;">PARIS · COPIE INTERNE</div>
</td></tr>
<tr><td align="center" style="padding:20px 20px 0 20px;"><table role="presentation" width="48" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #CE9E3C; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>
<tr><td align="center" style="padding:22px 20px 6px 20px;"><h1 style="margin:0; font-family:Georgia,'Times New Roman',serif; font-weight:normal; font-size:24px; line-height:1.3; color:#F5EFE3;">Nouvelle demande de réservation à Paris</h1></td></tr>
<tr><td align="center" style="padding:0 24px 6px 24px;"><p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#B5AB93;">Bonjour Maelle, voici la copie d'une demande reçue à l'instant. Le restaurant et le client ont déjà reçu leurs e-mails habituels. Les actions au bas de chaque bloc ouvrent un appel, WhatsApp ou un e-mail avec le message déjà rédigé — à relire avant d'envoyer.</p></td></tr>
${bloco('RÉSERVATION', [
  linha('Code', `<strong style="font-size:16px; letter-spacing:1px;">{{ ${C}.reservationCode }}</strong>`),
  linha('Date', `{{ ${C}.formattedDate }}`),
  linha('Heure', `{{ ${C}.formattedTime }}`),
  linha('Couverts', `{{ ${C}.formattedPeople }}`),
  linha('Statut', `{{ ${C}.reservationStatusHtml }}`),
  linha('Demande du client', `{{ ${C}.formattedDetailsHtml }}`),
], `{{ ${C}.botoesReserva }}`)}
${bloco('RESTAURANT', [
  linha('Nom', `<strong>{{ ${C}.restaurantNameHtml }}</strong>`),
  linha('Adresse', `{{ ${C}.restaurantAddressHtml || '—' }}`),
  linha('Téléphone', tel('restaurantPhoneHtml', 'avisoCasa')),
  linha('E-mail', `{{ ${C}.restaurantEmailHtml || '—' }}`),
  linha('Page TWK', `<a href="{{ ${C}.restaurantUrl }}" target="_blank" style="color:#CE9E3C; text-decoration:none;">{{ ${C}.restaurantUrlCurta }}</a>`),
], `{{ ${C}.botoesCasa }}`)}
${bloco('CLIENT', [
  linha('Nom', `<strong>{{ ${C}.userNameHtml }}</strong>`),
  linha('E-mail', `{{ ${C}.userEmailHtml || '—' }}`),
  linha('Téléphone', tel('userPhoneHtml', 'avisoCliente')),
], `{{ ${C}.botoesCliente }}`)}
<tr><td align="center" style="padding:20px 24px 30px 24px;"><p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.6; color:#6E6550;">Copie interne envoyée automatiquement pour chaque demande concernant un restaurant de Paris. Données personnelles du client : usage strictement limité au suivi de cette réservation. Ne jamais confirmer une table avant la réponse du restaurant.</p></td></tr>
</table></td></tr></table>
</body></html>`;
}

/** Definição do sub-fluxo (fonte da verdade). */
function subWorkflow() {
  return {
    name: SUB_NOME,
    settings: { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner' },
    nodes: [
      { parameters: { inputSource: 'passthrough' }, name: 'When Executed by Another Workflow', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1, position: [-600, 0], id: 'c0a1e7b0-0001-4a00-8000-000000000001' },
      {
        parameters: {
          operation: 'executeQuery',
          query: 'SELECT restaurant_id, name, city, country, address_of_establishment, email_for_reservations, telephone_of_the_establishment, url_page_twk\nFROM public.db_restaurants\nWHERE restaurant_id = $1::text\nLIMIT 1;',
          options: { queryReplacement: `={{ ${T}.restaurantId }}` },
        },
        name: 'Restaurante (cidade)', type: 'n8n-nodes-base.postgres', typeVersion: 2.6, position: [-380, 0], id: 'c0a1e7b0-0002-4a00-8000-000000000002',
        alwaysOutputData: true, credentials: { postgres: PG_CRED },
      },
      {
        parameters: {
          conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 3 }, conditions: [{ id: 'c0a1e7b0-0003-4a00-8000-00000000cond', leftValue: '={{ $json.city }}', rightValue: CIDADE, operator: { type: 'string', operation: 'equals' } }], combinator: 'and' },
          options: {},
        },
        name: 'É Paris?', type: 'n8n-nodes-base.if', typeVersion: 2.3, position: [-160, 0], id: 'c0a1e7b0-0003-4a00-8000-000000000003',
      },
      { parameters: { jsCode: codigoContatos() }, name: 'Preparar contatos', type: 'n8n-nodes-base.code', typeVersion: 2, position: [60, -100], id: 'c0a1e7b0-0006-4a00-8000-000000000006' },
      {
        parameters: {
          sendTo: DESTINO,
          subject: `=Paris · Nouvelle demande — {{ ${C}.restaurantName }} — {{ ${C}.formattedDate }}, {{ ${C}.formattedTime }} ({{ ${C}.reservationCode }})`,
          message: emailHtml(),
          options: { appendAttribution: false },
        },
        name: 'E-mail para Maelle', type: 'n8n-nodes-base.gmail', typeVersion: 2.2, position: [280, -100], id: 'c0a1e7b0-0004-4a00-8000-000000000004',
        credentials: { gmailOAuth2: GMAIL_CRED },
      },
      { parameters: {}, name: 'Fora de Paris (nada a fazer)', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [60, 120], id: 'c0a1e7b0-0005-4a00-8000-000000000005' },
    ],
    connections: {
      'When Executed by Another Workflow': { main: [[{ node: 'Restaurante (cidade)', type: 'main', index: 0 }]] },
      'Restaurante (cidade)': { main: [[{ node: 'É Paris?', type: 'main', index: 0 }]] },
      'É Paris?': { main: [[{ node: 'Preparar contatos', type: 'main', index: 0 }], [{ node: 'Fora de Paris (nada a fazer)', type: 'main', index: 0 }]] },
      'Preparar contatos': { main: [[{ node: 'E-mail para Maelle', type: 'main', index: 0 }]] },
    },
    staticData: null,
  };
}

function noGancho(subId) {
  return {
    parameters: {
      workflowId: { __rl: true, value: subId, mode: 'list', cachedResultUrl: `/workflow/${subId}`, cachedResultName: SUB_NOME },
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      options: { waitForSubWorkflow: false },
    },
    name: NO_GANCHO, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [-592, 60], id: 'c0a1e7b0-0010-4a00-8000-000000000010',
  };
}

function audit(ev) {
  const f = path.join(RAIZ, 'orchestrator', 'logs', `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(f, JSON.stringify({ ts: new Date().toISOString(), trace_id: TRACE, agente: 'orquestrador', ...ev }) + '\n');
}

async function api(url, H, p, init) {
  const r = await fetch(url + p, { headers: H, ...init });
  if (!r.ok) throw new Error(`${init?.method || 'GET'} ${p} → HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

(async () => {
  const args = process.argv.slice(2);
  const criar = args.includes('--criar'), apply = args.includes('--apply'), desligar = args.includes('--desligar');
  const { url, H } = envN8n();
  const lista = (await api(url, H, '/api/v1/workflows?limit=250')).data || [];
  const w1 = lista.find((x) => x.name === WF1);
  if (!w1) throw new Error(`fluxo "${WF1}" não encontrado`);
  let sub = lista.find((x) => x.name === SUB_NOME);
  const def = subWorkflow();
  console.log(`fluxo 1: ${w1.id} · ativo=${w1.active} · sub-fluxo "${SUB_NOME}": ${sub ? sub.id + ' (já existe)' : 'ainda não existe'}`);

  if (criar) {
    const corpo = { name: def.name, nodes: def.nodes, connections: def.connections, settings: def.settings, staticData: null };
    sub = sub ? await api(url, H, `/api/v1/workflows/${sub.id}`, { method: 'PUT', body: JSON.stringify(corpo) })
              : await api(url, H, '/api/v1/workflows', { method: 'POST', body: JSON.stringify(corpo) });
    const conf = await api(url, H, `/api/v1/workflows/${sub.id}`);
    const ok = conf.nodes.length === def.nodes.length && conf.nodes.some((n) => n.name === 'E-mail para Maelle' && n.parameters.sendTo === DESTINO) && JSON.stringify(conf.connections) === JSON.stringify(def.connections);
    audit({ evento: 'n8n_workflow_criado', workflow: sub.id, nome: SUB_NOME, destino: DESTINO, cidade: CIDADE, ativo: conf.active, ligado_ao_fluxo_1: false, conferido: ok });
    console.log(ok ? `sub-fluxo gravado e conferido: ${sub.id} (${conf.nodes.length} nós, ativo=${conf.active}). Inerte até o gancho (--apply).` : `ATENÇÃO: gravou ${sub.id} mas a releitura diverge — conferir no n8n.`);
    return;
  }

  const d = await api(url, H, `/api/v1/workflows/${w1.id}`);
  const origem = d.nodes.find((n) => n.name === NO_ORIGEM);
  if (!origem) throw new Error(`nó "${NO_ORIGEM}" não encontrado no fluxo 1`);
  const jaTem = d.nodes.some((n) => n.name === NO_GANCHO);
  const salvar = async (mudanca, extra) => {
    const corpo = { name: d.name, nodes: d.nodes, connections: d.connections, settings: d.settings || {}, staticData: d.staticData ?? null };
    await api(url, H, `/api/v1/workflows/${w1.id}`, { method: 'PUT', body: JSON.stringify(corpo) });
    const conf = await api(url, H, `/api/v1/workflows/${w1.id}`);
    const ligado = conf.nodes.some((n) => n.name === NO_GANCHO) && (conf.connections[NO_ORIGEM]?.main?.[0] || []).some((c) => c.node === NO_GANCHO);
    audit({ evento: 'n8n_workflow_alterado', workflow: w1.id, no: NO_GANCHO, mudanca, ligado, ...extra });
    return ligado;
  };

  if (desligar) {
    if (!jaTem) { console.log('gancho não está no fluxo 1. Nada a fazer.'); return; }
    d.nodes = d.nodes.filter((n) => n.name !== NO_GANCHO);
    d.connections[NO_ORIGEM].main[0] = d.connections[NO_ORIGEM].main[0].filter((c) => c.node !== NO_GANCHO);
    delete d.connections[NO_GANCHO];
    const ligado = await salvar('gancho removido', {});
    console.log(ligado ? 'ATENÇÃO: a releitura ainda mostra o gancho.' : 'gancho removido e conferido. O sub-fluxo continua existindo, inerte.');
    return;
  }

  if (jaTem) { console.log('já aplicado: o gancho está no fluxo 1. Nada a fazer.'); return; }
  if (!sub) { console.log('o sub-fluxo ainda não existe: rode --criar primeiro.'); if (apply) process.exit(2); }
  console.log(`gancho: nó "${NO_GANCHO}" (executeWorkflow → ${sub ? sub.id : '<sub-fluxo>'}, waitForSubWorkflow=false) ligado à saída de "${NO_ORIGEM}", ao lado de "${(d.connections[NO_ORIGEM].main[0] || []).map((c) => c.node).join(', ')}".`);
  console.log(`sub-fluxo: ${def.nodes.map((n) => n.name).join(' → ')} · destino ${DESTINO} · filtro db_restaurants.city = '${CIDADE}'`);
  if (!apply) { console.log('\nDRY-RUN — nada gravado no fluxo 1. Para ligar (com a frase do fundador registrada no chat): --apply'); return; }

  // o n8n só aceita referência a sub-fluxo publicado: ativar primeiro (um sub-fluxo ativo continua inerte sem o gancho)
  if (!sub.active) {
    await api(url, H, `/api/v1/workflows/${sub.id}/activate`, { method: 'POST' });
    audit({ evento: 'n8n_workflow_ativado', workflow: sub.id, nome: SUB_NOME, motivo: 'exigência do n8n para ser referenciado pelo fluxo 1' });
    console.log(`sub-fluxo ${sub.id} publicado (ativo).`);
  }
  d.nodes.push(noGancho(sub.id));
  d.connections[NO_ORIGEM].main[0].push({ node: NO_GANCHO, type: 'main', index: 0 });
  const ligado = await salvar('gancho "Paris → Maelle (cópia)" ligado em paralelo à saída de "Code in JavaScript"', { sub_workflow: sub.id, destino: DESTINO, aprovacao: 'frase do fundador no chat (2026-11-02)' });
  console.log(ligado ? 'APLICADO e conferido: toda nova reserva de Paris passa a ir, em paralelo, para ' + DESTINO : 'ATENÇÃO: gravou, mas a releitura não encontrou o gancho — conferir no n8n.');
})().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });
