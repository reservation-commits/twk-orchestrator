'use strict';
/**
 * Juiz de Catálogo — julga UMA ficha de restaurante (como ficaria após a correção proposta).
 * Alimenta `juiz_catalogo_nota` do motor de políticas (PROP-101 republicar após correção).
 *
 * peca = { restaurant_id, nome, slug, published, ready_pending_photo, phone, email, website,
 *          city, country, lat, lng, opening_hours: [{dia:0-6, abre:'HH:MM', fecha:'HH:MM'}] | [],
 *          opt_out_ativo, pedido_remocao_do_estabelecimento }
 * contexto = { dominios_mortos?: string[], cidades_canonicas?: string[] }
 */
const { julgar } = require('./juiz');

const horariosGenericos = (hs) => {
  if (!Array.isArray(hs) || hs.length === 0) return { generico: true, detalhe: 'sem horários' };
  const chaves = new Set(hs.map((h) => `${h.abre}-${h.fecha}`));
  const dias = new Set(hs.map((h) => h.dia));
  if (chaves.size === 1 && dias.size >= 6) return { generico: true, detalhe: `1 intervalo idêntico em ${dias.size} dias (padrão dos 413 genéricos)` };
  return { generico: false, detalhe: `${chaves.size} intervalos distintos, ${dias.size} dias` };
};

const CRITERIOS = [
  { id: 'C1_optout', eliminatorio: true, descricao: 'casa com opt-out de listagem não pode estar publicada', avaliar: (p) => ({ ok: !(p.opt_out_ativo === true && p.published === true), detalhe: p.opt_out_ativo ? 'opt-out ativo' : '' }) },
  { id: 'C2_remocao', eliminatorio: true, descricao: 'pedido de remoção do próprio estabelecimento prevalece', avaliar: (p) => ({ ok: !(p.pedido_remocao_do_estabelecimento === true && p.published === true), detalhe: p.pedido_remocao_do_estabelecimento ? 'há pedido de remoção' : '' }) },
  { id: 'C3_flag_foto', eliminatorio: true, descricao: 'despublicada não pode manter ready_pending_photo (republish_no_photo.js republicaria sozinho)', avaliar: (p) => ({ ok: !(p.published === false && p.ready_pending_photo === true), detalhe: 'ready_pending_photo=true com published=false' }) },
  { id: 'C4_nome', descricao: 'nome presente', avaliar: (p) => ({ ok: typeof p.nome === 'string' && p.nome.trim().length >= 3, detalhe: `nome=${JSON.stringify(p.nome)}` }) },
  { id: 'C5_slug', descricao: 'slug kebab-case', avaliar: (p) => ({ ok: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(p.slug || '')), detalhe: `slug=${JSON.stringify(p.slug)}` }) },
  { id: 'C6_telefone', descricao: 'telefone internacional: "+" declara o país, 8–15 dígitos', avaliar: (p) => ({ ok: /^\+[1-9]\d{7,14}$/.test(String(p.phone || '').replace(/[\s().-]/g, '')), detalhe: `phone=${JSON.stringify(p.phone)}` }) },
  { id: 'C7_email', descricao: 'e-mail válido e domínio não está na lista de mortos', avaliar: (p, ctx) => { const e = String(p.email || '').trim().toLowerCase(); const ok = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e); const dom = e.split('@')[1]; const morto = ok && (ctx.dominios_mortos || []).map((d) => d.toLowerCase()).includes(dom); return { ok: ok && !morto, detalhe: !ok ? `email=${JSON.stringify(p.email)}` : morto ? `domínio morto: ${dom}` : '' }; } },
  { id: 'C8_horarios', descricao: 'horários não genéricos', avaliar: (p) => { const r = horariosGenericos(p.opening_hours); return { ok: !r.generico, detalhe: r.detalhe }; } },
  { id: 'C9_cidade', descricao: 'cidade e país presentes; cidade canônica quando há lista', avaliar: (p, ctx) => { const ok = !!(p.city && p.country); const can = ctx.cidades_canonicas; const okCan = !can || can.includes(p.city); return { ok: ok && okCan, detalhe: !ok ? 'cidade/país ausente' : !okCan ? `cidade "${p.city}" fora da lista canônica` : '' }; } },
  { id: 'C10_coords', descricao: 'coordenadas plausíveis', avaliar: (p) => ({ ok: typeof p.lat === 'number' && typeof p.lng === 'number' && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && !(p.lat === 0 && p.lng === 0), detalhe: `lat=${p.lat} lng=${p.lng}` }) },
];

const julgarCatalogo = (peca, contexto = {}) => ({ juiz: 'catalogo', ...julgar(CRITERIOS, peca, contexto), lacunas: ['foto real da casa e exatidão do endereço exigem olho humano ou Places — fora deste juiz'] });

module.exports = { julgarCatalogo, CRITERIOS, horariosGenericos };
