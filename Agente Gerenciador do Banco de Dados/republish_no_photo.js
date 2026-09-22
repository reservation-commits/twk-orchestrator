/*
 * Republish restaurants that were unpublished ONLY for lacking photos (flag ready_pending_photo).
 *   node republish_no_photo.js                        → DRY RUN
 *   node republish_no_photo.js --apply --only-with-photo   → republish the ones that NOW have a photo (recommended, run periodically)
 *   node republish_no_photo.js --apply                → republish ALL flagged (emergency rollback of the unpublish)
 * On republish the flag is cleared (they're no longer "pending photo").
 */
const { Pool } = require('./twk-db-agent/node_modules/pg');
const { CONN, SSL } = require('./db-config');
const { auditedUpdate } = require('./db-audited');
const pool = new Pool({ connectionString: CONN, ssl: SSL });
const APPLY = process.argv.includes('--apply');
const ONLY_WITH_PHOTO = process.argv.includes('--only-with-photo');
const hasHero = `(COALESCE(images_json->'slider'->0->>'source_url','')<>'' OR COALESCE(images_json->'cover'->>'source_url','')<>'')`;

(async () => {
  const where = ONLY_WITH_PHOTO
    ? `ready_pending_photo AND NOT published AND ${hasHero}`
    : `ready_pending_photo AND NOT published`;
  const preview = (await pool.query(`SELECT COUNT(*) c FROM db_restaurants WHERE ${where}`)).rows[0].c;
  const flagged = (await pool.query(`SELECT COUNT(*) c FROM db_restaurants WHERE ready_pending_photo AND NOT published`)).rows[0].c;
  console.log(`Marcados 'pronto' (não publicados): ${flagged}`);
  console.log(`${ONLY_WITH_PHOTO ? 'Com foto e ' : ''}a republicar: ${preview} | modo: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (!APPLY) { console.log('DRY RUN — rode com --apply para republicar.'); await pool.end(); return; }
  // Escrita AUDITADA: old_data por registro + agent_audit_log na mesma transação (db-audited.js).
  const res = await auditedUpdate(pool, {
    table: 'db_restaurants',
    pk: 'restaurant_id',
    where,
    set: 'published = true, ready_pending_photo = false',
    agent: 'republish_no_photo',
    reason: ONLY_WITH_PHOTO ? 'republicacao periodica: foto adicionada' : 'republicacao total (rollback de emergencia do unpublish)',
    maxRows: 1000,
  });
  console.log(`Republicados: ${res.rowCount} (marca 'pronto' limpa nesses; auditados um a um em agent_audit_log)`);
  await pool.end();
})().catch(e => { console.error('ERRO:', e.message); pool.end(); process.exit(1); });
