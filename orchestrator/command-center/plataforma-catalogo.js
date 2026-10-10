'use strict';
/**
 * PANORAMA — catálogo de consultas (uma por métrica). Tudo SOMENTE LEITURA, pela credencial twk_ro.
 *
 * Regras (constituição e glossário de dados):
 *   - só agregados; nenhuma consulta devolve nome, e-mail, telefone ou texto de cliente;
 *   - {{EX}} = lista das casas de teste, fora de toda contagem (fundador, 2026-09-06);
 *   - pedido de reserva conta UMA vez por (cliente, data, hora) — a mesma solicitação gravada duas
 *     vezes não vira dois pedidos; o status do pedido é o da gravação mais recente;
 *   - pendência viva = expired_at IS NULL; a coluna `people` não entra em soma nenhuma;
 *   - `reservations.created_date` é horário UTC sem fuso.
 * Cada consulta devolve colunas já com o nome que a tela usa (periodo/rotulo/valor, ou campos nomeados).
 */

/** Pedidos deduplicados. `desde` = intervalo SQL (ex.: "90 days") ou null para tudo. */
const PEDIDOS = (desde) => `
  SELECT r.customer_id, r.booking_date, r.reservation_time,
         min(r.created_date) AS criado,
         (array_agg(lower(btrim(r.booking_status)) ORDER BY r.created_date DESC))[1] AS st,
         bool_or(r.expired_at IS NULL) AS viva,
         (array_agg(r.restaurant_id ORDER BY r.created_date DESC))[1] AS restaurant_id
    FROM public.reservations r
   WHERE r.restaurant_id NOT IN ({{EX}}) ${desde ? `AND r.created_date >= now() - interval '${desde}'` : ''}
   GROUP BY 1, 2, 3`;

const FUNIL = (dias) => `
  WITH d AS (${PEDIDOS(`${dias} days`)})
  SELECT count(*)::int AS pedidos,
         count(*) FILTER (WHERE st = 'accept')::int AS aceitos,
         count(*) FILTER (WHERE st = 'decline')::int AS recusados,
         count(*) FILTER (WHERE st = 'declined (client)')::int AS cancelados,
         count(*) FILTER (WHERE st IN ('pending', 'in treatment') AND viva)::int AS aguardando,
         count(*) FILTER (WHERE st IN ('pending', 'in treatment') AND NOT viva)::int AS sem_resposta,
         CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE st = 'accept') / count(*), 1)::float END AS taxa_aceite,
         CASE WHEN count(*) FILTER (WHERE st IN ('accept', 'decline')) > 0
              THEN round(100.0 * count(*) FILTER (WHERE st IN ('accept', 'decline')) / count(*), 1)::float END AS taxa_resposta
    FROM d`;

const PCT = (cond) => `round(100.0 * count(*) FILTER (WHERE ${cond}) / NULLIF(count(*), 0), 1)::float`;

