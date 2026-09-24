// FASE 5 — Apply dedup proposal (RECOMENDADO).
// Executes 10 clean groups, skips 3 suspects (by place_id).
// For each group:
//   1. Copy missing fields from loser to keep
//   2. Neutralize loser (published=false, operational_status='unknown',
//      operational_status_reason, place_id=NULL, enrichment_log entry)
//   3. Audit trail in restaurant_field_verifications
// Each group in its own transaction.
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

// Place IDs to SKIP (3 suspects flagged for human review)
const SKIP_PLACE_IDS = new Set([
  'ChIJ961s0QWZ4jARvvtf8tT2ZzQ',   // Grupo 3 — EAT SIGHT STORY DECK / BITTER DECK
  'ChIJF8IIwLcoRI4RKCdeMuiochQ',   // Grupo 8 — EI CIELO / EL CIELO CLASSIC
  'ChIJiaw21ljurw0RX4We9hBkcrI',   // Grupo 11 — JAD MAHAL (endereço sujo)
]);

const proposals = JSON.parse(fs.readFileSync('audit-output/fase5-dedup-analysis.json', 'utf8'));
const toApply = proposals.filter(p => !SKIP_PLACE_IDS.has(p.place_id));
const skipped = proposals.filter(p => SKIP_PLACE_IDS.has(p.place_id));

console.log(`Total grupos:           ${proposals.length}`);
console.log(`A aplicar:              ${toApply.length}`);
console.log(`Pulados (revisão hum.): ${skipped.length}`);
console.log();

// Field type map — knowing this helps us cast values back into UPDATE
const TYPED_FIELDS = {
  // dates
  partnership_start_date: 'date',
  last_verified_at: 'timestamptz',
  // numbers
  michelin_id: 'integer',
  price_range_id: 'integer',
  // jsonb
  business_hours_json: 'jsonb',
  images_json: 'jsonb',
  // boolean
  published: 'boolean',
  partner: 'boolean',
  // everything else: text
};

let groupsOk = 0, groupsErr = 0, fieldsCopied = 0;
const errs = [];

for (const p of toApply) {
  const keepId = p.keep.id;
  const loserIds = p.losers.map(l => l.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Copy missing fields TO keep
    let groupCopied = 0;
    for (const f of (p.fields_to_copy || [])) {
      const type = TYPED_FIELDS[f.field] || 'text';
      let castSql, paramVal;
      if (type === 'jsonb') { castSql = '$2::jsonb'; paramVal = JSON.stringify(f.value); }
      else { castSql = `$2::${type}`; paramVal = f.value; }
      await client.query(
        `UPDATE public.db_restaurants
            SET ${f.field} = ${castSql}
          WHERE restaurant_id = $1 AND ${f.field} IS NULL`,
        [keepId, paramVal]
      );
      const logEntry = {
        field: f.field,
        old_value: null,
        new_value: f.value,
        source: `fase5-dedup:merge_from_${f.from}`,
        verified_at: now,
        confidence: 'HIGH',
        agent: AGENT,
        batch: 'fase5-dedup',
        reason: `Mesclado do duplicate restaurant_id=${f.from} (place_id=${p.place_id})`,
      };
      await client.query(
        `UPDATE public.db_restaurants
            SET enrichment_log = enrichment_log || $2::jsonb
          WHERE restaurant_id = $1`,
        [keepId, JSON.stringify([logEntry])]
      );
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3::text), $4, 'other', $5::timestamptz, 'HIGH', $6, $7)`,
        [keepId, f.field, String(f.value), `fase5-dedup:merge_from_${f.from}`, now, AGENT,
         `fase5-dedup — mesclado de ${f.from}`]);
      groupCopied++;
      fieldsCopied++;
    }

    // 2. Update keep's governance stamps (mark it was deduped)
    const keepLog = {
      field: 'meta',
      action: 'dedup_keep',
      merged_from: loserIds,
      place_id: p.place_id,
      verified_at: now,
      source: 'fase5-dedup',
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'fase5-dedup',
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

    // 3. Neutralize each loser
    for (const loserId of loserIds) {
      const cur = await client.query(
        `SELECT name, place_id, published, operational_status, operational_status_reason
         FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`, [loserId]);
      if (!cur.rows.length) continue;
      const old = cur.rows[0];

      const loserLog = {
        field: 'meta',
        action: 'dedup_neutralize',
        merged_into: keepId,
        place_id: old.place_id,
        old_published: old.published,
        old_operational_status: old.operational_status,
        verified_at: now,
        source: 'fase5-dedup',
        confidence: 'HIGH',
        agent: AGENT,
        batch: 'fase5-dedup',
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

      // Audit per field changed on loser
      for (const f of ['published','operational_status','operational_status_reason','place_id']) {
        await client.query(`
          INSERT INTO public.restaurant_field_verifications
            (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
          VALUES ($1, $2, md5($3), 'fase5-dedup', 'other', $4::timestamptz, 'HIGH', $5, $6)`,
          [loserId, f, f === 'place_id' ? 'NULL' : (f === 'published' ? 'false' : f === 'operational_status' ? 'unknown' : `merged_into:${keepId}`),
           now, AGENT, `fase5-dedup — neutralizado em ${keepId}`]);
      }
    }

    await client.query('COMMIT');
    groupsOk++;
    console.log(`✓ Grupo aplicado: keep=${keepId} (${p.keep.name}) | losers=${loserIds.join(',')} | campos copiados=${groupCopied}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    groupsErr++;
    errs.push({ keep: keepId, losers: loserIds, err: e.message });
    console.log(`✗ Falhou keep=${keepId}: ${e.message}`);
  } finally {
    client.release();
  }
}

console.log(`\n========= Resultado =========`);
console.log(`Grupos aplicados:   ${groupsOk}/${toApply.length}`);
console.log(`Campos copiados:    ${fieldsCopied}`);
console.log(`Grupos com erro:    ${groupsErr}`);
console.log(`Grupos pulados:     ${skipped.length} (revisão humana)`);
skipped.forEach(s => console.log(`   • ${s.place_id} — ${s.keep.name} vs ${s.losers.map(l=>l.name).join(',')}`));

fs.writeFileSync('audit-output/fase5-dedup-apply-results.json', JSON.stringify({
  generated_at: now,
  total_groups: proposals.length,
  applied: groupsOk,
  errors: groupsErr,
  fields_copied: fieldsCopied,
  skipped_place_ids: [...SKIP_PLACE_IDS],
  err_sample: errs,
}, null, 2));

await pool.end();
process.exitCode = groupsErr > 0 ? 1 : 0;
