import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { query, queryReadOnly, queryWrite, withTransaction, listTables, getTableSchema, getRowCount, logUpdateEvent } from './db';
import { safeIdent, safeColumn } from './sql-guard';
import { searchRestaurantsByCity, getPlaceDetails, enrichFromMichelinGuide, mapPlaceToDBSchema } from './places';
import { webSearch, fetchUrl, findSocialMedia } from './scraper';
import { findRestaurantEmail, batchFindEmails } from './email-finder';
import { auditRows, scoreRowCompleteness, findDuplicateGroups, validateValue } from './validator';
import { batchCheckEmails, batchCheckUrls, checkPhoneReality, checkPlacesFreshness, validateGeoCoords } from './reality-checker';
import { detectNumericOutliers, detectDateAnomalies, detectPlaceholders, detectOverRepetition, detectGeofenceViolations } from './outlier-detector';
import { batchSemanticAnalysis } from './semantic-checker';
import { generateAutoFixSuggestions } from './auto-fixer';
import { saveSnapshot, analyzeTrend } from './monitoring';
import { buildRestaurantSchema, seoAudit } from './seo';
import { captureSnapshot, getHealthTrend } from './observability';
import { bus } from './event-bus';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Model configuration (env-overridable) ────────────────────────────────────
// AGENT_MODEL drives the agentic loop; defaults to the most capable Claude model.
// Set AGENT_MODEL=claude-sonnet-4-6 to trade some capability for lower cost/latency.
const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-opus-4-8';
const WRITER_MODEL = process.env.WRITER_MODEL || 'claude-sonnet-4-6'; // cheaper model for copy generation

// ── Adaptive thinking & effort ────────────────────────────────────────────────
// Opus 4.8 / Sonnet 4.6 use *adaptive* thinking: the model decides how much to reason
// and interleaves thinking between tool calls automatically (no beta header needed).
// The old { type:'enabled', budget_tokens } form returns a 400 on these models, so we
// must use { type:'adaptive' } here. Turn thinking off entirely with AGENT_THINKING=off.
const THINKING_ENABLED = (process.env.AGENT_THINKING ?? 'on').toLowerCase() !== 'off';
// Effort tunes reasoning depth and overall token spend: low | medium | high | max.
const AGENT_EFFORT = (process.env.AGENT_EFFORT ?? 'high').toLowerCase();
const MAX_TOKENS = Math.max(parseInt(process.env.AGENT_MAX_TOKENS ?? '16000', 10), 8192);

// ── Cost telemetry (per-MTok USD; override via env to match your contract) ─────
const PRICE_IN  = parseFloat(process.env.AGENT_PRICE_IN  ?? '5');    // input tokens
const PRICE_OUT = parseFloat(process.env.AGENT_PRICE_OUT ?? '25');   // output tokens
const CACHE_WRITE_MULT = 1.25; // 5-min cache write surcharge
const CACHE_READ_MULT  = 0.1;  // cache hit discount

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_creation: number;
  cost_usd: number;
}

function estimateCost(u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): number {
  const inp = u.input_tokens ?? 0;
  const out = u.output_tokens ?? 0;
  const cr = u.cache_read_input_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  return (
    (inp * PRICE_IN + out * PRICE_OUT + cr * PRICE_IN * CACHE_READ_MULT + cw * PRICE_IN * CACHE_WRITE_MULT) / 1_000_000
  );
}

// Resilient wrapper: retries transient overload/rate-limit/5xx with exponential backoff.
// Used by secondary one-shot model calls (description/copy generation).
async function createMessage(params: Anthropic.MessageCreateParamsNonStreaming, attempt = 0): Promise<Anthropic.Message> {
  try {
    return await anthropic.messages.create(params);
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const retryable = status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
    if (retryable && attempt < 4) {
      const wait = Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 400;
      await new Promise((r) => setTimeout(r, wait));
      return createMessage(params, attempt + 1);
    }
    throw err;
  }
}

// ── Tool definitions ────────────────────────────────────────────────────────

