/*
 * Unpublish PUBLISHED restaurants that have NO photo (no cover and no slider[0]).
 * Fully reversible: writes a manifest of the exact affected ids BEFORE any change, tags each row
 * in enrichment_log, and only touches that exact set. Default = DRY RUN; pass --apply to write.
 * Rollback: `node republish_no_photo.js` (restores the manifest set, optionally only those that
 * meanwhile got a photo).
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const { CONN, SSL } = require('./db-config');
const { auditedUpdate } = require('./db-audited');
const pool = new Pool({ connectionString: CONN, ssl: SSL });
const APPLY = process.argv.includes('--apply');
const noHero = `(COALESCE(images_json->'slider'->0->>'source_url','')='' AND COALESCE(images_json->'cover'->>'source_url','')='')`;
const MANIFEST = path.join(__dirname, 'unpublish_no_photo_manifest.json');

(async () => {
  const rows = (await pool.query(
    `SELECT restaurant_id, name, city, country FROM db_restaurants WHERE published AND ${noHero} ORDER BY name`
  )).rows;
  console.log(`Publicados SEM foto a despublicar: ${rows.length}`);
  console.log('Modo:', APPLY ? 'APPLY (grava)' : 'DRY RUN (sem escrita)');

  // Always write the manifest first (rollback safety).
  fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(), count: rows.length, ids: rows.map(r => r.restaurant_id), rows }, null, 1));
  console.log('Manifesto salvo em:', MANIFEST);
  console.log('Amostra:', rows.slice(0, 5).map(r => `${r.name} (${r.city})`).join(' · '));

  if (!APPLY) { console.log('\nDRY RUN — rode com --apply para despublicar.'); await pool.end(); return; }

  const ids = rows.map(r => r.restaurant_id);
  const log = JSON.stringify([{ field: 'published', action: 'unpublished_no_photo', reason: 'sem foto — despublicado temporariamente ate adicionar fotos', at: new Date().toISOString() }]);
  // Escrita AUDITADA (auditoria 2026-09-21): a execução anterior marcou 985 casas em
  // enrichment_log e deixou ZERO linhas em agent_audit_log. Agora old_data por registro e
  // trilha na mesma transação (db-audited.js). O JSON do log vai em dollar-quoting para não
  // depender de escape de aspas dentro do SET.
  if (log.includes('$$')) throw new Error('log contém "$$" — ajuste o dollar-quoting');
  const res = await auditedUpdate(pool, {
    table: 'db_restaurants',
    pk: 'restaurant_id',
    where: `restaurant_id = ANY($1) AND published AND ${noHero}`,
    params: [ids],
    set: `published = false, enrichment_log = COALESCE(enrichment_log,'[]'::jsonb) || $$${log}$$::jsonb`,
    agent: 'unpublish_no_photo',
    reason: 'despublicacao temporaria: sem foto (manifesto gravado antes da escrita)',
    maxRows: 1500,
  });
  console.log(`\nDespublicados: ${res.rowCount} (auditados um a um em agent_audit_log)`);

  const stillPubNoPhoto = (await pool.query(`SELECT COUNT(*) c FROM db_restaurants WHERE published AND ${noHero}`)).rows[0].c;
  const totalPub = (await pool.query(`SELECT COUNT(*) c FROM db_restaurants WHERE published`)).rows[0].c;
  console.log(`Publicados restantes: ${totalPub} | ainda publicados sem foto: ${stillPubNoPhoto}`);
  await pool.end();
})().catch(e => { console.error('ERRO:', e.message); pool.end(); process.exit(1); });
