/* Wanted Chauffeur · datas e horas. Tudo em hora de Paris, horas em AM/PM, datas por extenso em francês. */
export const DIA_MIN = 1440;
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Hoje em Paris, AAAA-MM-DD (independe do fuso do celular do cliente). */
export function hojeParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function somarDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const utc = (iso) => new Date(iso + 'T12:00:00Z');

/** "mardi 24 novembre" — para a mensagem do WhatsApp. */
export function dataLonga(iso) { if (!iso) return 'la date à préciser'; const d = utc(iso); return `${JOURS[d.getUTCDay()]} ${d.getUTCDate()} ${MOIS[d.getUTCMonth()]}`; }
/** Partes curtas para a faixa de dias: { semana: 'mar.', dia: '24', mes: 'nov.' }. */
export function rotuloDia(iso) { const d = utc(iso); return { semana: JOURS[d.getUTCDay()].slice(0, 3) + '.', dia: String(d.getUTCDate()), mes: MOIS_COURT[d.getUTCMonth()] }; }

/** "9:00 PM" → 1260. */
export function horaParaMin(h) {
  const m = /^(1[0-2]|[1-9]):([0-5]\d) (AM|PM)$/.exec(h || ''); if (!m) return null;
  let hh = Number(m[1]) % 12; if (m[3] === 'PM') hh += 12; return hh * 60 + Number(m[2]);
}
/** 1260 → "9:00 PM". */
export function minParaHora(min) { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }
/** Todos os horários do dia, de `passo` em `passo` minutos. */
export function horarios(passo = 5) { const out = []; for (let m = 0; m < DIA_MIN; m += passo) out.push(minParaHora(m)); return out; }
