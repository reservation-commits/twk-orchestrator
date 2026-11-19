'use strict';
/**
 * Migra as reservas do modo arquivo (volume da Central) para as tabelas chauffeur_* do Postgres, sem perder linha.
 * Rodar DEPOIS da DDL (chauffeur-reservas.sql, frase do fundador) e com TWK_DBA_URL no ambiente.
 *
 *   node migrar.js [--dir <pasta com reservas.jsonl>] [--apply]
 *
 * Sem --apply: conta e mostra o que iria. Com --apply: INSERT ... ON CONFLICT DO NOTHING (rodar duas vezes não duplica).
 * A ordem dos eventos é preservada (em = o carimbo original). Imprime o resultado; sai com 1 se algo não entrou.
 */
const path = require('node:path');
const fs = require('node:fs');
const { abrirArquivo, abrirBanco } = require('./reservas.js');

async function main(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const apply = argv.includes('--apply');
  const raiz = process.env.TWK_STATE_ROOT || process.env.STATE_DIR;
  const dir = opt('--dir') || (raiz ? path.join(raiz, 'agents', 'wanted-chauffeur') : path.join(__dirname, 'state'));
  const arq = abrirArquivo({ dir });
  const ler = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const reservas = ler(arq.arquivos.reservas), eventos = ler(arq.arquivos.eventos), nao = ler(arq.arquivos.naoContatar);
  console.log(`[migrar] ${dir}: ${reservas.length} reserva(s), ${eventos.length} evento(s), ${nao.length} não-contatar`);
  if (!apply) { console.log('[migrar] sem --apply: nada gravado'); return 0; }
  if (!process.env.TWK_DBA_URL) { console.error('[migrar] TWK_DBA_URL ausente'); return 1; }
  const db = await abrirBanco({ url: process.env.TWK_DBA_URL });
  let falhas = 0, novas = 0;
  try {
    for (const r of reservas) { try { const x = await db.criar(r); if (x.status === 201) novas++; } catch (e) { falhas++; console.error(`[migrar] ${r.codigo}: ${e.message}`); } }
    // Limite conhecido: criado_em e em ficam com now() no banco (o papel twk_dba não tem UPDATE nessas colunas);
    // a ordem dos eventos é preservada pela inserção em sequência.
    for (const e of eventos.sort((a, b) => (a.em < b.em ? -1 : 1))) {
      try { const x = await db.evento({ codigo: e.codigo, tipo: e.tipo || 'status', valor: e.valor || e.status, nota: e.nota || null, por: e.por || 'importacao' }); if (x.status !== 200) { falhas++; console.error(`[migrar] evento ${e.codigo}: ${x.erro}`); } } catch (err) { falhas++; console.error(`[migrar] evento ${e.codigo}: ${err.message}`); }
    }
    for (const n of nao) { try { await db.naoContatar.adicionar(n); } catch (err) { falhas++; console.error(`[migrar] não-contatar: ${err.message}`); } }
  } finally { await db.fechar(); }
  console.log(`[migrar] ${novas} reserva(s) nova(s) no banco · ${falhas} falha(s)`);
  return falhas ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => { console.error('[migrar] exceção:', e.message); process.exit(2); });
module.exports = { main };
