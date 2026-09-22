/**
 * MAESTRO Seed — durabilidade do estado (v4.4).
 * Copia SEED_DIR → STATE_DIR apenas o que estiver FALTANDO. Dado vivo (conversas,
 * aprovações, anexos) jamais é sobrescrito. Arquivos de REFERÊNCIA versionados com o
 * código (frota.md) são sempre atualizados. Assim: volume vazio é semeado direito;
 * volume com dados é preservado no redeploy.
 */
const fs = require('node:fs');
const path = require('node:path');

const SEMPRE_ATUALIZA = new Set(['frota.md']); // referência acompanha a versão do código

function seedState(stateDir, seedDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  for (const d of ['missoes', 'logs', 'threads', 'anexos']) fs.mkdirSync(path.join(stateDir, d), { recursive: true });
  if (!seedDir || !fs.existsSync(seedDir)) return { seed: false, novos: 0, atualizados: 0, preservados: 0 };
  let novos = 0, atualizados = 0, preservados = 0;
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(seedDir, rel), { withFileTypes: true })) {
      const childRel = rel ? path.join(rel, ent.name) : ent.name;
      if (ent.isDirectory()) { fs.mkdirSync(path.join(stateDir, childRel), { recursive: true }); walk(childRel); continue; }
      const alvo = path.join(stateDir, childRel);
      if (!fs.existsSync(alvo)) { fs.copyFileSync(path.join(seedDir, childRel), alvo); novos++; }
      else if (SEMPRE_ATUALIZA.has(ent.name)) { fs.copyFileSync(path.join(seedDir, childRel), alvo); atualizados++; }
      else preservados++;
    }
  };
  walk('');
  return { seed: true, novos, atualizados, preservados };
}

module.exports = { seedState };