export const tools: Anthropic.Tool[] = [
  {
    name: 'execute_query',
    description: 'Execute a read-only SQL SELECT query and return results',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'The SQL SELECT query to execute' },
        params: { type: 'array', items: {}, description: 'Optional query parameters' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'execute_mutation',
    description:
      'Execute an INSERT, UPDATE or DELETE with hard guardrails: single statement, no DDL, ' +
      'UPDATE/DELETE require WHERE (or allow_full_table=true), automatic rollback if more than ' +
      'max_affected_rows (default 500) would be touched, and mandatory audit logging. ' +
      'Schema changes (CREATE/ALTER/DROP) are blocked — use versioned migrations instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'The SQL mutation to execute' },
        params: { type: 'array', items: {}, description: 'Optional query parameters' },
        table: { type: 'string', description: 'Table being modified (for audit log)' },
        operation: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] },
        max_affected_rows: { type: 'number', description: 'Blast-radius limit; rollback if exceeded (default 500)' },
        allow_full_table: { type: 'boolean', description: 'Explicitly allow UPDATE/DELETE without WHERE' },
      },
      required: ['sql', 'table', 'operation'],
    },
  },
  {
    name: 'get_table_schema',
    description: 'Get the column schema for a database table',
    input_schema: {
      type: 'object' as const,
      properties: { table_name: { type: 'string' } },
      required: ['table_name'],
    },
  },
  {
    name: 'list_all_tables',
    description: 'List all tables in the database',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_row_count',
    description: 'Get the number of rows in a table',
    input_schema: {
      type: 'object' as const,
      properties: { table_name: { type: 'string' } },
      required: ['table_name'],
    },
  },
  {
    name: 'bulk_insert',
    description: 'Insert multiple rows into a table within a single transaction',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string' },
        rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['table', 'rows'],
    },
  },
  {
    name: 'search_restaurants',
    description: 'Search for restaurants in a city using Google Places API',
    input_schema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string' },
        cuisine: { type: 'string', default: 'fine dining' },
        count: { type: 'number', default: 20 },
      },
      required: ['city'],
    },
  },
  {
    name: 'get_place_details',
    description: 'Get full details for a Google Places place_id',
    input_schema: {
      type: 'object' as const,
      properties: { place_id: { type: 'string' } },
      required: ['place_id'],
    },
  },
  {
    name: 'enrich_from_michelin',
    description: 'Look up Michelin guide stars and distinctions for a restaurant',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        city: { type: 'string' },
      },
      required: ['name', 'city'],
    },
  },
  {
    name: 'generate_description',
    description: 'Generate a luxury editorial description for a restaurant using AI',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        city: { type: 'string' },
        cuisine: { type: 'string' },
        details: { type: 'string', description: 'Additional context about the restaurant' },
      },
      required: ['name', 'city'],
    },
  },
  {
    name: 'find_social_media',
    description: 'Find social media profiles for a restaurant',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        city: { type: 'string' },
      },
      required: ['name', 'city'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for information',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' },
        count: { type: 'number', default: 5 },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch and extract text content from a URL',
    input_schema: {
      type: 'object' as const,
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },

  // ── Data Quality Tools ──────────────────────────────────────────────────
  {
    name: 'audit_table',
    description: 'Run a full data quality audit on a table: validates emails, phones, URLs, coordinates, finds duplicates and scores completeness. Returns a detailed report with issue count, quality score (0-100) and per-column breakdown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table:   { type: 'string', description: 'Table name (e.g. public.db_restaurants)' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Specific columns to audit (omit for all)' },
        limit:   { type: 'number', description: 'Max rows to scan (default 2000)' },
      },
      required: ['table'],
    },
  },
  {
    name: 'validate_column',
    description: 'Validate all values in a specific column: check email formats, phone numbers, URLs, slugs, ratings, etc. Returns invalid values with suggested corrections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table:  { type: 'string' },
        column: { type: 'string' },
        limit:  { type: 'number', default: 1000 },
      },
      required: ['table', 'column'],
    },
  },
  {
    name: 'find_duplicates',
    description: 'Find duplicate or near-duplicate records using fuzzy name matching (Jaccard trigrams). Returns groups of similar records with similarity score.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table:       { type: 'string' },
        name_column: { type: 'string', default: 'name' },
        id_column:   { type: 'string', default: 'id' },
        threshold:   { type: 'number', description: 'Similarity threshold 0.5-1.0 (default 0.85)' },
      },
      required: ['table'],
    },
  },
  {
    name: 'completeness_report',
    description: 'Score each row by how many recommended fields are filled (0-100%). Returns worst records, best records and distribution breakdown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string' },
        limit: { type: 'number', default: 500 },
      },
      required: ['table'],
    },
  },
  {
    name: 'consistency_check',
    description: 'Run cross-table consistency checks: restaurants without opening hours, orphan reservations, duplicate slugs/emails, zero coordinates, missing photos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Primary table context (optional)' },
      },
    },
  },
  {
    name: 'fix_data_issue',
    description: 'Apply a single documented fix to a field value. Automatically logs old value, new value and reason to agent_audit_log for full auditability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table:     { type: 'string' },
        id_column: { type: 'string', default: 'id' },
        id_value:  { description: 'Row identifier value' },
        column:    { type: 'string' },
        new_value: { description: 'Corrected value' },
        reason:    { type: 'string', description: 'Why this fix was applied' },
      },
      required: ['table', 'id_value', 'column', 'new_value', 'reason'],
    },
  },
  {
    name: 'batch_fix',
    description: 'Apply multiple documented fixes in one operation. Each fix is logged individually. Use after audit_table or validate_column identifies issues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fixes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              table:     { type: 'string' },
              id_column: { type: 'string' },
              id_value:  {},
              column:    { type: 'string' },
              new_value: {},
              reason:    { type: 'string' },
            },
          },
        },
      },
      required: ['fixes'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── REALITY CHECK TOOLS ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'check_emails_reality',
    description: 'Verifica se e-mails são realmente válidos via DNS MX lookup. Detecta domínios inexistentes ou que não aceitam e-mail. Vai além de regex.',
    input_schema: {
      type: 'object' as const,
      properties: {
        emails: { type: 'array', items: { type: 'object', properties: { id: {}, email: { type: 'string' } } } },
      },
      required: ['emails'],
    },
  },
  {
    name: 'check_url_reality',
    description: 'Faz HEAD request para verificar se uma URL responde. Detecta sites quebrados (404, timeout) ou domínios parqueados.',
    input_schema: {
      type: 'object' as const,
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'check_phone_reality',
    description: 'Normaliza telefone para E.164 e detecta tipo (móvel/fixo). Usa libphonenumber. Retorna formato canônico ou erro.',
    input_schema: {
      type: 'object' as const,
      properties: {
        phone: { type: 'string' },
        country: { type: 'string', description: 'ISO country code (default BR)', default: 'BR' },
      },
      required: ['phone'],
    },
  },
  {
    name: 'check_places_freshness',
    description: 'Compara um restaurante do banco com os dados atuais no Google Places. Detecta restaurantes FECHADOS PERMANENTEMENTE, mudanças de telefone/site/endereço.',
    input_schema: {
      type: 'object' as const,
      properties: {
        place_id: { type: 'string' },
        db_data: { type: 'object', description: 'Objeto com name, address, telephone, site_url do banco' },
      },
      required: ['place_id', 'db_data'],
    },
  },
  {
    name: 'check_geo_coords',
    description: 'Valida se coordenadas (lat, lng) ficam na cidade declarada via geocoding reverso. Detecta dados geográficos errados.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lat: { type: 'number' }, lng: { type: 'number' },
        expected_city: { type: 'string' },
      },
      required: ['lat', 'lng'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── OUTLIER / ANOMALY DETECTION ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'detect_outliers',
    description: 'Detecção estatística completa: outliers numéricos (z-score), datas suspeitas, placeholders (test/lorem/asdf), valores muito repetidos, coords fora do bounding box da cidade. Rode em qualquer tabela.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string' },
        limit: { type: 'number', default: 2000 },
      },
      required: ['table'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── SEMANTIC AI ANALYSIS ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'semantic_analysis',
    description: 'Análise semântica via LLM secundário (Claude Haiku). Detecta incoerências que regras não pegam: descrição não bate com cuisine, endereço residencial, idioma errado, categoria inconsistente. Use para auditorias de qualidade premium.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string' },
        limit: { type: 'number', default: 30 },
        focus: { type: 'array', items: { type: 'string' }, description: 'Campos específicos para focar' },
      },
      required: ['table'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── AUTO-FIX SUGGESTIONS ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'auto_fix_suggestions',
    description: 'Gera sugestões automáticas de correção: URLs sem protocolo, telefones para E.164, slugs regenerados, typos de domínio de e-mail (gmial→gmail), whitespace. Retorna lista com confidence score. NÃO aplica — só sugere.',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', default: 'public.db_restaurants' },
        limit: { type: 'number', default: 500 },
        country: { type: 'string', default: 'BR' },
      },
      required: ['table'],
    },
  },
  {
    name: 'apply_auto_fixes',
    description: 'Aplica correções sugeridas por auto_fix_suggestions. Use min_confidence para filtrar (recomendado: high). Cada fix é logado em agent_audit_log.',
    input_schema: {
      type: 'object' as const,
      properties: {
        suggestions: { type: 'array', items: { type: 'object' } },
        min_confidence: { type: 'string', enum: ['high','medium','low'], default: 'high' },
      },
      required: ['suggestions'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── MONITORING ─────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'save_quality_snapshot',
    description: 'Salva snapshot do quality score atual de uma tabela em public.quality_snapshots. Permite acompanhar evolução no tempo.',
    input_schema: {
      type: 'object' as const,
      properties: { table: { type: 'string' } },
      required: ['table'],
    },
  },
  {
    name: 'analyze_quality_trend',
    description: 'Compara último snapshot com o anterior. Detecta se a qualidade está melhorando ou regredindo. Retorna delta de score, critical, completeness.',
    input_schema: {
      type: 'object' as const,
      properties: { table: { type: 'string' } },
      required: ['table'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── CRM / BUSINESS INTELLIGENCE ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'crm_overview',
    description: 'Visão executiva do catálogo: total de restaurantes, publicados, parceiros, cobertura de contato (email/telefone/site/geo), distribuição por status operacional e por país, e total de reservas com breakdown por booking_status. Use para responder "como está o banco/negócio".',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'restaurant_360',
    description: 'Ficha 360° de um restaurante por restaurant_id: registro completo de db_restaurants + dados relacionais (horários em opening_hours, categorias via restaurant_category_map, tipos via establishment_type_map, prêmios em restaurant_awards, contagem de reservas).',
    input_schema: {
      type: 'object' as const,
      properties: { restaurant_id: { type: 'string' } },
      required: ['restaurant_id'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── EMAIL DISCOVERY & AUTONOMOUS ENRICHMENT ────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'find_restaurant_email',
    description: 'Descobre o e-mail oficial de reserva de UM restaurante: tenta site_url do banco → website do Google Places → busca web pelo site oficial, e extrai e-mails (mailto + texto) com score por domínio oficial e local-part (reservations/contact). READ-ONLY (não grava). Retorna best + candidates com score.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' }, city: { type: 'string' },
        site_url: { type: 'string' }, place_id: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'enrich_missing_emails',
    description: 'Pipeline AUTÔNOMO de e-mails: encontra restaurantes PUBLICADOS com email_for_reservations vazio (opcionalmente filtra por country/city), descobre o e-mail oficial de cada um via find_restaurant_email em lote, e — se apply=true — GRAVA apenas e-mails de DOMÍNIO OFICIAL e alta confiança (score>=80, rejeita imprensa/genéricos), logando cada escrita em agent_audit_log. Com apply=false (padrão) só retorna sugestões para revisão. Use limit pequeno (10-25) e mostre o resumo antes de aplicar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        country: { type: 'string' }, city: { type: 'string' },
        limit: { type: 'number', description: 'Máx restaurantes (default 25, teto 100)' },
        apply: { type: 'boolean', description: 'Se true, grava os e-mails oficiais de alta confiança' },
      },
    },
  },
  {
    name: 'database_health',
    description: 'Relatório de saúde consolidado do db_restaurants em UMA chamada: total/publicados, lacunas-chave (publicados sem email/geo, coordinates vs lat/long, country_id/city_id não vinculados), duplicatas (place_id, slug, e-mail compartilhado), distribuição de operational_status, e publicados incompletos por país. Use no início de qualquer trabalho de qualidade.',
    input_schema: { type: 'object' as const, properties: {} },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── SEO / ORGANIC SEARCH ───────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'seo_audit',
    description: 'Auditoria de SEO/busca orgânica do catálogo: descrições únicas vs duplicadas, cobertura de conteúdo PT/EN/FR (hreflang), imagem de capa (hero/og:image), geo/telefone/horários que alimentam o schema, e páginas mortas. Retorna nota 0-100 + checks ponderados + observações. Use para "como está o SEO/busca orgânica".',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'generate_structured_data',
    description: 'Gera um JSON-LD schema.org Restaurant COMPLETO de um restaurante (address, geo, telephone, openingHoursSpecification, servesCuisine, priceRange, award, image, acceptsReservations) a partir do dado já existente — habilita rich results no Google (o site hoje emite um schema magro). READ-ONLY por padrão; com apply=true grava em db_restaurants.structured_data_json (cria a coluna se faltar) para o frontend renderizar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string' },
        apply: { type: 'boolean', description: 'Se true, persiste em structured_data_json' },
      },
      required: ['restaurant_id'],
    },
  },
  {
    name: 'translate_description',
    description: 'Gera traduções editoriais de luxo do about_text para PT/EN/FR (about_pt/about_en/about_fr) via modelo escritor — destrava conteúdo multilíngue + hreflang (hoje ~0%). READ-ONLY por padrão (retorna as traduções para revisão); com apply=true grava as colunas. Use langs para escolher idiomas (default pt,en,fr).',
    input_schema: {
      type: 'object' as const,
      properties: {
        restaurant_id: { type: 'string' },
        langs: { type: 'array', items: { type: 'string' }, description: 'Idiomas: pt|en|fr (default todos)' },
        apply: { type: 'boolean' },
      },
      required: ['restaurant_id'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── OBSERVABILITY / MONITORING ─────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'capture_health_snapshot',
    description: 'Tira e PERSISTE um snapshot de saúde do catálogo (nota SEO, publicados, cobertura de capa, descrições únicas, structured data) em quality_snapshots. Use para registrar o estado atual e alimentar a evolução no tempo. Barato (só agregações).',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'health_trend',
    description: 'Retorna a evolução dos snapshots de saúde (nota SEO e cobertura de capa ao longo do tempo). Use para "a qualidade está melhorando ou piorando?".',
    input_schema: {
      type: 'object' as const,
      properties: { days: { type: 'number', description: 'Janela em dias (default 90)' } },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── REVERSIBILIDADE (UNDO) ─────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'list_recent_mutations',
    description: 'Lista os últimos eventos do log de auditoria (agent_audit_log): id, tabela, operação, record_id, old_data/new_data. Use para localizar o event_id de uma mutação a reverter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Máx eventos (default 20)' },
        table: { type: 'string', description: 'Filtrar por tabela' },
        record_id: { type: 'string', description: 'Filtrar por record_id' },
      },
    },
  },
  {
    name: 'revert_operation',
    description: 'UNDO: reverte um UPDATE registrado no log de auditoria, restaurando os valores de old_data do evento. Só funciona para eventos UPDATE com old_data e record_id. A reversão também é auditada.',
    input_schema: {
      type: 'object' as const,
      properties: {
        event_id: { type: 'number', description: 'id do evento em agent_audit_log' },
        reason: { type: 'string', description: 'Motivo da reversão' },
      },
      required: ['event_id'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ── DBA PROFUNDO (performance / saúde do Postgres) ─────────────────────
  // ═══════════════════════════════════════════════════════════════════════
  {
    name: 'slow_queries',
    description: 'Top queries mais lentas via pg_stat_statements (se a extensão estiver ativa): calls, tempo médio/total, linhas. Se indisponível, retorna instrução de ativação.',
    input_schema: {
      type: 'object' as const,
      properties: { limit: { type: 'number', description: 'default 15' } },
    },
  },
  {
    name: 'explain_plan',
    description: 'EXPLAIN (FORMAT JSON) de um SELECT — plano de execução, custo estimado, índices usados. Não executa a query (sem ANALYZE). Use para diagnosticar lentidão e validar índices.',
    input_schema: {
      type: 'object' as const,
      properties: { sql: { type: 'string', description: 'SELECT a analisar' } },
      required: ['sql'],
    },
  },
  {
    name: 'index_advisor',
    description: 'Heurística de índices: tabelas com muitos seq_scans vs index_scans, colunas FK sem índice, índices nunca usados (candidatos a remoção). Base para recomendações de performance.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'table_stats',
    description: 'Estatísticas físicas por tabela: tamanho total, linhas vivas/mortas (bloat), último vacuum/analyze. Ordenado por tamanho.',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'connection_stats',
    description: 'Conexões do Postgres: ativas/idle/idle-in-transaction, max_connections, queries em espera. Detecta saturação de pool.',
    input_schema: { type: 'object' as const, properties: {} },
  },
];

// ── Tool executor ───────────────────────────────────────────────────────────

async function executeToolInternal(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'execute_query': {
      const result = await queryReadOnly(input.sql as string, {
        params: input.params as unknown[] | undefined,
        timeoutMs: 15000,
        maxRows: 500,
      });
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        returned: result.returned,
        truncated: result.truncated,
        ...(result.truncated ? { note: `Resultado truncado para ${result.returned} de ${result.rowCount} linhas. Refine com WHERE/LIMIT/agregação.` } : {}),
      };
    }

    case 'execute_mutation': {
      // Todas as camadas de segurança vivem em queryWrite: statement único, operação
      // declarada == real, DDL bloqueado, WHERE obrigatório, rollback por blast-radius.
      const result = await queryWrite(input.sql as string, {
        params: input.params as unknown[] | undefined,
        operation: input.operation as string,
        maxAffectedRows: (input.max_affected_rows as number) ?? undefined,
        allowFullTable: (input.allow_full_table as boolean) ?? false,
      });
      await logUpdateEvent({
        table_name: input.table as string,
        operation: result.operation,
        new_data: { sql: input.sql, params: input.params, rows_affected: result.rowCount },
      });
      return { rowCount: result.rowCount, operation: result.operation };
    }

    case 'get_table_schema':
      return getTableSchema(input.table_name as string);

    case 'list_all_tables':
      return listTables();

    case 'get_row_count':
      return { count: await getRowCount(input.table_name as string) };

    case 'bulk_insert': {
      const rows = input.rows as Record<string, unknown>[];
      if (!rows.length) return { inserted: 0 };
      if (rows.length > 500) {
        throw new Error(`bulk_insert limitado a 500 linhas por chamada (recebeu ${rows.length}). Divida em lotes.`);
      }
      const table = safeIdent(input.table as string);
      const columns = Object.keys(rows[0]).map((c) => safeColumn(c));
      const rawCols = Object.keys(rows[0]);
      let inserted = 0;

      await withTransaction(async (client) => {
        for (const row of rows) {
          const values = rawCols.map((c) => row[c]);
          const placeholders = rawCols.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values
          );
          inserted++;
        }
      });
      await logUpdateEvent({
        table_name: input.table as string,
        operation: 'INSERT',
        new_data: { count: inserted },
      });
      return { inserted };
    }

    case 'search_restaurants':
      return searchRestaurantsByCity(
        input.city as string,
        (input.cuisine as string) ?? 'fine dining',
        (input.count as number) ?? 20
      );

    case 'get_place_details':
      return getPlaceDetails(input.place_id as string);

    case 'enrich_from_michelin':
      return enrichFromMichelinGuide(input.name as string, input.city as string);

    case 'generate_description': {
      const response = await createMessage({
        model: WRITER_MODEL,
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a 2-3 sentence luxury editorial description for a restaurant called "${input.name}" in ${input.city}${input.cuisine ? `, specialising in ${input.cuisine}` : ''}. ${input.details ?? ''} The tone should be elegant, evocative, and aspirational — matching a premium fine-dining discovery platform. Write in English.`,
        }],
      });
      const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
      return { description: textBlock?.text ?? '' };
    }

    case 'find_social_media':
      return findSocialMedia(input.name as string, input.city as string);

    case 'web_search':
      return webSearch(input.query as string, (input.count as number) ?? 5);

    case 'fetch_url':
      return fetchUrl(input.url as string);

    // ── Data Quality ──────────────────────────────────────────────────────
    case 'audit_table': {
      const limit = (input.limit as number) ?? 2000;
      const rows = await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT $1`, [limit]);
      const idCol = rows.rows[0] && 'restaurant_id' in rows.rows[0] ? 'restaurant_id' : 'id';
      return auditRows(rows.rows, input.table as string, idCol, input.columns as string[] | undefined);
    }

    case 'validate_column': {
      const limit = (input.limit as number) ?? 1000;
      const rows = await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT $1`, [limit]);
      const col = input.column as string;
      const issues = rows.rows
        .map((row) => validateValue(col, row[col], row.id ?? row[Object.keys(row)[0]]))
        .filter(Boolean);
      return {
        column: col, total: rows.rows.length,
        valid: rows.rows.length - issues.length, invalid: issues.length,
        validity_rate: Math.round(((rows.rows.length - issues.length) / (rows.rows.length || 1)) * 100),
        issues: issues.slice(0, 200),
      };
    }

    case 'find_duplicates': {
      const rows = await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT 3000`);
      return findDuplicateGroups(
        rows.rows,
        (input.id_column as string) ?? 'id',
        (input.name_column as string) ?? 'name',
        (input.threshold as number) ?? 0.85
      );
    }

    case 'completeness_report': {
      const limit = (input.limit as number) ?? 500;
      const rows = await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT $1`, [limit]);
      const scored = rows.rows.map((row) => ({
        id:    row.id ?? row[Object.keys(row)[0]],
        name:  String(row.name ?? row.title ?? row.id ?? ''),
        score: scoreRowCompleteness(row),
      })).sort((a, b) => a.score - b.score);
      const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : 0;
      return { total: scored.length, avg_completeness: avg, worst: scored.slice(0, 30), best: scored.slice(-10).reverse() };
    }

    case 'consistency_check': {
      // db_restaurants PK is restaurant_id; images live in images_json (jsonb), not `photos`.
      const checks = await Promise.allSettled([
        query(`SELECT COUNT(*) as n FROM public.db_restaurants r WHERE published AND NOT EXISTS (SELECT 1 FROM public.opening_hours o WHERE o.restaurant_id = r.restaurant_id)`),
        query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE published AND images_json IS NULL`),
        query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE published AND (latitude IS NULL OR longitude IS NULL OR (latitude = 0 AND longitude = 0))`),
        query(`SELECT COUNT(*) as n FROM public.reservations r WHERE r.restaurant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.db_restaurants d WHERE d.restaurant_id = r.restaurant_id)`),
        query(`SELECT COUNT(*) as n FROM (SELECT slug FROM public.db_restaurants WHERE slug IS NOT NULL GROUP BY slug HAVING COUNT(*) > 1) t`),
        query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE published AND (email_for_reservations IS NULL OR email_for_reservations = '')`),
        query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE published AND operational_status IN ('closed_permanently','temporarily_closed')`),
        query(`SELECT COUNT(*) as n FROM public.db_restaurants WHERE country_id IS NULL AND country IS NOT NULL AND country <> ''`),
        query(`SELECT COUNT(*) as n FROM (SELECT place_id FROM public.db_restaurants WHERE place_id IS NOT NULL AND place_id <> '' GROUP BY place_id HAVING COUNT(*) > 1) t`),
      ]);
      const labels = [
        'Publicados sem horários', 'Publicados sem fotos', 'Publicados com coords inválidas',
        'Reservas órfãs', 'Slugs duplicados', 'Publicados sem email',
        'Publicados fechados/temporários', 'country_id não vinculado', 'place_id duplicado',
      ];
      return checks.map((c, i) => ({
        check: labels[i],
        count: c.status === 'fulfilled' ? parseInt(String(c.value.rows[0]?.n ?? '0'), 10) : -1,
        error: c.status === 'rejected' ? String(c.reason) : null,
      }));
    }

    case 'fix_data_issue': {
      const table = safeIdent(input.table as string);
      const column = safeColumn(input.column as string);
      const idCol = safeColumn((input.id_column as string) ?? 'id');
      const before = await query(`SELECT ${column} FROM ${table} WHERE ${idCol} = $1`, [input.id_value]);
      const old_value = before.rows[0]?.[input.column as string];
      await query(`UPDATE ${table} SET ${column} = $1 WHERE ${idCol} = $2`, [input.new_value, input.id_value]);
      await logUpdateEvent({
        table_name: input.table as string, operation: 'UPDATE',
        record_id: String(input.id_value),
        old_data: { [input.column as string]: old_value },
        new_data: { [input.column as string]: input.new_value, reason: input.reason },
      });
      return { ok: true, old_value, new_value: input.new_value, reason: input.reason };
    }

    case 'batch_fix': {
      const fixes = input.fixes as Array<Record<string, unknown>>;
      // Atômico: ou todas as correções entram, ou nenhuma. old_data é capturado por
      // linha ANTES do UPDATE, dentro da mesma transação, para permitir revert.
      const events: Parameters<typeof logUpdateEvent>[0][] = [];
      await withTransaction(async (client) => {
        for (const fix of fixes) {
          const table = safeIdent(fix.table as string);
          const column = safeColumn(fix.column as string);
          const idCol = safeColumn((fix.id_column as string) ?? 'id');
          const before = await client.query(`SELECT ${column} FROM ${table} WHERE ${idCol} = $1`, [fix.id_value]);
          const old_value = before.rows[0]?.[fix.column as string];
          await client.query(`UPDATE ${table} SET ${column} = $1 WHERE ${idCol} = $2`, [fix.new_value, fix.id_value]);
          events.push({
            table_name: fix.table as string, operation: 'UPDATE',
            record_id: String(fix.id_value),
            old_data: { [fix.column as string]: old_value },
            new_data: { [fix.column as string]: fix.new_value, reason: fix.reason },
          });
        }
      });
      for (const ev of events) await logUpdateEvent(ev);
      return { applied: events.length, errors: [], total: fixes.length, atomic: true };
    }

    // ── Reality Check ───────────────────────────────────────────────────────
    case 'check_emails_reality': {
      const emails = input.emails as { id: unknown; email: string }[];
      return batchCheckEmails(emails, 8);
    }

    case 'check_url_reality':
      return batchCheckUrls([{ id: 'single', url: input.url as string }], 1).then((r) => r[0]);

    case 'check_phone_reality':
      return checkPhoneReality(input.phone as string, (input.country as 'BR') ?? 'BR');

    case 'check_places_freshness':
      return checkPlacesFreshness(input.place_id as string, input.db_data as Parameters<typeof checkPlacesFreshness>[1]);

    case 'check_geo_coords':
      return validateGeoCoords(input.lat as number, input.lng as number, input.expected_city as string | undefined);

    // ── Outliers ───────────────────────────────────────────────────────────
    case 'detect_outliers': {
      const limit = (input.limit as number) ?? 2000;
      const rows = (await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT $1`, [limit])).rows;
      const idCol = rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id';
      return {
        numeric_outliers: [
          ...detectNumericOutliers(rows, 'commission_per_person', idCol),
          ...detectNumericOutliers(rows, 'total_reservation', idCol),
        ],
        date_anomalies: [
          ...detectDateAnomalies(rows, 'created_date', idCol),
          ...detectDateAnomalies(rows, 'partnership_start_date', idCol),
        ],
        placeholders: [
          ...detectPlaceholders(rows, 'name', idCol),
          ...detectPlaceholders(rows, 'about_text', idCol),
        ],
        over_repetitions: [
          ...detectOverRepetition(rows, 'telephone_of_the_establishment', idCol, 5),
          ...detectOverRepetition(rows, 'email_for_reservations', idCol, 5),
        ],
        geofence_violations: detectGeofenceViolations(rows, 'latitude', 'longitude', 'city', idCol),
      };
    }

    // ── Semantic AI ────────────────────────────────────────────────────────
    case 'semantic_analysis': {
      const limit = (input.limit as number) ?? 30;
      const rows = (await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT $1`, [limit])).rows;
      return batchSemanticAnalysis(rows, {
        tableName: input.table as string,
        batchSize: 10, concurrency: 3,
        focus: input.focus as string[] | undefined,
      });
    }

    // ── Auto-fix ───────────────────────────────────────────────────────────
    case 'auto_fix_suggestions': {
      const limit = (input.limit as number) ?? 500;
      const rows = (await query(`SELECT * FROM ${safeIdent((input.table as string) ?? 'public.db_restaurants')} LIMIT $1`, [limit])).rows;
      const idCol = rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id';
      const suggestions = generateAutoFixSuggestions(rows, {
        table: (input.table as string) ?? 'public.db_restaurants',
        idCol, countryCode: ((input.country as string) ?? 'BR') as 'BR',
      });
      return {
        total: suggestions.length,
        by_confidence: {
          high:   suggestions.filter((s) => s.confidence === 'high').length,
          medium: suggestions.filter((s) => s.confidence === 'medium').length,
          low:    suggestions.filter((s) => s.confidence === 'low').length,
        },
        suggestions: suggestions.slice(0, 200),
      };
    }

    case 'apply_auto_fixes': {
      const suggestions = input.suggestions as Array<Record<string, unknown>>;
      const minConf = (input.min_confidence as string) ?? 'high';
      const order: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const eligible = suggestions.filter((s) => order[s.confidence as string] >= order[minConf]);
      // Atômico + old_data por linha (revert possível via revert_operation).
      const events: Parameters<typeof logUpdateEvent>[0][] = [];
      await withTransaction(async (client) => {
        for (const fix of eligible) {
          const tableRaw = (fix.table as string) ?? 'public.db_restaurants';
          const table = safeIdent(tableRaw);
          const column = safeColumn(fix.column as string);
          const idCol = safeColumn((fix.id_column as string) ?? 'restaurant_id');
          const before = await client.query(`SELECT ${column} FROM ${table} WHERE ${idCol} = $1`, [fix.row_id]);
          const old_value = before.rows[0]?.[fix.column as string];
          await client.query(`UPDATE ${table} SET ${column} = $1 WHERE ${idCol} = $2`, [fix.new_value, fix.row_id]);
          events.push({
            table_name: tableRaw, operation: 'UPDATE',
            record_id: String(fix.row_id),
            old_data: { [fix.column as string]: old_value },
            new_data: { [fix.column as string]: fix.new_value, reason: fix.reason, rule: fix.rule },
          });
        }
      });
      for (const ev of events) await logUpdateEvent(ev);
      return { applied: events.length, errors: [], total: eligible.length, skipped: suggestions.length - eligible.length, atomic: true };
    }

    // ── Monitoring ─────────────────────────────────────────────────────────
    case 'save_quality_snapshot': {
      const rows = (await query(`SELECT * FROM ${safeIdent(input.table as string)} LIMIT 2000`)).rows;
      const idCol = rows[0] && 'restaurant_id' in rows[0] ? 'restaurant_id' : 'id';
      const report = auditRows(rows, input.table as string, idCol);
      const scored = rows.map((r) => scoreRowCompleteness(r));
      const avg = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
      const id = await saveSnapshot({
        table_name: input.table as string,
        quality_score: report.quality_score, total_rows: report.total_rows,
        critical_count: report.critical_count, warning_count: report.warning_count,
        info_count: report.info_count, duplicates: report.duplicate_groups.length,
        avg_completeness: avg,
      });
      return { id, quality_score: report.quality_score, avg_completeness: avg };
    }

    case 'analyze_quality_trend':
      return analyzeTrend(input.table as string);

    // ── CRM / BI ───────────────────────────────────────────────────────────
    case 'crm_overview': {
      const kpis = (await query(`
        SELECT COUNT(*)::int total,
          COUNT(*) FILTER (WHERE published)::int published,
          COUNT(*) FILTER (WHERE partner)::int partners,
          COUNT(*) FILTER (WHERE email_for_reservations IS NOT NULL AND email_for_reservations <> '')::int with_email,
          COUNT(*) FILTER (WHERE telephone_of_the_establishment IS NOT NULL AND telephone_of_the_establishment <> '')::int with_phone,
          COUNT(*) FILTER (WHERE site_url IS NOT NULL AND site_url <> '')::int with_site,
          COUNT(*) FILTER (WHERE latitude IS NOT NULL)::int with_geo,
          COUNT(DISTINCT country)::int countries, COUNT(DISTINCT city)::int cities
        FROM public.db_restaurants`)).rows[0];
      const byStatus = (await query(`SELECT operational_status status, COUNT(*)::int n FROM public.db_restaurants GROUP BY 1 ORDER BY n DESC`)).rows;
      const byCountry = (await query(`SELECT country, COUNT(*)::int n, COUNT(*) FILTER (WHERE published)::int published FROM public.db_restaurants WHERE country <> '' GROUP BY 1 ORDER BY n DESC LIMIT 15`)).rows;
      let reservations: Record<string, unknown> = { total: 0 };
      try {
        const t = (await query(`SELECT COUNT(*)::int n FROM public.reservations`)).rows[0].n;
        const bs = (await query(`SELECT booking_status, COUNT(*)::int n FROM public.reservations GROUP BY 1 ORDER BY n DESC`)).rows;
        reservations = { total: t, by_status: bs };
      } catch { /* optional */ }
      return { kpis, by_status: byStatus, by_country: byCountry, reservations };
    }

    case 'restaurant_360': {
      const rid = input.restaurant_id as string;
      const record = (await query(`SELECT * FROM public.db_restaurants WHERE restaurant_id = $1`, [rid])).rows[0];
      if (!record) return { error: 'Restaurant not found', restaurant_id: rid };
      const related: Record<string, unknown> = {};
      const safe = async (k: string, sql: string) => { try { related[k] = (await query(sql, [rid])).rows; } catch { related[k] = []; } };
      await Promise.all([
        safe('hours', `SELECT weekday, open_time, close_time FROM public.opening_hours WHERE restaurant_id = $1 ORDER BY weekday`),
        safe('categories', `SELECT c.name FROM public.restaurant_category_map m JOIN public.restaurant_categories c ON c.id = m.category_id WHERE m.restaurant_id = $1`),
        safe('types', `SELECT t.name FROM public.establishment_type_map m JOIN public.establishment_types t ON t.id = m.type_id WHERE m.restaurant_id = $1`),
        safe('awards', `SELECT * FROM public.restaurant_awards WHERE restaurant_id = $1 LIMIT 20`),
      ]);
      try { related.reservations_count = (await query(`SELECT COUNT(*)::int n FROM public.reservations WHERE restaurant_id = $1`, [rid])).rows[0].n; } catch { related.reservations_count = 0; }
      return { record, related };
    }

    // ── Email discovery & autonomous enrichment ──────────────────────────────
    case 'find_restaurant_email':
      return findRestaurantEmail({
        name: input.name as string,
        city: input.city as string | undefined,
        site_url: input.site_url as string | undefined,
        place_id: input.place_id as string | undefined,
      });

    case 'enrich_missing_emails': {
      const limit = Math.min((input.limit as number) ?? 25, 100);
      const apply = (input.apply as boolean) ?? false;
      const clauses = [`published = true`, `(email_for_reservations IS NULL OR email_for_reservations = '')`, `site_url IS NOT NULL AND site_url <> ''`];
      const params: unknown[] = [];
      if (input.country) { params.push(input.country); clauses.push(`lower(country) = lower($${params.length})`); }
      if (input.city) { params.push(input.city); clauses.push(`lower(city) = lower($${params.length})`); }
      params.push(limit);
      const rows = (await query(
        `SELECT restaurant_id, name, city, site_url, place_id FROM public.db_restaurants WHERE ${clauses.join(' AND ')} ORDER BY name LIMIT $${params.length}`,
        params
      )).rows;

      const results = await batchFindEmails(
        rows.map((r) => ({ id: r.restaurant_id, name: r.name as string, city: r.city as string | undefined, site_url: r.site_url as string | undefined, place_id: r.place_id as string | undefined })),
        4
      );

      const DEPT = /^(press|presse|prensa|media|jobs?|career|careers|recruit|marketing|hr|rh|newsletter|sales|invoice|billing|accounts?|webmaster|no-?reply|unsubscribe|donotreply)/i;
      const suggestions: Record<string, unknown>[] = [];
      let applied = 0;
      for (const res of results) {
        const best = res.best;
        const acceptable = !!best && best.domain_match && best.score >= 80 && !DEPT.test(best.email.split('@')[0]);
        suggestions.push({
          restaurant_id: res.id, name: res.restaurant_name, email: best?.email ?? null,
          score: best?.score ?? null, domain_match: best?.domain_match ?? false,
          acceptable, source_url: best?.source_url ?? null, reason: res.reason,
        });
        if (apply && acceptable && best) {
          const note = JSON.stringify([{ field: 'email_for_reservations', action: 'agent_enriched', source: best.source_url, score: best.score, at: new Date().toISOString() }]);
          await query(
            `UPDATE public.db_restaurants SET email_for_reservations=$1, verification_source=$2, confidence_level='HIGH', last_verified_at=now(), enrichment_log = COALESCE(enrichment_log,'[]'::jsonb) || $3::jsonb WHERE restaurant_id=$4 AND (email_for_reservations IS NULL OR email_for_reservations='')`,
            [best.email, best.source_url, note, res.id]
          );
          await logUpdateEvent({ table_name: 'public.db_restaurants', operation: 'UPDATE', record_id: String(res.id), new_data: { email_for_reservations: best.email, via: 'agent enrich_missing_emails' } });
          applied++;
        }
      }
      return {
        scanned: rows.length,
        with_candidate: suggestions.filter((s) => s.email).length,
        acceptable: suggestions.filter((s) => s.acceptable).length,
        applied, apply,
        suggestions: suggestions.slice(0, 50),
      };
    }

    case 'database_health': {
      const t = 'public.db_restaurants';
      const main = (await query(`SELECT
          COUNT(*)::int total, COUNT(*) FILTER (WHERE published)::int published,
          COUNT(*) FILTER (WHERE published AND (email_for_reservations IS NULL OR email_for_reservations=''))::int pub_no_email,
          COUNT(*) FILTER (WHERE published AND latitude IS NULL)::int pub_no_geo,
          COUNT(*) FILTER (WHERE coordinates IS NULL AND latitude IS NOT NULL)::int coords_gap,
          COUNT(*) FILTER (WHERE country_id IS NULL AND country IS NOT NULL AND country<>'')::int no_country_id,
          COUNT(*) FILTER (WHERE city_id IS NULL AND city IS NOT NULL AND city<>'')::int no_city_id
        FROM ${t}`)).rows[0];
      const dupPlace = (await query(`SELECT COUNT(*)::int c FROM (SELECT place_id FROM ${t} WHERE place_id IS NOT NULL AND place_id<>'' GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0].c;
      const dupSlug = (await query(`SELECT COUNT(*)::int c FROM (SELECT slug FROM ${t} WHERE slug IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0].c;
      const sharedEmail = (await query(`SELECT COUNT(*)::int c FROM (SELECT lower(email_for_reservations) e FROM ${t} WHERE email_for_reservations IS NOT NULL AND email_for_reservations<>'' GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0].c;
      const opstat = (await query(`SELECT operational_status s, COUNT(*)::int n FROM ${t} GROUP BY 1 ORDER BY n DESC`)).rows;
      const incPub = (await query(`SELECT country, COUNT(*)::int n FROM ${t} WHERE published AND (email_for_reservations IS NULL OR email_for_reservations='' OR telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='' OR site_url IS NULL OR site_url='' OR latitude IS NULL) GROUP BY 1 ORDER BY n DESC LIMIT 10`)).rows;
      return { ...main, duplicates: { place_id: dupPlace, slug: dupSlug, shared_email: sharedEmail }, operational_status: opstat, published_incomplete_by_country: incPub };
    }

    // ── SEO ──────────────────────────────────────────────────────────────────
    case 'seo_audit':
      return seoAudit();

    case 'generate_structured_data': {
      const schema = await buildRestaurantSchema(input.restaurant_id as string);
      if (!schema) return { error: 'Restaurante não encontrado', restaurant_id: input.restaurant_id };
      if (input.apply) {
        await query(`ALTER TABLE public.db_restaurants ADD COLUMN IF NOT EXISTS structured_data_json jsonb`);
        await query(`UPDATE public.db_restaurants SET structured_data_json = $1::jsonb WHERE restaurant_id = $2`, [JSON.stringify(schema), input.restaurant_id]);
        await logUpdateEvent({ table_name: 'public.db_restaurants', operation: 'UPDATE', record_id: String(input.restaurant_id), new_data: { structured_data_json: 'schema.org Restaurant' } });
      }
      return { schema, applied: !!input.apply };
    }

    case 'translate_description': {
      const row = (await query<{ name: string; city: string; about_text: string }>(
        `SELECT name, city, about_text FROM public.db_restaurants WHERE restaurant_id = $1`, [input.restaurant_id as string]
      )).rows[0];
      if (!row) return { error: 'Restaurante não encontrado' };
      if (!row.about_text) return { error: 'Sem about_text para traduzir' };
      const want = ((input.langs as string[]) ?? ['pt', 'en', 'fr']).filter((l) => ['pt', 'en', 'fr'].includes(l));
      const LN: Record<string, string> = { pt: 'português do Brasil', en: 'English', fr: 'français' };
      const out: Record<string, string> = {};
      for (const lang of want) {
        const resp = await createMessage({
          model: WRITER_MODEL, max_tokens: 400,
          messages: [{ role: 'user', content: `Traduza/adapte para ${LN[lang]} esta descrição de restaurante de alto padrão, mantendo o tom elegante e evocativo e SEM inventar fatos. Responda apenas o texto final, sem aspas.\n\n"${row.about_text}"` }],
        });
        const tb = resp.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
        out[lang] = tb?.text?.trim() ?? '';
      }
      if (input.apply) {
        const langs = Object.keys(out);
        const sets = langs.map((l, i) => `about_${l} = $${i + 1}`).join(', ');
        await query(`UPDATE public.db_restaurants SET ${sets} WHERE restaurant_id = $${langs.length + 1}`, [...langs.map((l) => out[l]), input.restaurant_id]);
        await logUpdateEvent({ table_name: 'public.db_restaurants', operation: 'UPDATE', record_id: String(input.restaurant_id), new_data: { translated: langs } });
      }
      return { translations: out, applied: !!input.apply };
    }

    // ── Observability ─────────────────────────────────────────────────────────
    case 'capture_health_snapshot':
      return captureSnapshot();

    case 'health_trend': {
      const trend = await getHealthTrend((input.days as number) ?? 90);
      const first = trend[0], last = trend[trend.length - 1];
      return {
        points: trend.length,
        trend,
        delta_score: first && last ? last.seo_score - first.seo_score : 0,
        latest: last ?? null,
      };
    }

    // ── Reversibilidade (undo) ────────────────────────────────────────────
    case 'list_recent_mutations': {
      const limit = Math.min((input.limit as number) ?? 20, 100);
      const clauses: string[] = []; const params: unknown[] = [];
      if (input.table) { params.push(input.table); clauses.push(`table_name = $${params.length}`); }
      if (input.record_id) { params.push(String(input.record_id)); clauses.push(`record_id = $${params.length}`); }
      params.push(limit);
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = (await query(
        `SELECT id, table_name, operation, record_id, old_data, new_data, agent, created_at
         FROM public.agent_audit_log ${where} ORDER BY id DESC LIMIT $${params.length}`, params
      )).rows;
      return { events: rows, note: 'Use revert_operation com o id para desfazer um UPDATE com old_data.' };
    }

    case 'revert_operation': {
      const eventId = input.event_id as number;
      const ev = (await query(
        `SELECT id, table_name, operation, record_id, old_data FROM public.agent_audit_log WHERE id = $1`, [eventId]
      )).rows[0] as { id: number; table_name: string; operation: string; record_id: string | null; old_data: Record<string, unknown> | null } | undefined;
      if (!ev) return { error: `Evento ${eventId} não encontrado no log de auditoria.` };
      if (ev.operation !== 'UPDATE') return { error: `Só UPDATEs são reversíveis automaticamente (evento é ${ev.operation}).` };
      if (!ev.old_data || !ev.record_id) return { error: 'Evento sem old_data/record_id — reversão automática indisponível.' };

      // Restaura apenas colunas reais (ignora metadados como reason/rule/via).
      const META = new Set(['reason', 'rule', 'via', 'sql', 'params', 'rows_affected', 'translated']);
      const schema = await getTableSchema(ev.table_name);
      const validCols = new Set(schema.map((c) => c.column_name));
      const entries = Object.entries(ev.old_data).filter(([k]) => !META.has(k) && validCols.has(k));
      if (!entries.length) return { error: 'old_data não contém colunas restauráveis.' };

      const table = safeIdent(ev.table_name);
      const idCol = validCols.has('restaurant_id') ? 'restaurant_id' : 'id';
      const sets = entries.map(([k], i) => `${safeColumn(k)} = $${i + 1}`).join(', ');
      const params = [...entries.map(([, v]) => v), ev.record_id];
      const res = await query(`UPDATE ${table} SET ${sets} WHERE ${safeColumn(idCol)} = $${entries.length + 1}`, params);
      await logUpdateEvent({
        table_name: ev.table_name, operation: 'UPDATE', record_id: ev.record_id,
        new_data: { reverted_event_id: ev.id, restored: Object.fromEntries(entries), reason: (input.reason as string) ?? `revert do evento #${ev.id}` },
      });
      return { ok: true, reverted_event_id: ev.id, restored_columns: entries.map(([k]) => k), rows_affected: res.rowCount };
    }

    // ── DBA profundo ──────────────────────────────────────────────────────
    case 'slow_queries': {
      const limit = Math.min((input.limit as number) ?? 15, 50);
      try {
        const rows = (await query(
          `SELECT left(query, 300) AS query, calls, round(total_exec_time::numeric, 1) AS total_ms,
                  round(mean_exec_time::numeric, 2) AS mean_ms, rows,
                  round((100 * shared_blks_hit / NULLIF(shared_blks_hit + shared_blks_read, 0))::numeric, 1) AS cache_hit_pct
           FROM pg_stat_statements
           WHERE query NOT ILIKE '%pg_stat_statements%'
           ORDER BY mean_exec_time DESC LIMIT $1`, [limit]
        )).rows;
        return { available: true, top: rows };
      } catch {
        return {
          available: false,
          hint: 'pg_stat_statements não está ativo. No Cloud SQL: flag shared_preload_libraries=pg_stat_statements + CREATE EXTENSION pg_stat_statements;',
        };
      }
    }

    case 'explain_plan': {
      const sql = String(input.sql).trim().replace(/;+\s*$/, '');
      if (!/^(select|with|table)\b/i.test(sql)) return { error: 'explain_plan aceita apenas SELECT/WITH/TABLE.' };
      const res = await queryReadOnly<{ 'QUERY PLAN': unknown }>(`EXPLAIN (FORMAT JSON, VERBOSE, COSTS) ${sql}`, { timeoutMs: 15000 });
      return { plan: res.rows[0]?.['QUERY PLAN'] ?? res.rows };
    }

    case 'index_advisor': {
      const [seqHeavy, unusedIdx, fkNoIdx] = await Promise.all([
        query(`SELECT relname AS table, seq_scan, idx_scan, n_live_tup,
                      pg_size_pretty(pg_total_relation_size(relid)) AS size
               FROM pg_stat_user_tables
               WHERE seq_scan > 100 AND seq_scan > COALESCE(idx_scan, 0) * 5 AND n_live_tup > 1000
               ORDER BY seq_scan DESC LIMIT 15`),
        query(`SELECT s.relname AS table, s.indexrelname AS index, pg_size_pretty(pg_relation_size(s.indexrelid)) AS size
               FROM pg_stat_user_indexes s JOIN pg_index i ON i.indexrelid = s.indexrelid
               WHERE s.idx_scan = 0 AND NOT i.indisunique AND NOT i.indisprimary
               ORDER BY pg_relation_size(s.indexrelid) DESC LIMIT 15`),
        query(`SELECT c.conrelid::regclass::text AS table, a.attname AS fk_column, c.confrelid::regclass::text AS references
               FROM pg_constraint c
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
               WHERE c.contype = 'f'
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_index i
                   WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey::int2[]) AND i.indkey[0] = a.attnum
                 )
               LIMIT 20`),
      ]);
      return {
        seq_scan_heavy: seqHeavy.rows,
        unused_indexes: unusedIdx.rows,
        fk_columns_without_index: fkNoIdx.rows,
        advice: 'seq_scan_heavy → candidatas a índice em colunas de WHERE frequentes; unused_indexes → candidatos a DROP (via migration); FKs sem índice → JOINs/cascades lentos.',
      };
    }

    case 'table_stats': {
      const rows = (await query(
        `SELECT relname AS table,
                pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
                n_live_tup AS live_rows, n_dead_tup AS dead_rows,
                CASE WHEN n_live_tup > 0 THEN round(100.0 * n_dead_tup / n_live_tup, 1) ELSE 0 END AS bloat_pct,
                last_vacuum, last_autovacuum, last_analyze, last_autoanalyze
         FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 30`
      )).rows;
      return { tables: rows };
    }

    case 'connection_stats': {
      const [byState, limits, waiting] = await Promise.all([
        query(`SELECT COALESCE(state, 'unknown') AS state, COUNT(*)::int AS n FROM pg_stat_activity GROUP BY 1 ORDER BY n DESC`),
        query(`SELECT setting::int AS max_connections FROM pg_settings WHERE name = 'max_connections'`),
        query(`SELECT COUNT(*)::int AS waiting FROM pg_stat_activity WHERE wait_event_type = 'Lock'`),
      ]);
      const total = byState.rows.reduce((s, r) => s + Number(r.n), 0);
      return {
        total, by_state: byState.rows,
        max_connections: limits.rows[0]?.max_connections ?? null,
        waiting_on_locks: waiting.rows[0]?.waiting ?? 0,
        utilization_pct: limits.rows[0]?.max_connections ? Math.round((100 * total) / Number(limits.rows[0].max_connections)) : null,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Runtime input validation for write-critical tools ────────────────────────
// zod guards the dangerous (mutating) surface so a malformed tool call returns a
// clean, model-readable error instead of crashing on an `as` cast mid-write.
const fixShape = {
  table: z.string().min(1),
  id_column: z.string().optional(),
  id_value: z.union([z.string(), z.number()]),
  column: z.string().min(1),
  new_value: z.unknown(),
  reason: z.string().optional(),
};
const WRITE_SCHEMAS: Record<string, z.ZodType> = {
  execute_mutation: z.object({
    sql: z.string().min(1),
    params: z.array(z.unknown()).optional(),
    table: z.string().min(1),
    operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
    max_affected_rows: z.number().int().positive().max(50000).optional(),
    allow_full_table: z.boolean().optional(),
  }),
  revert_operation: z.object({
    event_id: z.number().int().positive(),
    reason: z.string().optional(),
  }),
  bulk_insert: z.object({
    table: z.string().min(1),
    rows: z.array(z.record(z.unknown())).min(1),
  }),
  fix_data_issue: z.object({ ...fixShape, reason: z.string().min(1) }),
  batch_fix: z.object({ fixes: z.array(z.object(fixShape)).min(1) }),
  apply_auto_fixes: z.object({
    suggestions: z.array(z.record(z.unknown())),
    min_confidence: z.enum(['high', 'medium', 'low']).optional(),
  }),
  enrich_missing_emails: z.object({
    country: z.string().optional(),
    city: z.string().optional(),
    limit: z.number().optional(),
    apply: z.boolean().optional(),
  }),
};

// Per-tool wall-clock budget (ms) so one hung external call can't eat the request.
const TOOL_TIMEOUT_MS: Record<string, number> = {
  check_places_freshness: 25000,
  semantic_analysis: 60000,
  enrich_missing_emails: 90000,
  find_restaurant_email: 30000,
  search_restaurants: 25000,
  fetch_url: 20000,
  web_search: 20000,
  translate_description: 60000,
};
const DEFAULT_TOOL_TIMEOUT_MS = 30000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label} excedeu ${ms}ms`)), ms)),
  ]);
}

// Wrapper that validates input, enforces a timeout, and emits events to the Command Center bus.
export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const startTime = Date.now();
  bus.emit('tool.call.start', { tool: name, input: summariseInput(input) }, 'agent');
  try {
    const schema = WRITE_SCHEMAS[name];
    if (schema) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(`Input inválido para ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      }
    }
    const timeout = TOOL_TIMEOUT_MS[name] ?? DEFAULT_TOOL_TIMEOUT_MS;
    const result = await withTimeout(executeToolInternal(name, input), timeout, name);
    const duration = Date.now() - startTime;
    bus.emit('tool.call.end', {
      tool: name,
      input: summariseInput(input),
      result_summary: summariseResult(result),
    }, 'agent', duration);
    return result;
  } catch (err) {
    const duration = Date.now() - startTime;
    bus.emit('tool.call.error', { tool: name, error: String(err) }, 'agent', duration);
    throw err;
  }
}

