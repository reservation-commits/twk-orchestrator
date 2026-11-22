/* Wanted Chauffeur · agenda vinda da Central (GET /api/chauffeur/disponibilidade).
   A API diz, por dia, se está fechado e quais faixas estão ocupadas (minutos desde a meia-noite, hora de Paris).
   Se a API não responder, a página continua funcionando sem pintar a agenda: o servidor confere de novo ao gravar. */
import { CONFIG } from './config.js';
import { somarDias, DIA_MIN } from './datas.js';

const estado = { dias: new Map(), meta: null, ok: false };

/** Carrega `dias` dias a partir de `de` e junta ao que já se sabe. Devolve true se a API respondeu. */
export async function carregar(de, dias) {
  try {
    const r = await fetch(`${CONFIG.api}/api/chauffeur/disponibilidade?de=${encodeURIComponent(de)}&dias=${dias}`, { cache: 'no-store', headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    for (const d of j.dias || []) estado.dias.set(d.data, d);
    estado.meta = j; estado.ok = true;
    return true;
  } catch (e) {
    estado.ok = false;
    return false;
  }
}
export function esquecer() { estado.dias.clear(); }

export const conhecida = () => estado.ok;
export const meta = () => estado.meta;
export const dia = (data) => estado.dias.get(data) || null;

/** Minutos que a mission ocupa, pela tabela que a API manda (MAD = horas × 60). */
export function duracao(produto, horas) {
  if (produto === 'mad') return Math.max(2, Number(horas) || 2) * 60;
  return (estado.meta && estado.meta.duracoes_min && estado.meta.duracoes_min[produto]) || 60;
}

/** true livre · false ocupado · null não se sabe (API fora, ou dia ainda não carregado). */
export function livre(data, min, dur) {
  const d0 = dia(data); if (!d0) return null;
  if (d0.fechado) return false;
  const choca = (lista, a, b) => (lista || []).some(([x, y]) => a < y && b > x);
  if (choca(d0.ocupado, min, Math.min(min + dur, DIA_MIN))) return false;
  if (min + dur > DIA_MIN) { const d1 = dia(somarDias(data, 1)); if (d1 && choca(d1.ocupado, 0, min + dur - DIA_MIN)) return false; }
  return true;
}
