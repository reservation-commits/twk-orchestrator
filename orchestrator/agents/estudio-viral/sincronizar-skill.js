'use strict';
/**
 * Copia para ./skill/ a parte da skill Wanted Chauffeur Studio que o Estúdio Viral usa (ferramenta de medida, travas,
 * fórmulas, voz e modos). Motivo: o Dockerfile da Central só enxerga orchestrator/, e a skill mora em .claude/skills/.
 * Uma única fonte de verdade (a skill); esta cópia é derivada e conferida pelo teste (`--verificar` sai 1 se divergir).
 *
 *   node sincronizar-skill.js              copia
 *   node sincronizar-skill.js --verificar  só confere (falha alto se a cópia estiver velha)
 */
const fs = require('node:fs');
const path = require('node:path');

const ORIGEM = path.resolve(__dirname, '..', '..', '..', '.claude', 'skills', 'wanted-chauffeur-studio');
const DESTINO = path.join(__dirname, 'skill');
const ARQUIVOS = ['outils/wc.js', 'donnees/formules.json', 'donnees/garde-fous.json', 'donnees/lexique.json', 'donnees/plateformes.json', 'voix.md', 'modes/reel.md', 'modes/legende.md'];

function sincronizar({ verificar = false } = {}) {
  if (!fs.existsSync(ORIGEM)) return { ok: null, motivo: `skill ausente em ${ORIGEM} (ambiente hospedado: a cópia é a fonte)`, divergentes: [] };
  const divergentes = [];
  for (const rel of ARQUIVOS) {
    const de = path.join(ORIGEM, rel); const para = path.join(DESTINO, rel);
    const conteudo = fs.readFileSync(de, 'utf8');
    const atual = fs.existsSync(para) ? fs.readFileSync(para, 'utf8') : null;
    if (atual !== conteudo) { divergentes.push(rel); if (!verificar) { fs.mkdirSync(path.dirname(para), { recursive: true }); fs.writeFileSync(para, conteudo, 'utf8'); } }
  }
  return { ok: verificar ? divergentes.length === 0 : true, divergentes };
}

module.exports = { sincronizar, ORIGEM, DESTINO, ARQUIVOS };
if (require.main === module) {
  const verificar = process.argv.includes('--verificar');
  const r = sincronizar({ verificar });
  if (r.ok === null) { console.log(r.motivo); process.exit(0); }
  if (verificar) { console.log(r.ok ? 'Cópia da skill em dia.' : `Cópia da skill VELHA: ${r.divergentes.join(', ')} — rode sem --verificar.`); process.exit(r.ok ? 0 : 1); }
  console.log(r.divergentes.length ? `Copiados: ${r.divergentes.join(', ')}` : 'Nada a copiar: cópia em dia.');
}
