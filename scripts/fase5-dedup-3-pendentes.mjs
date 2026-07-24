// FASE 5 — Resolve the 3 remaining dedup groups with case-by-case logic.
//
// Grupo 1 (Bangkok):  keep=35087 (EAT SIGHT STORY DECK), neutralize 35376 (BITTER DECK)
// Grupo 2 (Medellín): keep=30570 (EL CIELO CLASSIC, name correct), neutralize 30463 (EI CIELO, typo)
// Grupo 3 (Marrakech): keep=83502 (JAD MAHAL) — but FIRST overwrite its dirty address
//                      with the clean one from loser 4034. Then neutralize 4034.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';
const now = new Date().toISOString();

async function neutralize(client, loserId, keepId, placeId) {
  const cur = await client.query(
    `SELECT name, place_id, published, operational_status, operational_status_reason
       FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`, [loserId]);
  if (!cur.rows.length) throw new Error('loser not found');
  const old = cur.rows[0];

  const logEntry = {
    field: 'meta', action: 'dedup_neutralize', merged_into: keepId,
    place_id: old.place_id, old_published: old.published, old_operational_status: old.operational_status,
    verified_at: now, source: 'fase5-dedup-3-pendentes',
    confidence: 'HIGH', agent: AGENT, batch: 'fase5-dedup-3-pendentes',
    reason: `Duplicata por place_id — mesclada em ${keepId}`,
  };
  await client.query(`
    UPDATE public.db_restaurants
       SET published = false,
           operational_status = 'unknown',
           operational_status_reason = $2,
           place_id = NULL,
           last_verified_at = $3::timestamptz,
           verification_source = COALESCE(verification_source, 'fase5-dedup-3-pendentes'),
           confidence_level = 'HIGH',
           enrichment_log = enrichment_log || $4::jsonb
     WHERE restaurant_id = $1`,
    [loserId,
     `Duplicata mesclada com restaurant_id=${keepId} em ${now.slice(0,10)}`,
     now,
     JSON.stringify([logEntry])]);

  for (const f of ['published','operational_status','operational_status_reason','place_id']) {
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, $2, md5($3), 'fase5-dedup-3-pendentes', 'other', $4::timestamptz, 'HIGH', $5, $6)`,
      [loserId, f, f === 'place_id' ? 'NULL' : (f === 'published' ? 'false' : f === 'operational_status' ? 'unknown' : `merged_into:${keepId}`),
       now, AGENT, `dedup — neutralizado em ${keepId}`]);
  }
}

async function markKeep(client, keepId, loserIds, placeId, extra = '') {
  const keepLog = {
    field: 'meta', action: 'dedup_keep', merged_from: loserIds, place_id: placeId,
    verified_at: now, source: 'fase5-dedup-3-pendentes', confidence: 'HIGH', agent: AGENT,
    batch: 'fase5-dedup-3-pendentes', extra,
  };
  await client.query(
    `UPDATE public.db_restaurants
        SET last_verified_at = $2::timestamptz,
            verification_source = COALESCE(verification_source, 'fase5-dedup-3-pendentes'),
            confidence_level = COALESCE(confidence_level, 'HIGH'),
            enrichment_log = enrichment_log || $3::jsonb
      WHERE restaurant_id = $1`,
    [keepId, now, JSON.stringify([keepLog])]
  );
}

// =====================================================================
// GRUPO 1 — Bangkok: 35087 (EAT SIGHT STORY DECK) keeps, 35376 (BITTER DECK) goes
// =====================================================================
async function group1() {
  const placeId = 'ChIJ961s0QWZ4jARvvtf8tT2ZzQ';
  const keepId = '35087', loserId = '35376';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await markKeep(client, keepId, [loserId], placeId, 'Bangkok: 2 conceitos no mesmo place_id; mantemos EAT SIGHT STORY DECK');
    await neutralize(client, loserId, keepId, placeId);
    await client.query('COMMIT');
    console.log(`✓ G1: keep=${keepId} (EAT SIGHT STORY DECK), neutralized ${loserId} (BITTER DECK)`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.log(`✗ G1: ${e.message}`);
    process.exitCode = 1;
  } finally { client.release(); }
}

// =====================================================================
// GRUPO 2 — Medellín: keep 30570 (EL CIELO CLASSIC, nome correto), neutralize 30463 (EI CIELO, typo)
// =====================================================================
async function group2() {
  const placeId = 'ChIJF8IIwLcoRI4RKCdeMuiochQ';
  const keepId = '30570', loserId = '30463';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Copy any field from loser that's missing in keep
    // (Both rows have similar scores so likely few)
    await markKeep(client, keepId, [loserId], placeId, 'Medellín: invertido vs proposta inicial — mantemos EL CIELO CLASSIC (nome correto), neutralizamos EI CIELO (typo)');
    await neutralize(client, loserId, keepId, placeId);
    await client.query('COMMIT');
    console.log(`✓ G2: keep=${keepId} (EL CIELO CLASSIC), neutralized ${loserId} (EI CIELO — typo)`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.log(`✗ G2: ${e.message}`);
    process.exitCode = 1;
  } finally { client.release(); }
}

// =====================================================================
// GRUPO 3 — Marrakech: keep 83502 (JAD MAHAL) but OVERWRITE its dirty address
// with clean one from 4034 (Palais Jad Mahal); then neutralize 4034.
// =====================================================================
async function group3() {
  const placeId = 'ChIJiaw21ljurw0RX4We9hBkcrI';
  const keepId = '83502', loserId = '4034';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const loser = await client.query(
      `SELECT address_of_establishment FROM public.db_restaurants WHERE restaurant_id=$1`,
      [loserId]);
    const keep = await client.query(
      `SELECT address_of_establishment FROM public.db_restaurants WHERE restaurant_id=$1 FOR UPDATE`,
      [keepId]);
    const dirtyAddress = keep.rows[0].address_of_establishment;
    const cleanAddress = loser.rows[0].address_of_establishment;

    // Overwrite dirty address with clean one
    const fixLog = {
      field: 'address_of_establishment',
      old_value: dirtyAddress,
      new_value: cleanAddress,
      reason: `Endereço anterior tinha lixo concatenado (nome+telefone+URL). Substituído pelo endereço limpo do duplicate ${loserId}.`,
      source: `fase5-dedup-3-pendentes:overwrite_from_${loserId}`,
      verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'fase5-dedup-3-pendentes',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET address_of_establishment = $2,
             enrichment_log = enrichment_log || $3::jsonb
       WHERE restaurant_id = $1`,
      [keepId, cleanAddress, JSON.stringify([fixLog])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'address_of_establishment', md5($2::text), $3, 'other', $4::timestamptz, 'HIGH', $5, $6)`,
      [keepId, cleanAddress, `fase5-dedup-3-pendentes:overwrite_from_${loserId}`, now, AGENT,
       'dedup G3 — limpeza de endereço poluído']);

    await markKeep(client, keepId, [loserId], placeId, 'Marrakech: endereço limpo copiado do duplicate antes de neutralizar');
    await neutralize(client, loserId, keepId, placeId);

    await client.query('COMMIT');
    console.log(`✓ G3: keep=${keepId} (JAD MAHAL, endereço limpo), neutralized ${loserId} (Palais Jad Mahal)`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.log(`✗ G3: ${e.message}`);
    process.exitCode = 1;
  } finally { client.release(); }
}

await group1();
await group2();
await group3();

// Final check
const remaining = await pool.query(`
  SELECT COUNT(*)::int AS n FROM (
    SELECT place_id FROM public.db_restaurants
    WHERE place_id IS NOT NULL GROUP BY place_id HAVING COUNT(*)>1
  ) x`);
console.log(`\nGrupos duplicados restantes: ${remaining.rows[0].n}`);

// Try to add UNIQUE index now (idempotent — only creates if no dups)
try {
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS db_restaurants_place_id_uniq
    ON public.db_restaurants (place_id) WHERE place_id IS NOT NULL`);
  console.log('✓ UNIQUE INDEX em place_id criado com sucesso!');
} catch (e) {
  console.log(`✗ UNIQUE INDEX falhou: ${e.message}`);
}

await pool.end();