function summariseInput(input: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') summary[k] = v.length > 80 ? v.slice(0, 80) + '…' : v;
    else if (Array.isArray(v)) summary[k] = `[${v.length} items]`;
    else if (typeof v === 'object' && v !== null) summary[k] = '{…}';
    else summary[k] = v;
  }
  return summary;
}

function summariseResult(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) return { type: 'array', length: result.length };
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of ['total','count','inserted','applied','quality_score','rowCount','rows']) {
      if (k in obj) out[k] = Array.isArray(obj[k]) ? `[${(obj[k] as unknown[]).length}]` : obj[k];
    }
    return Object.keys(out).length ? out : { type: 'object' };
  }
  return { type: typeof result };
}

// ── Agentic loop ────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Structured stream protocol consumed by the SSE route + AgentChat UI.
export type AgentStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_start'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; result: unknown; duration: number; isError: boolean }
  | { type: 'usage'; usage: UsageTotals }
  | { type: 'error'; error: string };

// Cap a tool result before it re-enters the model context, so a 2000-row audit
// can't blow the window (and cost). Keeps the JSON valid + tells the model it was cut.
const MAX_TOOL_RESULT_CHARS = 24000;
function capForModel(result: unknown): string {
  let json = JSON.stringify(result ?? null);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const arrKey = Object.keys(obj).find((k) => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 5);
    if (arrKey) {
      const arr = obj[arrKey] as unknown[];
      const trimmed = { ...obj, [arrKey]: arr.slice(0, 25), _truncated: { field: arrKey, shown: 25, total: arr.length } };
      json = JSON.stringify(trimmed);
      if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
    }
  }
  return JSON.stringify({ _truncated: true, preview: json.slice(0, MAX_TOOL_RESULT_CHARS), note: 'Resultado grande demais; refine a consulta ou use limit menor.' });
}

