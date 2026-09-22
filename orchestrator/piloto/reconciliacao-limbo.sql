-- Piloto: reconciliacao dos restaurantes despublicados em 2026-07-02 (lote unpublish_no_photo, 985 ids)
-- SOMENTE LEITURA. Executar com credencial read-only (clavis_ro) no twk_auth.
-- Fonte dos ids: unpublish_no_photo_manifest.json (NAO rodar o script legado em dry-run: sobrescreve o manifesto).

-- 1) Universo atual do limbo: despublicados pelo lote que continuam despublicados
--    (marcados no enrichment_log com action = 'unpublished_no_photo')
SELECT count(*) AS ainda_despublicados
FROM public.db_restaurants r
WHERE r.published IS NOT TRUE
  AND r.enrichment_log::text LIKE '%unpublished_no_photo%';

-- 2) Quantos ja RECUPERARAM o criterio (tem foto de capa ou slider) e poderiam ser republicados
SELECT count(*) AS republicaveis
FROM public.db_restaurants r
WHERE r.published IS NOT TRUE
  AND r.enrichment_log::text LIKE '%unpublished_no_photo%'
  AND (
        COALESCE(r.images_json::jsonb -> 'slider' ->> 0, '') <> ''
     OR COALESCE(r.images_json::jsonb ->> 'cover', '') <> ''
  );

-- 3) Lista dos republicaveis com sinal de demanda (pedidos de reserva nos ultimos 90 dias)
--    — prioridade maxima do lote de republicacao
SELECT r.restaurant_id, r.name, r.city,
       count(res.reservation_id) AS pedidos_90d
FROM public.db_restaurants r
LEFT JOIN public.reservations res
       ON res.restaurant_id = r.restaurant_id
      AND res.created_date >= now() - interval '90 days'
WHERE r.published IS NOT TRUE
  AND r.enrichment_log::text LIKE '%unpublished_no_photo%'
  AND (
        COALESCE(r.images_json::jsonb -> 'slider' ->> 0, '') <> ''
     OR COALESCE(r.images_json::jsonb ->> 'cover', '') <> ''
  )
GROUP BY r.restaurant_id, r.name, r.city
ORDER BY pedidos_90d DESC, r.city
LIMIT 200;

-- 4) Sanidade: variacao de publicados (baseline do alerta ">2%/dia" do briefing)
SELECT count(*) FILTER (WHERE published IS TRUE)  AS publicados,
       count(*) FILTER (WHERE published IS NOT TRUE) AS despublicados,
       count(*) AS total
FROM public.db_restaurants;

-- Observacoes:
-- * Se a coluna de data de reservations nao for created_date, ajustar para booking_date
--   (a auditoria mapeou ambas; created_date mede DEMANDA no periodo, booking_date mede data da mesa).
-- * O UPDATE de republicacao NAO esta neste arquivo de proposito: ele nasce como proposta
--   do fluxo /delegar, segue docs/runbooks/publicacao-em-massa.md (manifesto com timestamp,
--   aprovacao humana, notificacao a Comercial/Editorial) e e executado pela superficie do DBA.