module.exports = [
  // ═══════════════════════ ECOSSISTEMA ═══════════════════════
  { id: 'eco_catalogo', sql: `
    SELECT count(*)::int AS total, count(*) FILTER (WHERE published)::int AS publicados,
           count(DISTINCT country) FILTER (WHERE published)::int AS paises,
           count(DISTINCT city) FILTER (WHERE published)::int AS cidades,
           count(*) FILTER (WHERE partner IS TRUE)::int AS parceiros,
           count(*) FILTER (WHERE published AND created_date >= now() - interval '30 days')::int AS novos_30d
      FROM public.db_restaurants WHERE restaurant_id NOT IN ({{EX}})` },
  { id: 'eco_clientes', sql: `
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE "createdAt" >= now() - interval '30 days')::int AS novos_30d,
           count(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')::int AS novos_7d
      FROM nextauth."User" WHERE "deactivatedAt" IS NULL` },
  { id: 'eco_clientes_mes', sql: `
    SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS periodo, count(*)::int AS valor
      FROM nextauth."User" WHERE "createdAt" >= date_trunc('month', now()) - interval '17 months'
     GROUP BY 1 ORDER BY 1` },
  { id: 'eco_pedidos_mes', sql: `
    WITH d AS (${PEDIDOS('18 months')})
    SELECT to_char(date_trunc('month', criado), 'YYYY-MM') AS periodo, count(*)::int AS pedidos,
           count(*) FILTER (WHERE st = 'accept')::int AS aceitos
      FROM d WHERE criado >= date_trunc('month', now()) - interval '17 months' GROUP BY 1 ORDER BY 1` },
  { id: 'eco_pedidos_dia', sql: `
    WITH d AS (${PEDIDOS('31 days')}), dias AS (SELECT generate_series(current_date - 29, current_date, interval '1 day')::date AS dia)
    SELECT to_char(dias.dia, 'YYYY-MM-DD') AS periodo, count(d.*)::int AS pedidos,
           count(d.*) FILTER (WHERE d.st = 'accept')::int AS aceitos
      FROM dias LEFT JOIN d ON d.criado::date = dias.dia GROUP BY dias.dia ORDER BY dias.dia` },
  { id: 'eco_funil_30', sql: FUNIL(30) },
  { id: 'eco_funil_90', sql: FUNIL(90) },
  { id: 'eco_funil_365', sql: FUNIL(365) },
  { id: 'eco_total_pedidos', sql: `WITH d AS (${PEDIDOS(null)}) SELECT count(*)::int AS pedidos, count(*) FILTER (WHERE st = 'accept')::int AS aceitos, min(criado)::date::text AS desde FROM d` },
  { id: 'eco_pendencias', sql: `
    SELECT count(*)::int AS vivas, count(DISTINCT restaurant_id)::int AS casas,
           count(*) FILTER (WHERE booking_date = current_date)::int AS mesa_hoje,
           count(*) FILTER (WHERE booking_date = current_date + 1)::int AS mesa_amanha,
           count(*) FILTER (WHERE booking_date BETWEEN current_date AND current_date + 7)::int AS mesa_7d,
           COALESCE(round(extract(epoch FROM now() - min(created_date)) / 86400)::int, 0) AS mais_antiga_dias
      FROM public.reservations
     WHERE expired_at IS NULL AND lower(btrim(booking_status)) IN ('pending', 'in treatment')
       AND booking_date >= current_date AND restaurant_id NOT IN ({{EX}})` },
  { id: 'eco_pendencias_idade', sql: `
    WITH p AS (SELECT extract(epoch FROM now() - created_date) / 3600 AS h FROM public.reservations
                WHERE expired_at IS NULL AND lower(btrim(booking_status)) IN ('pending', 'in treatment')
                  AND booking_date >= current_date AND restaurant_id NOT IN ({{EX}}))
    SELECT f.rotulo, count(p.h)::int AS valor
      FROM (VALUES (1, 'até 24 horas', 0, 24), (2, '1 a 3 dias', 24, 72), (3, '3 a 7 dias', 72, 168), (4, '1 a 4 semanas', 168, 672), (5, 'mais de 4 semanas', 672, 1000000)) AS f(ord, rotulo, de, ate)
      LEFT JOIN p ON p.h >= f.de AND p.h < f.ate GROUP BY f.ord, f.rotulo ORDER BY f.ord` },
  { id: 'eco_top_paises', sql: `
    SELECT COALESCE(NULLIF(btrim(country), ''), 'sem país') AS rotulo, count(*)::int AS valor
      FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}}) GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
  { id: 'eco_top_cidades', sql: `
    SELECT COALESCE(NULLIF(btrim(city), ''), 'sem cidade') AS rotulo, count(*)::int AS valor
      FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}}) GROUP BY 1 ORDER BY 2 DESC LIMIT 15` },
  { id: 'eco_top_casas', sql: `
    WITH d AS (${PEDIDOS('90 days')})
    SELECT initcap(lower(r.name)) || COALESCE(' · ' || r.city, '') AS rotulo, count(*)::int AS valor,
           count(*) FILTER (WHERE d.st = 'accept')::int AS aceitos
      FROM d JOIN public.db_restaurants r ON r.restaurant_id = d.restaurant_id GROUP BY r.name, r.city ORDER BY 2 DESC LIMIT 15` },
  { id: 'eco_cidades_demanda', sql: `
    WITH d AS (${PEDIDOS('90 days')})
    SELECT COALESCE(NULLIF(btrim(r.city), ''), 'sem cidade') AS rotulo, count(*)::int AS valor,
           count(*) FILTER (WHERE d.st = 'accept')::int AS aceitos
      FROM d JOIN public.db_restaurants r ON r.restaurant_id = d.restaurant_id GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },
  { id: 'eco_casas_confirmam', sql: `
    WITH d AS (${PEDIDOS('90 days')}),
         c AS (SELECT restaurant_id, count(*) AS n, count(*) FILTER (WHERE st = 'accept') AS a FROM d GROUP BY 1)
    SELECT count(*)::int AS casas_com_pedido, count(*) FILTER (WHERE n >= 4)::int AS com_4_ou_mais,
           count(*) FILTER (WHERE n >= 4 AND a * 2 >= n)::int AS confirmam,
           count(*) FILTER (WHERE a = 0)::int AS nunca_aceitaram FROM c` },
  { id: 'eco_contas_casas', sql: `
    SELECT (SELECT count(*)::int FROM public.restaurant_users WHERE restaurant_id NOT IN ({{EX}})) AS contas,
           (SELECT count(DISTINCT restaurant_id)::int FROM public.restaurant_users WHERE restaurant_id NOT IN ({{EX}})) AS casas_com_conta,
           (SELECT count(*)::int FROM public.restaurant_invitations) AS candidaturas,
           (SELECT count(*)::int FROM public.restaurant_invitations WHERE completed_at IS NOT NULL) AS candidaturas_concluidas,
           (SELECT count(*)::int FROM public.listing_claim_challenges WHERE verified_at IS NOT NULL) AS codigos_verificados,
           (SELECT count(*)::int FROM public.listing_claim_challenges) AS codigos_pedidos` },

  // ═══════════════════════ BANCO DE DADOS (DB Architect) ═══════════════════════
  { id: 'dba_completude', sql: `
    WITH p AS (SELECT r.*, EXISTS (SELECT 1 FROM public.opening_hours h WHERE h.restaurant_id = r.restaurant_id) AS tem_horario,
                      EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = btrim(r.timezone)) AS fuso_ok
                 FROM public.db_restaurants r WHERE r.published AND r.restaurant_id NOT IN ({{EX}}))
    SELECT x.rotulo, x.valor FROM (
      SELECT 1 AS ord, 'Fotos' AS rotulo, ${PCT(`images_json IS NOT NULL AND images_json::text NOT IN ('[]', '{}', 'null', '""')`)} AS valor FROM p
      UNION ALL SELECT 2, 'Horário de funcionamento', ${PCT('tem_horario')} FROM p
      UNION ALL SELECT 3, 'Fuso horário válido', ${PCT('fuso_ok')} FROM p
      UNION ALL SELECT 4, 'Localização no mapa', ${PCT('latitude IS NOT NULL AND longitude IS NOT NULL')} FROM p
      UNION ALL SELECT 5, 'Telefone da casa', ${PCT(`NULLIF(btrim(telephone_of_the_establishment), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 6, 'E-mail de reservas', ${PCT(`NULLIF(btrim(email_for_reservations), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 7, 'Texto de apresentação', ${PCT(`NULLIF(btrim(about_text), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 8, 'Site próprio', ${PCT(`NULLIF(btrim(site_url), '') IS NOT NULL`)} FROM p
    ) x ORDER BY x.ord` },
  { id: 'dba_frescor', sql: `
    SELECT count(*) FILTER (WHERE last_verified_at >= now() - interval '30 days')::int AS verificados_30d,
           count(*) FILTER (WHERE last_verified_at >= now() - interval '90 days')::int AS verificados_90d,
           count(*) FILTER (WHERE last_verified_at IS NULL)::int AS nunca_verificados,
           count(*) FILTER (WHERE ready_pending_photo)::int AS aguardando_foto,
           count(*) FILTER (WHERE do_not_relist)::int AS nao_relistar,
           (SELECT count(*)::int FROM (SELECT h.restaurant_id FROM public.opening_hours h JOIN public.db_restaurants r2 USING (restaurant_id)
                                        WHERE r2.published GROUP BY 1 HAVING count(DISTINCT (h.open_time, h.close_time)) = 1 AND count(*) >= 6) g) AS horarios_genericos
      FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}})` },
  { id: 'dba_despublicados', sql: `
    SELECT count(*) FILTER (WHERE NOT published)::int AS nao_publicados, count(*) FILTER (WHERE published)::int AS publicados,
           round(100.0 * count(*) FILTER (WHERE published) / NULLIF(count(*), 0), 1)::float AS pct_publicado
      FROM public.db_restaurants WHERE restaurant_id NOT IN ({{EX}})` },
  { id: 'dba_auditoria', sql: `
    SELECT agent AS rotulo, count(*)::int AS valor, max(created_at) AS ultimo
      FROM public.agent_audit_log WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
  { id: 'dba_auditoria_resumo', sql: `
    SELECT count(*)::int AS alteracoes_30d, count(DISTINCT table_name)::int AS tabelas, max(created_at) AS ultima,
           (SELECT count(*)::int FROM public.agent_audit_log) AS total
      FROM public.agent_audit_log WHERE created_at >= now() - interval '30 days'` },
  { id: 'dba_tabelas', sql: `
    SELECT relname AS rotulo, n_live_tup::int AS valor, pg_size_pretty(pg_total_relation_size(relid)) AS tamanho
      FROM pg_stat_user_tables WHERE schemaname IN ('public', 'nextauth') ORDER BY pg_total_relation_size(relid) DESC LIMIT 12` },
  // Quem consegue ESCREVER: lê as permissões reais de cada tabela (relacl), que é o que o servidor aplica.
  { id: 'dba_papeis', sql: `
    SELECT r.rolname AS papel,
           count(*) FILTER (WHERE n.nspname = 'public')::int AS tabelas_que_altera,
           CASE WHEN count(*) FILTER (WHERE n.nspname = 'nextauth') > 0 THEN 'sim' ELSE 'não' END AS altera_contas_de_cliente,
           CASE WHEN r.rolname = 'twk_ro' THEN 'somente leitura' WHEN r.rolname = 'twk_dba' THEN 'porta única de escrita'
                WHEN r.rolname = 'postgres' THEN 'dono do banco'
                WHEN count(*) FILTER (WHERE n.nspname IN ('public', 'nextauth')) > 0 THEN 'escrita de serviço'
                WHEN EXISTS (SELECT 1 FROM pg_attribute at CROSS JOIN LATERAL aclexplode(at.attacl) x WHERE x.grantee = r.oid AND x.privilege_type = 'UPDATE') THEN 'escrita só em campos específicos'
                ELSE 'só leitura ou sem acesso' END AS para_que
      FROM pg_roles r
      LEFT JOIN (pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND c.relkind = 'r' CROSS JOIN LATERAL aclexplode(c.relacl) a)
             ON a.grantee = r.oid AND a.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
     WHERE r.rolcanlogin AND r.rolname NOT LIKE 'cloudsql%'
     GROUP BY r.oid, r.rolname ORDER BY 2 DESC, 1 LIMIT 16` },
  { id: 'dba_fila_foto', sql: `
    SELECT count(*) FILTER (WHERE NOT published AND ready_pending_photo)::int AS aguardando_foto,
           count(*) FILTER (WHERE do_not_relist)::int AS nao_relistar,
           count(*) FILTER (WHERE NOT published)::int AS fora_do_site
      FROM public.db_restaurants WHERE restaurant_id NOT IN ({{EX}})` },
  // A plataforma não grava a hora da resposta da casa; a aproximação usa o vigia da Aria (ativo desde 30/09/2026).
  { id: 'eco_tempo_resposta', sql: `
    SELECT count(*)::int AS respostas,
           round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (w.last_change AT TIME ZONE 'UTC') - r.created_date) / 3600))::numeric, 1)::float AS mediana_horas
      FROM public.aria_reservation_watch w JOIN public.reservations r USING (reservation_code)
     WHERE w.status IN ('accept', 'decline')
       AND r.created_date >= (SELECT min(first_seen) AT TIME ZONE 'UTC' FROM public.aria_reservation_watch)` },

  // ═══════════════════════ ARIA (Suporte e Concierge) ═══════════════════════
  { id: 'aria_pulso', sql: `
    SELECT (SELECT count(*)::int FROM public.aria_messages WHERE direction = 'inbound' AND created_at >= now() - interval '24 hours') AS recebidas_24h,
           (SELECT count(*)::int FROM public.aria_messages WHERE direction = 'outbound' AND created_at >= now() - interval '24 hours') AS enviadas_24h,
           (SELECT count(DISTINCT chat_id)::int FROM public.aria_messages WHERE created_at >= now() - interval '30 days') AS conversas_30d,
           (SELECT count(*)::int FROM public.aria_messages) AS mensagens_total,
           (SELECT round(extract(epoch FROM now() - max(created_at)) / 3600)::int FROM public.aria_messages WHERE direction = 'outbound') AS horas_sem_enviar,
           (SELECT anthropic_ok FROM public.aria_health_checks ORDER BY checked_at DESC LIMIT 1) AS modelo_ok,
           (SELECT count(*)::int FROM public.aria_escalations WHERE status = 'open') AS escalacoes_abertas,
           (SELECT count(*)::int FROM public.aria_escalations WHERE status = 'open' AND tag = 'URGENTE') AS escalacoes_urgentes,
           (SELECT count(*)::int FROM public.aria_pending_whatsapp) + (SELECT count(*)::int FROM public.aria_pending_emails) AS fila_de_reenvio` },
  { id: 'aria_mensagens_dia', sql: `
    WITH dias AS (SELECT generate_series(current_date - 29, current_date, interval '1 day')::date AS dia)
    SELECT to_char(dias.dia, 'YYYY-MM-DD') AS periodo,
           count(m.*) FILTER (WHERE m.direction = 'inbound')::int AS recebidas,
           count(m.*) FILTER (WHERE m.direction = 'outbound')::int AS enviadas
      FROM dias LEFT JOIN public.aria_messages m ON m.created_at::date = dias.dia GROUP BY dias.dia ORDER BY dias.dia` },
  { id: 'aria_canais', sql: `
    SELECT CASE WHEN chat_id LIKE 'email:%' THEN 'E-mail' ELSE 'WhatsApp' END AS rotulo, count(DISTINCT chat_id)::int AS valor, count(*)::int AS mensagens
      FROM public.aria_messages WHERE created_at >= now() - interval '90 days' GROUP BY 1 ORDER BY 2 DESC` },
  { id: 'aria_escalacoes', sql: `
    SELECT count(*) FILTER (WHERE status = 'open')::int AS abertas,
           count(*) FILTER (WHERE status = 'resolved' AND resolved_at >= now() - interval '30 days')::int AS resolvidas_30d,
           count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS novas_7d,
           count(*)::int AS total,
           COALESCE(round(extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'open')) / 3600)::int, 0) AS mais_antiga_horas
      FROM public.aria_escalations` },
  { id: 'aria_escalacoes_tag', sql: `
    SELECT initcap(replace(lower(tag), '_', ' ')) AS rotulo, count(*)::int AS valor, count(*) FILTER (WHERE status = 'open')::int AS abertas
      FROM public.aria_escalations WHERE created_at >= now() - interval '90 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10` },
  { id: 'aria_saude', sql: `
    SELECT round(100.0 * avg((overall_ok)::int), 2)::float AS pct_ok, count(*)::int AS checagens,
           (count(*) FILTER (WHERE anthropic_ok IS FALSE) * 5)::int AS minutos_sem_modelo,
           (count(*) FILTER (WHERE whatsapp_ok IS FALSE) * 5)::int AS minutos_sem_whatsapp,
           (count(*) FILTER (WHERE db_ok IS FALSE) * 5)::int AS minutos_sem_banco
      FROM public.aria_health_checks WHERE checked_at >= now() - interval '30 days'` },
  { id: 'aria_saude_dia', sql: `
    SELECT to_char(checked_at::date, 'YYYY-MM-DD') AS periodo, round(100.0 * avg((overall_ok)::int), 1)::float AS disponibilidade
      FROM public.aria_health_checks WHERE checked_at >= current_date - 29 GROUP BY checked_at::date ORDER BY checked_at::date` },
  { id: 'aria_llm', sql: `
    SELECT COALESCE(sum(api_calls), 0)::int AS chamadas, round(COALESCE(sum(input_tokens + cache_read_tokens + cache_creation_tokens), 0) / 1000000.0, 2)::float AS milhoes_tokens_lidos,
           round(COALESCE(sum(output_tokens), 0) / 1000000.0, 3)::float AS milhoes_tokens_escritos, count(DISTINCT chat_id)::int AS conversas
      FROM public.aria_llm_usage WHERE created_at >= now() - interval '30 days'` },
  { id: 'aria_llm_modelo', sql: `
    SELECT model AS rotulo, COALESCE(sum(api_calls), 0)::int AS valor FROM public.aria_llm_usage
     WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 6` },
  { id: 'aria_tools', sql: `
    SELECT count(*)::int AS chamadas, ${PCT('success')} AS pct_sucesso, round(avg(latency_ms))::int AS latencia_media_ms, count(DISTINCT tool_name)::int AS ferramentas_usadas
      FROM public.aria_tool_calls WHERE created_at >= now() - interval '30 days'` },
  { id: 'aria_tools_rank', sql: `
    SELECT tool_name AS rotulo, count(*)::int AS valor, ${PCT('success')} AS sucesso
      FROM public.aria_tool_calls WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },
  { id: 'aria_juiz', sql: `
    SELECT count(*)::int AS julgadas, round(avg(nota), 1)::float AS nota_media, count(*) FILTER (WHERE nota < 5)::int AS reprovadas, max(judged_at) AS ultima
      FROM public.aria_quality_scores WHERE judged_at >= now() - interval '30 days'` },
  { id: 'aria_juiz_criterios', sql: `
    SELECT c.rotulo, round(100.0 * avg((q.notas::jsonb ->> c.chave)::int), 0)::float AS valor
      FROM public.aria_quality_scores q
      CROSS JOIN (VALUES ('discricao', 'Discrição'), ('idioma_ok', 'Idioma do cliente'), ('sem_prazo', 'Sem prometer prazo'),
                         ('tom_marca', 'Tom da marca'), ('resolve_agora', 'Resolve agora'), ('sem_vocabulario_interno', 'Sem vocabulário interno')) AS c(chave, rotulo)
     WHERE q.judged_at >= now() - interval '90 days' GROUP BY c.rotulo ORDER BY 2` },
  { id: 'aria_escopo', sql: `
    SELECT count(*)::int AS bloqueios_30d,
           count(*) FILTER (WHERE layer = 'structural')::int AS automaticos,
           count(*) FILTER (WHERE layer = 'semantic')::int AS por_leitura,
           count(*) FILTER (WHERE layer = 'outbound')::int AS respostas_retidas
      FROM public.aria_scope_blocks WHERE created_at >= now() - interval '30 days'` },
  { id: 'aria_notificacoes', sql: `
    SELECT CASE desfecho WHEN 'enviado' THEN 'Enviada' WHEN 'sem_opt_in' THEN 'Cliente sem opt-in' WHEN 'sem_destinatario' THEN 'Casa sem número marcado'
                WHEN 'telefone_nao_enviavel' THEN 'Telefone inválido ou fixo' WHEN 'falha_envio' THEN 'Recusada pela Meta' WHEN 'bloqueado_indisponivel' THEN 'Número sem WhatsApp'
                WHEN 'opt_in' THEN 'Opt-in feito pelo cliente' WHEN 'alerta_enviado' THEN 'Alerta ao operador' WHEN 'alerta_falhou' THEN 'Alerta ao operador falhou'
                WHEN 'duplicado' THEN 'Já tinha sido enviada' WHEN 'dados_insuficientes' THEN 'Faltou dado da reserva' WHEN 'teto_diario' THEN 'Teto diário atingido'
                ELSE replace(desfecho, '_', ' ') END AS rotulo,
           count(*)::int AS valor
      FROM public.aria_outbound_log WHERE created_at >= now() - interval '30 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 12` },
  { id: 'aria_entrega', sql: `
    SELECT count(*)::int AS aceitas_pela_meta, count(*) FILTER (WHERE status IN ('delivered', 'read'))::int AS entregues,
           count(*) FILTER (WHERE status = 'read')::int AS lidas, count(*) FILTER (WHERE status = 'failed')::int AS falharam,
           count(*) FILTER (WHERE status = 'sent')::int AS sem_confirmacao
      FROM public.aria_delivery_status WHERE sent_at >= now() - interval '30 days'` },
  { id: 'aria_optin', sql: `
    SELECT count(*) FILTER (WHERE tipo = 'cliente' AND whatsapp_reservas)::int AS clientes,
           count(*) FILTER (WHERE tipo = 'estabelecimento' AND whatsapp_reservas)::int AS casas,
           count(*) FILTER (WHERE whatsapp_indisponivel)::int AS numeros_sem_whatsapp,
           count(*) FILTER (WHERE outbound_opted_out)::int AS pediram_para_parar
      FROM public.aria_contact_consent` },
  { id: 'aria_testes', sql: `
    WITH u AS (SELECT run_id FROM public.aria_test_results ORDER BY run_at DESC LIMIT 1)
    SELECT count(*)::int AS testes, count(*) FILTER (WHERE passed)::int AS passaram, max(run_at) AS quando
      FROM public.aria_test_results WHERE run_id = (SELECT run_id FROM u)` },
  { id: 'aria_compromissos', sql: `
    SELECT count(*) FILTER (WHERE status = 'aberto')::int AS abertos, count(*) FILTER (WHERE status = 'aberto' AND due_at < current_date)::int AS vencidos, count(*)::int AS total
      FROM public.aria_commitments` },
  { id: 'aria_revisao', sql: `
    SELECT count(*) FILTER (WHERE tentativa = 1)::int AS revisadas, count(*) FILTER (WHERE tentativa = 1 AND aprovado)::int AS aprovadas_de_primeira,
           count(*) FILTER (WHERE tentativa = 2 AND aprovado)::int AS corrigidas, count(*) FILTER (WHERE tentativa = 2 AND NOT aprovado)::int AS retidas
      FROM public.aria_prechecks WHERE created_at >= now() - interval '30 days'` },
  { id: 'aria_memoria', sql: `
    SELECT (SELECT count(*)::int FROM public.aria_customer_profiles) AS perfis,
           (SELECT count(*)::int FROM public.aria_experience_reviews) AS avaliacoes,
           (SELECT round(avg(establishment_rating), 1)::float FROM public.aria_experience_reviews) AS nota_casas,
           (SELECT round(avg(platform_rating), 1)::float FROM public.aria_experience_reviews) AS nota_plataforma,
           (SELECT count(*)::int FROM public.aria_handoffs WHERE until > now()) AS conversas_com_humano` },

  // ═══════════════════════ CLAVIS (Comercial) ═══════════════════════
  { id: 'clavis_campanhas', sql: `
    SELECT count(*)::int AS envios, count(DISTINCT restaurant_id)::int AS casas_contatadas,
           count(*) FILTER (WHERE status = 'bounce')::int AS devolvidos, max(sent_at) AS ultimo_envio,
           (SELECT count(*)::int FROM public.aria_campaign_clicks) AS cliques,
           (SELECT count(DISTINCT restaurant_id)::int FROM public.aria_campaign_clicks) AS casas_que_clicaram
      FROM public.aria_campaign_sends` },
  { id: 'clavis_envios_semana', sql: `
    SELECT to_char(date_trunc('week', sent_at), 'YYYY-MM-DD') AS periodo, count(*)::int AS envios
      FROM public.aria_campaign_sends WHERE sent_at IS NOT NULL GROUP BY 1 ORDER BY 1` },
  { id: 'clavis_idiomas', sql: `
    SELECT upper(COALESCE(NULLIF(language, ''), '—')) AS rotulo, count(*)::int AS valor FROM public.aria_campaign_sends GROUP BY 1 ORDER BY 2 DESC LIMIT 8` },
  { id: 'clavis_negociacao', sql: `
    SELECT CASE negotiation_status::text WHEN 'Partner' THEN 'Parceira' WHEN 'Pending' THEN 'Aguardando resposta' WHEN 'Negotiation' THEN 'Em negociação'
                WHEN 'Interested' THEN 'Interessada' WHEN 'Decline' THEN 'Recusou' ELSE negotiation_status::text END AS rotulo, count(*)::int AS valor
      FROM public.db_restaurants WHERE negotiation_status IS NOT NULL AND restaurant_id NOT IN ({{EX}}) GROUP BY 1 ORDER BY 2 DESC` },
  { id: 'clavis_parceiros', sql: `
    WITH d AS (${PEDIDOS('30 days')})
    SELECT count(*) FILTER (WHERE r.partner IS TRUE)::int AS pedidos_parceiras,
           CASE WHEN count(*) FILTER (WHERE r.partner IS TRUE) > 0 THEN round(100.0 * count(*) FILTER (WHERE r.partner IS TRUE AND d.st = 'accept') / count(*) FILTER (WHERE r.partner IS TRUE), 1)::float END AS aceite_parceiras,
           count(*) FILTER (WHERE r.partner IS NOT TRUE)::int AS pedidos_outras,
           CASE WHEN count(*) FILTER (WHERE r.partner IS NOT TRUE) > 0 THEN round(100.0 * count(*) FILTER (WHERE r.partner IS NOT TRUE AND d.st = 'accept') / count(*) FILTER (WHERE r.partner IS NOT TRUE), 1)::float END AS aceite_outras
      FROM d JOIN public.db_restaurants r ON r.restaurant_id = d.restaurant_id` },
  { id: 'clavis_optout', sql: `SELECT count(*)::int AS casas FROM public.v_listing_consent_atual` },

  // ═══════════════════════ QUILL (Editorial) — o resultado no catálogo ═══════════════════════
  { id: 'quill_cobertura', sql: `
    WITH p AS (SELECT * FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}}))
    SELECT x.rotulo, x.valor FROM (
      SELECT 1 AS ord, 'Texto de apresentação' AS rotulo, ${PCT(`NULLIF(btrim(about_text), '') IS NOT NULL`)} AS valor FROM p
      UNION ALL SELECT 2, 'Texto em inglês', ${PCT(`NULLIF(btrim(about_en), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 3, 'Texto em francês', ${PCT(`NULLIF(btrim(about_fr), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 4, 'Texto em português', ${PCT(`NULLIF(btrim(about_pt), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 5, 'Título para o Google', ${PCT(`NULLIF(btrim(meta_title), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 6, 'Descrição para o Google', ${PCT(`NULLIF(btrim(meta_description), '') IS NOT NULL`)} FROM p
      UNION ALL SELECT 7, 'Dados estruturados', ${PCT('structured_data_json IS NOT NULL')} FROM p
      UNION ALL SELECT 8, 'Perfil do chef', ${PCT(`NULLIF(btrim(chef_name), '') IS NOT NULL`)} FROM p
    ) x ORDER BY x.ord` },
  { id: 'quill_textos', sql: `
    SELECT count(*) FILTER (WHERE NULLIF(btrim(about_text), '') IS NOT NULL)::int AS fichas_com_texto,
           round(avg(length(about_text)) FILTER (WHERE NULLIF(btrim(about_text), '') IS NOT NULL))::int AS tamanho_medio,
           count(*) FILTER (WHERE NULLIF(btrim(meta_title), '') IS NOT NULL AND NULLIF(btrim(meta_description), '') IS NOT NULL)::int AS com_meta_completa,
           count(*) FILTER (WHERE NULLIF(btrim(about_text), '') IS NULL)::int AS sem_texto,
           count(*)::int AS publicadas
      FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}})` },

  // ═══════════════════════ GUARDIÃO DA RESERVA ═══════════════════════
  { id: 'guardiao_cobranca', sql: `
    SELECT count(*)::int AS pendentes, count(*) FILTER (WHERE followup_6h_sent_at IS NULL)::int AS sem_cobranca,
           count(*) FILTER (WHERE booking_date <= current_date + 3)::int AS mesa_em_3_dias, count(DISTINCT restaurant_id)::int AS casas
      FROM public.reservations
     WHERE expired_at IS NULL AND lower(btrim(booking_status)) IN ('pending', 'in treatment') AND booking_date >= current_date AND restaurant_id NOT IN ({{EX}})` },
  { id: 'guardiao_casas_pendentes', sql: `
    SELECT initcap(lower(d.name)) || COALESCE(' · ' || d.city, '') AS rotulo, count(*)::int AS valor
      FROM public.reservations r JOIN public.db_restaurants d USING (restaurant_id)
     WHERE r.expired_at IS NULL AND lower(btrim(r.booking_status)) IN ('pending', 'in treatment') AND r.booking_date >= current_date AND r.restaurant_id NOT IN ({{EX}})
     GROUP BY d.name, d.city ORDER BY 2 DESC LIMIT 12` },
  { id: 'guardiao_expiradas', sql: `
    SELECT count(*) FILTER (WHERE expired_at IS NOT NULL)::int AS expiradas_total,
           count(*) FILTER (WHERE expired_at >= now() - interval '30 days')::int AS expiradas_30d
      FROM public.reservations WHERE restaurant_id NOT IN ({{EX}})` },

  // ═══════════════════════ ATLAS (Financeiro) — o que existe no banco da plataforma ═══════════════════════
  // O Atlas tem banco próprio (espelho do Stripe); daqui só se vê o que o SITE gravou sobre pagamentos.
  { id: 'atlas_depositos', sql: `
    SELECT count(*)::int AS depositos, count(*) FILTER (WHERE status = 'charged')::int AS cobrados,
           count(*) FILTER (WHERE status = 'guarantee_pending')::int AS garantias_pendentes,
           (SELECT count(*)::int FROM public.deposit_rules) AS regras
      FROM public.reservation_deposits` },
  { id: 'atlas_eventos', sql: `
    SELECT count(*)::int AS eventos, count(*) FILTER (WHERE payload->>'livemode' = 'true')::int AS reais, max(processed_at) AS ultimo
      FROM public.stripe_webhook_events` },
  { id: 'atlas_assinaturas', sql: `SELECT count(*)::int AS ativas FROM public.stripe_subscriptions WHERE status IN ('active', 'past_due')` },
  { id: 'atlas_parceiras', sql: `
    SELECT count(*) FILTER (WHERE partner IS TRUE)::int AS parceiras,
           count(*) FILTER (WHERE partner IS TRUE AND commission_per_person IS NOT NULL AND commission_per_person::text NOT IN ('', '0'))::int AS com_comissao_definida
      FROM public.db_restaurants WHERE restaurant_id NOT IN ({{EX}})` },

  // ═══════════════════════ acréscimos conferidos pelos inventários de 05/10/2026 ═══════════════════════
  // QUILL — o texto que está no ar, medido contra o guia de estilo (150 a 320 palavras; 16 clichês vetados).
  { id: 'quill_padrao', sql: `
    WITH w AS (SELECT array_length(regexp_split_to_array(btrim(about_text), '\\s+'), 1) AS n
                 FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}}))
    SELECT round(avg(n))::int AS media_palavras, (percentile_cont(0.5) WITHIN GROUP (ORDER BY n))::int AS mediana_palavras,
           count(*) FILTER (WHERE n BETWEEN 150 AND 320)::int AS no_padrao, count(*) FILTER (WHERE n < 150)::int AS curtas,
           round(100.0 * count(*) FILTER (WHERE n BETWEEN 150 AND 320) / NULLIF(count(*), 0), 1)::float AS pct_no_padrao
      FROM w` },
  { id: 'quill_cliches', sql: `
    SELECT count(*) FILTER (WHERE about_text ~* '\\m(best|finest|ultimate|world-class|unparalleled|amazing|breathtaking|stunning|must-try|hidden gem|culinary journey|nestled|boasts|boasting|tucked away|in the heart of)\\M')::int AS com_cliche,
           count(*)::int AS publicadas,
           round(100.0 * count(*) FILTER (WHERE about_text ~* '\\m(best|finest|ultimate|world-class|unparalleled|amazing|breathtaking|stunning|must-try|hidden gem|culinary journey|nestled|boasts|boasting|tucked away|in the heart of)\\M') / NULLIF(count(*), 0), 1)::float AS pct_com_cliche,
           count(*) FILTER (WHERE about_text ~* 'michelin' AND michelin_id IS NULL)::int AS michelin_sem_registro
      FROM public.db_restaurants WHERE published AND restaurant_id NOT IN ({{EX}})` },
  { id: 'quill_cidades', sql: `
    SELECT count(*)::int AS cidades, count(*) FILTER (WHERE NULLIF(btrim(description), '') IS NOT NULL)::int AS com_texto,
           round(100.0 * count(*) FILTER (WHERE NULLIF(btrim(description), '') IS NOT NULL) / NULLIF(count(*), 0), 1)::float AS pct_com_texto
      FROM public.cities` },

  // CLAVIS — o funil até a conta de restaurante.
  { id: 'clavis_resposta', sql: `
    WITH d AS (${PEDIDOS('90 days')}),
         c AS (SELECT restaurant_id, count(*) AS p, count(*) FILTER (WHERE st IN ('accept', 'decline')) AS x FROM d GROUP BY 1)
    SELECT count(*)::int AS casas_com_pedido, count(*) FILTER (WHERE x > 0)::int AS casas_que_respondem,
           count(*) FILTER (WHERE p >= 5)::int AS casas_prioritarias, COALESCE(sum(p), 0)::int AS pedidos FROM c` },
  { id: 'clavis_funil', sql: `
    SELECT (SELECT count(DISTINCT restaurant_id)::int FROM public.aria_campaign_sends) AS contatadas,
           (SELECT count(DISTINCT restaurant_id)::int FROM public.aria_campaign_clicks) AS clicaram,
           (SELECT count(DISTINCT restaurant_id)::int FROM public.listing_claim_challenges) AS pediram_codigo,
           (SELECT count(DISTINCT restaurant_id)::int FROM public.listing_claim_challenges WHERE verified_at IS NOT NULL) AS verificaram,
           (SELECT count(DISTINCT restaurant_id)::int FROM public.restaurant_users WHERE restaurant_id NOT IN ({{EX}})) AS criaram_conta` },
  { id: 'clavis_saida', sql: `SELECT count(DISTINCT restaurant_id)::int AS casas FROM public.v_listing_consent_atual WHERE status = 'opted_out'` },

  // ARIA — custo estimado e tempo até a primeira resposta.
  // Não há coluna de dinheiro: a estimativa usa a tabela de preços do painel da Aria (US$ por milhão de tokens:
  // opus 5 entrada / 25 saída, sonnet 3 / 15, haiku 1 / 5; gravação de cache 1,25x, leitura 0,1x). Contas em inteiros.
  { id: 'aria_custo', sql: `
    SELECT round(COALESCE(sum((input_tokens * 100 + output_tokens * 500 + cache_creation_tokens * 125 + cache_read_tokens * 10)
                 * CASE WHEN model LIKE '%opus%' THEN 5 WHEN model LIKE '%sonnet%' THEN 3 ELSE 1 END), 0) / 100000000.0, 2)::float AS usd_30d
      FROM public.aria_llm_usage WHERE created_at >= now() - interval '30 days'` },
  { id: 'aria_primeira_resposta', sql: `
    SELECT count(*)::int AS conversas, count(r)::int AS respondidas,
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM r - p)))::int AS mediana_segundos
      FROM (SELECT min(m.created_at) AS p,
                   (SELECT min(o.created_at) FROM public.aria_messages o
                     WHERE o.chat_id = m.chat_id AND o.direction = 'outbound' AND o.created_at > min(m.created_at)) AS r
              FROM public.aria_messages m WHERE m.direction = 'inbound' AND m.created_at >= now() - interval '30 days' GROUP BY m.chat_id) x` },
  { id: 'aria_alerta', sql: `
    SELECT count(*) FILTER (WHERE desfecho = 'alerta_enviado')::int AS enviados, count(*) FILTER (WHERE desfecho = 'alerta_falhou')::int AS falharam,
           max(created_at) FILTER (WHERE desfecho = 'alerta_enviado') AS ultimo_enviado
      FROM public.aria_outbound_log WHERE origem = 'alerta'` },
];