export async function* runAgentStream(
  messages: AgentMessage[],
  onToolCall?: (name: string, input: unknown, result: unknown) => void,
  signal?: AbortSignal
): AsyncGenerator<AgentStreamEvent> {
  const history: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const systemPrompt = `Você é o **TWK Data Intelligence Agent** — o melhor agente de qualidade de dados do mundo para restaurantes premium. Você gerencia o banco PostgreSQL da The World Keys (theworldkeys.com).

## Sua filosofia
Você não valida apenas FORMA — valida REALIDADE. Não basta o e-mail ter @, o domínio precisa existir. Não basta o telefone ter dígitos, ele precisa estar em E.164 e ser válido para o país. Não basta a coordenada estar no range, ela precisa ficar na cidade declarada. Não basta o restaurante existir no banco, ele precisa ainda estar OPERANDO no Google Places.

## Hierarquia de Inteligência (use nessa ordem)

### Nível 1 — Auditoria estrutural (rápido, sem custo externo)
- \`audit_table\` — Scan completo (formatos + nulls + duplicatas)
- \`validate_column\` — Foco numa coluna específica
- \`find_duplicates\` — Detecção fuzzy de duplicatas
- \`consistency_check\` — 9 checks cruzados entre tabelas
- \`completeness_report\` — Ranking dos piores registros
- \`detect_outliers\` — Análise estatística: z-score, datas, placeholders, geofencing

### Nível 2 — Reality Check (valida contra fontes externas)
- \`check_emails_reality\` — DNS MX lookup (e-mail aceita mensagens?)
- \`check_url_reality\` — HEAD request (site responde?)
- \`check_phone_reality\` — Normalização E.164 + tipo (libphonenumber)
- \`check_places_freshness\` — Banco vs Google Places (FECHADO PERMANENTEMENTE?)
- \`check_geo_coords\` — Geocoding reverso (coords batem com a cidade?)

### Nível 3 — Análise Semântica (Claude analisando coerência)
- \`semantic_analysis\` — Detecta incoerências entre campos via LLM

### Nível 4 — Auto-correção inteligente
- \`auto_fix_suggestions\` — Gera correções com confidence score (NÃO aplica)
- \`apply_auto_fixes\` — Aplica apenas as de alta confiança (recomendado: only 'high')
- \`fix_data_issue\` — Correção manual documentada de um campo
- \`batch_fix\` — Correções em lote manualmente especificadas

### Nível 5 — Monitoring contínuo
- \`save_quality_snapshot\` — Salva fotografia do quality score atual
- \`analyze_quality_trend\` — Compara últimos snapshots, detecta regressão

## Workflow recomendado para "auditar tudo"
1. \`audit_table\` na tabela principal (estrutural)
2. \`detect_outliers\` (anomalias estatísticas)
3. \`check_phones_reality\` + \`check_emails_reality\` (validação externa rápida)
4. \`check_urls_reality\` (mais lenta — só amostragem)
5. \`check_places_freshness\` (caro — top 20-50 mais importantes)
6. \`semantic_analysis\` (caro — amostra de 30)
7. \`auto_fix_suggestions\` → mostra ao usuário antes de aplicar
8. \`apply_auto_fixes\` apenas com confidence='high'
9. \`save_quality_snapshot\` no final para track de evolução

## Princípios invioláveis
- Sempre responda em Português (Brasil)
- Antes de QUALQUER correção em massa, mostre um resumo + peça confirmação
- Toda correção precisa ter \`reason\` documentado
- Use \`min_confidence: 'high'\` por padrão ao aplicar auto-fixes
- Toda mutation é logada em agent_audit_log automaticamente
- Após correções, rode \`save_quality_snapshot\` para evidenciar a melhoria
- Antes de fix em massa, salve um snapshot ANTES e DEPOIS

## Inteligência de negócio (CRM)
- \`crm_overview\` — KPIs executivos do catálogo (publicados, parceiros, cobertura de contato, status, países, reservas). Use para "como está o banco/negócio".
- \`restaurant_360\` — ficha completa de um restaurante + dados relacionais (horários, categorias, tipos, prêmios, reservas).

## SEO / busca orgânica
- \`seo_audit\` — nota 0-100 da saúde de SEO do catálogo (descrições únicas, cobertura PT/EN/FR, capa/og:image, geo/telefone/horários p/ schema, páginas mortas). Use para "como está o SEO".
- \`generate_structured_data\` — monta o JSON-LD schema.org Restaurant COMPLETO (o site emite um magro). apply=true grava em \`structured_data_json\` p/ o frontend renderizar → rich results.
- \`translate_description\` — gera \`about_pt/en/fr\` (multilíngue + hreflang é a maior lacuna orgânica). Mostre antes; apply=true grava.
- NOTA: a capa/hero e o og:image do site vêm de \`images_json.slider[0]\` (NÃO de \`cover\`). Garanta a melhor foto de ambiente em slider[0].

## Schema TWK (memorize — verificado)
\`public.db_restaurants\` — PK = \`restaurant_id\` (varchar, NÃO \`id\`). Colunas reais:
- Identidade: name, slug, place_id, country_code, timezone
- Local: city, country, address_of_establishment, latitude, longitude, coordinates (PostGIS, SRID 4326), country_id→countries(id,title), city_id→cities(id,title)
- Contato: telephone_of_the_establishment (E.164), email_for_reservations, site_url
- Conteúdo: about_text, about_pt/en/fr, business_hours_json, images_json (objeto {logo,cover,slider[]}), logo_url, chef_name
- Classificação: establishment_type (texto), restaurant_category (texto, formato \`[*Michelin|][$$$$|]cozinhas, Vegetarian friendly\`), price_range_id→restaurant_price_range(id 1-4)
- Comercial: published (bool), partner (bool), commission_per_person, partnership_start_date, negotiation_status (enum: Pending/Interested/Negotiation/Partner/Decline)
- Qualidade: operational_status ('active'/'closed_permanently'/'temporarily_closed'/'unknown'), confidence_level (HIGH/MEDIUM/LOW/CONFLICT), last_verified_at, verification_source, enrichment_log (jsonb array)

## Tabelas relacionais (a verdade normalizada vive aqui)
- \`opening_hours\` (restaurant_id, weekday 0-6, open_time, close_time) — horários reais, NÃO no business_hours_json
- \`restaurant_category_map\` (restaurant_id, category_id) → \`restaurant_categories\` (id, name) — cozinhas normalizadas
- \`establishment_type_map\` (restaurant_id, type_id) → \`establishment_types\` (id, name) — tipos normalizados
- \`restaurant_awards\` (restaurant_id, …) — distinções/Michelin reais (michelin_id em db_restaurants é legado)
- \`reservations\` (restaurant_id, booking_status, booking_date, …) — booking_status mais comum: Pending
- \`countries\` (id, title, iso_alpha_2) · \`cities\` (id, title, country_id, latitude, longitude) — referência geográfica

## Regras de ouro do schema
- Sempre filtre db_restaurants por restaurant_id (nunca \`id\`). Imagens = images_json (nunca \`photos\`).
- Publicado deve ter email válido e não estar fechado. Nunca fabriques price_range_id sem fonte.
- Ao inserir em countries/cities, o id é gerado (identity/sequence) — NÃO forneça id.

## Playbooks de operação (memória institucional — siga à risca)
1. **Preencher e-mails de reserva faltantes** → \`enrich_missing_emails\` (apply=false primeiro, mostre o resumo, depois apply=true). Só grava domínio OFICIAL + score>=80, rejeitando imprensa/genéricos. Caso isolado: \`find_restaurant_email\`.
2. **Diagnóstico de qualidade** → comece SEMPRE com \`database_health\` (uma chamada dá o panorama); depois aprofunde com \`audit_table\`/\`detect_outliers\`/\`consistency_check\`.
3. **Coordinates** → backfill: SET coordinates = ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326) WHERE coordinates IS NULL AND latitude IS NOT NULL. Cast lat/long para ::float8 em TODOS os usos (evita "inconsistent types deduced").
4. **Vincular country_id/city_id** → countries/cities são incompletas. Crie a referência ausente (sem id — é auto-gerado) com title = grafia exata do db_restaurants e revincule por título; cities por title+country_id. Aliases: United States→Usa, UAE→Uae, Netherlands→Holland, Türkiye→Turkey.
5. **operational_status** → derive do Google Places business_status. NUNCA publique restaurante fechado; publicado que vier closed_permanently → despublique e reporte.
6. **price_range_id ausente** → o Google quase nunca traz price_level. NÃO invente — deixe nulo e reporte.
7. **restaurant_category** formato \`[*Michelin|][$$$$|]cozinhas, Vegetarian friendly\`. A verdade normalizada vive em restaurant_category_map/establishment_type_map; não propague cozinha heurística para o mapa sem fonte real.
8. **Correções em massa**: snapshot antes, confirme, aplique com confidence=high, e rode \`database_health\` depois para evidenciar a melhoria.
9. **SEO / busca orgânica**: comece com \`seo_audit\`. Maior alavanca = conteúdo multilíngue (\`translate_description\`, PT/EN/FR hoje ~0%) + structured data (\`generate_structured_data\` apply=true → \`structured_data_json\`). Dado de schema (geo/telefone/horários/cozinha/preço) já está ~100% completo; o site só não emite — por isso gerar o JSON-LD completo é ganho rápido. Em lote, peça confirmação e processe aos poucos (custo de LLM nas traduções).
10. **Guard-rails de escrita (impostos em código, não negociáveis)**: \`execute_mutation\` só aceita statement único INSERT/UPDATE/DELETE; UPDATE/DELETE exigem WHERE (ou allow_full_table=true explícito); rollback automático se afetar mais de 500 linhas (ajuste deliberado via max_affected_rows); DDL é bloqueado — mudanças de schema só por migration versionada. batch_fix/apply_auto_fixes são atômicos (transação) e capturam old_data.
11. **Reversibilidade**: toda correção fica auditada com old_data. Para desfazer: \`list_recent_mutations\` (ache o event_id) → \`revert_operation\`. Ofereça o undo ao usuário sempre que aplicar correções em massa.
12. **Performance do banco (DBA)**: para lentidão use \`slow_queries\` (pg_stat_statements) + \`explain_plan\` no SELECT suspeito; \`index_advisor\` sugere índices faltantes/os nunca usados; \`table_stats\` mostra bloat e vacuum; \`connection_stats\` mostra saturação de conexões. Recomende índices via migration, nunca crie DDL direto.`;

  let continueLoop = true;
  bus.emit('agent.thinking', { message_count: messages.length }, 'agent');

  // Prompt caching: the large static system prompt + tool definitions are marked ephemeral so
  // they are cached across loop turns (and across requests within the 5-min TTL) — big latency
  // and token-cost savings on every iteration after the first.
  const cachedSystem: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
  ];
  const cachedTools = tools.map((t, i) =>
    i === tools.length - 1 ? { ...t, cache_control: { type: 'ephemeral' as const } } : t
  ) as Anthropic.Tool[];

  // Running cost/usage across all turns of this request.
  const totals: UsageTotals = { input_tokens: 0, output_tokens: 0, cache_read: 0, cache_creation: 0, cost_usd: 0 };

  // Incremental caching: each turn we put a *rolling* cache breakpoint on the last block of the
  // growing history, so the entire conversation prefix (not just system+tools) is cached and
  // re-read at ~10% cost on the next turn — the dominant cost lever in a long tool loop.
  function historyWithRollingCache(): Anthropic.MessageParam[] {
    if (!history.length) return history;
    const out = history.map((m) => ({ ...m }));
    const last = out[out.length - 1];
    const mark = { type: 'ephemeral' as const };
    if (typeof last.content === 'string') {
      last.content = [{ type: 'text', text: last.content, cache_control: mark }];
    } else if (Array.isArray(last.content) && last.content.length) {
      const blocks = last.content.map((b) => ({ ...b })) as Anthropic.ContentBlockParam[];
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: mark } as Anthropic.ContentBlockParam;
      last.content = blocks;
    }
    return out;
  }

  // Adaptive thinking lets the model self-budget and interleave thinking between tool
  // calls. display:'summarized' keeps streamed thinking visible in the UI (Opus 4.8
  // omits thinking text by default). When thinking is off we send { type:'disabled' }.
  const thinkingParam = THINKING_ENABLED
    ? { type: 'adaptive' as const, display: 'summarized' as const }
    : { type: 'disabled' as const };
  const requestOptions = { signal };

  let guard = 0;
  while (continueLoop && guard++ < 24) {
    if (signal?.aborted) { yield { type: 'error', error: 'Cancelado pelo cliente.' }; return; }

    // `thinking: {type:'adaptive'}` and `output_config` postdate the pinned SDK's types,
    // so we assemble the body and cast — the request is sent verbatim over HTTP.
    // Retry transparente para erros transientes (429/5xx/529/rede) — mas só enquanto
    // nenhum token foi emitido ao cliente, para nunca duplicar conteúdo na UI.
    let response: Anthropic.Message | null = null;
    for (let attempt = 0; ; attempt++) {
      const stream = anthropic.messages.stream({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        system: cachedSystem,
        tools: cachedTools,
        messages: historyWithRollingCache(),
        thinking: thinkingParam,
        output_config: { effort: AGENT_EFFORT },
      } as unknown as Anthropic.MessageStreamParams, requestOptions);

      let emitted = false;
      try {
        // Forward token-level deltas (thinking + text) as they arrive.
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta') {
            if (ev.delta.type === 'thinking_delta') { emitted = true; yield { type: 'thinking', thinking: ev.delta.thinking }; }
            else if (ev.delta.type === 'text_delta') { emitted = true; yield { type: 'text', text: ev.delta.text }; }
          }
        }
        response = await stream.finalMessage();
        break;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const transient =
          status === 429 || status === 500 || status === 502 || status === 503 || status === 529 ||
          (status === undefined && /(ECONNRESET|ETIMEDOUT|fetch failed|socket|network)/i.test(String(err)));
        if (!emitted && !signal?.aborted && transient && attempt < 3) {
          await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000) + Math.random() * 400));
          continue;
        }
        throw err;
      }
    }
    if (!response) { yield { type: 'error', error: 'Stream terminou sem resposta do modelo.' }; return; }

    // Usage telemetry: accumulate + emit (cache hits are nearly free vs fresh input).
    const u = response.usage;
    totals.input_tokens += u.input_tokens ?? 0;
    totals.output_tokens += u.output_tokens ?? 0;
    totals.cache_read += u.cache_read_input_tokens ?? 0;
    totals.cache_creation += u.cache_creation_input_tokens ?? 0;
    totals.cost_usd += estimateCost(u);
    bus.emit('system.metric', { kind: 'usage', ...totals }, 'agent');

    if (response.stop_reason !== 'tool_use') {
      continueLoop = false;
      break;
    }

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    // Announce each tool up front so the UI shows it as "running" while it executes.
    for (const block of toolUseBlocks) {
      yield { type: 'tool_start', id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    }

    // Independent tool calls in the same turn run in parallel; order is preserved in results.
    const settled = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const input = block.input as Record<string, unknown>;
        const started = Date.now();
        try {
          const result = await executeTool(block.name, input);
          onToolCall?.(block.name, block.input, result);
          return { id: block.id, name: block.name, input, result, isError: false, duration: Date.now() - started };
        } catch (err) {
          return { id: block.id, name: block.name, input, result: { error: String(err) }, isError: true, duration: Date.now() - started };
        }
      })
    );

    // Emit the completed result for each tool (paired to tool_start by id).
    for (const s of settled) {
      yield { type: 'tool_end', id: s.id, name: s.name, result: s.result, duration: s.duration, isError: s.isError };
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = settled.map((s) => ({
      type: 'tool_result',
      tool_use_id: s.id,
      content: capForModel(s.result),
      is_error: s.isError,
    }));

    history.push({ role: 'assistant', content: response.content });
    history.push({ role: 'user', content: toolResults });
  }

  yield { type: 'usage', usage: totals };
}
