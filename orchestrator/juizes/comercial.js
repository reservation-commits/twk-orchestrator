'use strict';
/**
 * Juiz Comercial — julga UMA mensagem a estabelecimento (CLAVIS, Guardião, Porteiro) antes do envio.
 * Alimenta `juiz_comercial_nota` (PROP-102 envio a casa com opt-in).
 *
 * peca = { texto, canal: 'email'|'whatsapp', idioma_casa, nome_casa,
 *          opt_out_consultado, opt_out_ativo, opt_in_registrado, template_aprovado, tem_rodape_optout,
 *          links?: string[], envios_7d?: number }
 */
const { julgar, detectarIdioma, temAlgum, VOCAB_INTERNO, PROMESSA_PRAZO, MARCA_ERRADA } = require('./juiz');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const CRITERIOS = [
  { id: 'M1_optout', eliminatorio: true, descricao: 'registro de opt-out consultado e sem opt-out ativo (registro ilegível = nenhum contato)', avaliar: (p) => ({ ok: p.opt_out_consultado === true && p.opt_out_ativo === false, detalhe: p.opt_out_consultado !== true ? 'opt-out não consultado' : 'opt-out ativo' }) },
  { id: 'M2_idioma', eliminatorio: true, descricao: 'texto no idioma da casa', avaliar: (p) => { const d = detectarIdioma(p.texto); return { ok: d !== 'desconhecido' && d === p.idioma_casa, detalhe: `detectado=${d} casa=${p.idioma_casa}` }; } },
  { id: 'M3_prazo', eliminatorio: true, descricao: 'não promete prazo de terceiro nem confirmação imediata (ADR-015)', avaliar: (p) => { const m = temAlgum(PROMESSA_PRAZO, p.texto); return { ok: !m, detalhe: m ? `casou ${m}` : '' }; } },
  { id: 'M4_marca', eliminatorio: true, descricao: 'marca correta (não "The World\'s Kitchen")', avaliar: (p) => { const m = temAlgum(MARCA_ERRADA, p.texto); return { ok: !m, detalhe: m ? `casou ${m}` : '' }; } },
  { id: 'M5_vocab', eliminatorio: true, descricao: 'sem vocabulário interno', avaliar: (p) => { const m = temAlgum(VOCAB_INTERNO, p.texto); return { ok: !m, detalhe: m ? `casou ${m}` : '' }; } },
  { id: 'M6_canal', descricao: 'e-mail com rodapé de opt-out; WhatsApp com template aprovado e opt-in registrado', avaliar: (p) => { if (p.canal === 'email') return { ok: p.tem_rodape_optout === true, detalhe: 'sem rodapé de opt-out' }; if (p.canal === 'whatsapp') return { ok: p.template_aprovado === true && p.opt_in_registrado === true, detalhe: `template_aprovado=${p.template_aprovado} opt_in=${p.opt_in_registrado}` }; return { ok: false, detalhe: `canal desconhecido ${p.canal}` }; } },
  { id: 'M7_links', descricao: 'todo link aponta para theworldkeys.com', avaliar: (p) => { const ruins = (p.links || []).filter((u) => { try { return !/(^|\.)theworldkeys\.com$/.test(new URL(u).hostname); } catch { return true; } }); return { ok: ruins.length === 0, detalhe: ruins.join(', ') }; } },
  { id: 'M8_frequencia', descricao: 'no máximo 2 envios à mesma casa em 7 dias', avaliar: (p) => ({ ok: typeof p.envios_7d === 'number' && p.envios_7d <= 2, detalhe: `envios_7d=${p.envios_7d}` }) },
  { id: 'M9_tamanho', descricao: 'WhatsApp ≤ 1024 caracteres; e-mail ≤ 4000', avaliar: (p) => { const n = String(p.texto || '').length; const max = p.canal === 'whatsapp' ? 1024 : 4000; return { ok: n > 0 && n <= max, detalhe: `${n}/${max}` }; } },
  { id: 'M10_destinatario', descricao: 'fala com a casa pelo nome', avaliar: (p) => ({ ok: !!p.nome_casa && norm(p.texto).includes(norm(p.nome_casa)), detalhe: `nome_casa=${JSON.stringify(p.nome_casa)}` }) },
];

const julgarComercial = (peca, contexto = {}) => ({ juiz: 'comercial', ...julgar(CRITERIOS, peca, contexto), lacunas: ['tom e adequação cultural exigem leitura humana ou modelo — fora deste juiz'] });

module.exports = { julgarComercial, CRITERIOS };
