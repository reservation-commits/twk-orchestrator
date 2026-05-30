import Anthropic from '@anthropic-ai/sdk';
import { query, withTransaction, listTables, getTableSchema, getRowCount, logUpdateEvent } from './db';
import { searchRestaurantsByCity, getPlaceDetails, enrichFromMichelinGuide, mapPlaceToDBSchema } from './places';
import { webSearch, fetchUrl, findSocialMedia } from './scraper';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    description: 'Execute an INSERT, UPDATE or DELETE query with automatic audit logging',
    input_schema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'The SQL mutation to execute' },
        params: { type: 'array', items: {}, description: 'Optional query parameters' },
        table: { type: 'string', description: 'Table being modified (for audit log)' },
        operation: { type: 'string', enum: ['INSERT', 'UPDATE', 'DELETE'] },
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
];

// ── Tool executor ───────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'execute_query': {
      const result = await query(input.sql as string, input.params as unknown[] | undefined);
      return { rows: result.rows, rowCount: result.rowCount };
    }

    case 'execute_mutation': {
      const result = await query(input.sql as string, input.params as unknown[] | undefined);
      await logUpdateEvent({
        table_name: input.table as string,
        operation: input.operation as 'INSERT' | 'UPDATE' | 'DELETE',
        new_data: { sql: input.sql, params: input.params },
      });
      return { rowCount: result.rowCount, command: result.command };
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
      const columns = Object.keys(rows[0]);
      let inserted = 0;

      await withTransaction(async (client) => {
        for (const row of rows) {
          const values = columns.map((c) => row[c]);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          await client.query(
            `INSERT INTO ${input.table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values
          );
          inserted++;
        }
        await logUpdateEvent({
          table_name: input.table as string,
          operation: 'INSERT',
          new_data: { count: inserted },
        });
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
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write a 2-3 sentence luxury editorial description for a restaurant called "${input.name}" in ${input.city}${input.cuisine ? `, specialising in ${input.cuisine}` : ''}. ${input.details ?? ''} The tone should be elegant, evocative, and aspirational — matching a premium fine-dining discovery platform. Write in English.`,
        }],
      });
      return { description: (response.content[0] as { text: string }).text };
    }

    case 'find_social_media':
      return findSocialMedia(input.name as string, input.city as string);

    case 'web_search':
      return webSearch(input.query as string, (input.count as number) ?? 5);

    case 'fetch_url':
      return fetchUrl(input.url as string);

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── Agentic loop ────────────────────────────────────────────────────────────

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function* runAgentStream(
  messages: AgentMessage[],
  onToolCall?: (name: string, input: unknown, result: unknown) => void
): AsyncGenerator<string> {
  const history: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const systemPrompt = `You are the TWK Database Architect — an expert AI agent for The World Keys platform (theworldkeys.com), a premium fine-dining restaurant discovery service.

You have full access to the PostgreSQL database and external enrichment APIs. Always be precise, professional, and safety-conscious:
- Before destructive operations (DELETE, mass UPDATE), summarise what you are about to do
- Use transactions for bulk inserts
- Log every mutation via execute_mutation (it auto-logs to update_events)
- Prefer Portuguese (Brazilian) when speaking to the user
- When inserting restaurants, always enrich with Michelin data and generate a luxury description`;

  let continueLoop = true;

  while (continueLoop) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages: history,
    });

    let assistantText = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        assistantText += block.text;
        yield block.text;
      }
    }

    if (response.stop_reason === 'end_turn') {
      continueLoop = false;
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue;
        yield `\n\n⚙️ **Executando: ${block.name}**\n`;

        let result: unknown;
        let isError = false;
        try {
          result = await executeTool(block.name, block.input as Record<string, unknown>);
          onToolCall?.(block.name, block.input, result);
        } catch (err) {
          result = { error: String(err) };
          isError = true;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
          is_error: isError,
        });
      }

      history.push({ role: 'assistant', content: response.content });
      history.push({ role: 'user', content: toolResults });
    } else {
      continueLoop = false;
    }
  }
}
