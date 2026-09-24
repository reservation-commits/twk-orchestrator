// Fix the one failed group: VICTORIA (95341 keep, 292661 loser).
// negotiation_status is an ENUM type, needs explicit cast.
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

const keepId = '95341';
const loserId = '292661';
const placeId = 'ChIJ6-EpTOxv5kcRB_7hi3YYXTs';

const client = await pool.connect();
try {
  await client.query('BEGIN');

  // Copy negotiation_status with explicit enum cast
  await client.query(
    `UPDATE public.db_restaurants
        SET negotiation_status = $2::public.negotiation_status_enum
      WHERE restaurant_id = $1 AND negotiation_status IS NULL`,
    [keepId, 'Pending']
  );

  const copyLog = {
    field: 'negotiation_status', old_value: null, new_value: 'Pending',
    source: `fase5-dedup:merge_from_${loserId}`, verified_at: now, confidence: 'HIGH',
    agent: AGENT, batch: 'fase5-dedup',
    reason: `Mesclado do duplicate restaurant_id=${loserId} (place_id=${placeId})`,
  };
  await client.query(
    `UPDATE public.db_restaurants
        SET enrichment_log = enrichment_log || $2::jsonb
      WHERE restaurant_id = $1`,
    [keepId, JSON.stringify([copyLog])]
  );
  await client.query(`
    INSERT INTO public.restaurant_field_verifications
      (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
    VALUES ($1, 'negotiation_status', md5('Pending'), $2, 'other', $3::timestamptz, 'HIGH', $4, $5)`,
    [keepId, `fase5-dedup:merge_from_${loserId}`, now, AGENT, `fase5-dedup — mesclado de ${loserId}`]);

  // Keep governance stamp
  const keepLog = {
    field: 'meta', action: 'dedup_keep', merged_from: [loserId],
    place_id: placeId, verified_at: now,
    source: 'fase5-dedup', confidence: 'HIGH', agent: AGENT, batch: 'fase5-dedup',
  };
  await client.query(
    `UPDATE public.db_restaurants
        SET last_verified_at = $2::timestamptz,
            verification_source = COALESCE(verification_source, 'fase5-dedup'),
            confidence_level = COALESCE(confidence_level, 'HIGH'),
            enrichment_log = enrichment_log || $3::jsonb
      WHERE restaurant_id = $1`,
    [keepId, now, JSON.stringify([keepLog])]
  );

  // Neutralize loser
  const cur = await client.query(
    `SELECT name, place_id, published, operational_status FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`,
    [loserId]);
  const old = cur.rows[0];

  const loserLog = {
    field: 'meta', action: 'dedup_neutralize', merged_into: keepId,
    place_id: old.place_id, old_published: old.published, old_operational_status: old.operational_status,
    verified_at: now, source: 'fase5-dedup', confidence: 'HIGH', agent: AGENT, batch: 'fase5-dedup',
    reason: `Duplicata por place_id — mesclada em ${keepId}`,
  };
  await client.query(`
    UPDATE public.db_restaurants
       SET published = false,
           operational_status = 'unknown',
           operational_status_reason = $2,
           place_id = NULL,
           last_verified_at = $3::timestamptz,
           verification_source = COALESCE(verification_source, 'fase5-dedup'),
           confidence_level = 'HIGH',
           enrichment_log = enrichment_log || $4::jsonb
     WHERE restaurant_id = $1`,
    [loserId,
     `Duplicata mesclada com restaurant_id=${keepId} em ${now.slice(0,10)}`,
     now,
     JSON.stringify([loserLog])]);

  for (const f of ['published','operational_status','operational_status_reason','place_id']) {
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, $2, md5($3), 'fase5-dedup', 'other', $4::timestamptz, 'HIGH', $5, $6)`,
      [loserId, f, f === 'place_id' ? 'NULL' : (f === 'published' ? 'false' : f === 'operational_status' ? 'unknown' : `merged_into:${keepId}`),
       now, AGENT, `fase5-dedup — neutralizado em ${keepId}`]);
  }

  await client.query('COMMIT');
  console.log(`✓ VICTORIA group fixed: keep=${keepId} | loser=${loserId} (neutralized)`);
} catch (e) {
  await client.query('ROLLBACK');
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
