# TWK DB Architect

Agente de gerenciamento inteligente do banco de dados PostgreSQL da plataforma **The World Keys** (theworldkeys.com).

## Pré-requisitos

- Node.js 18+
- Acesso ao banco PostgreSQL (Google Cloud SQL)
- Chave da Google Places API
- Chave da Anthropic API

## Setup

1. Configure `.env.local`:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
GOOGLE_PLACES_API_KEY=sua_chave_aqui
ANTHROPIC_API_KEY=sua_chave_aqui
```

2. Instale e rode:

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

---

## Módulos

| Módulo | Função |
|--------|--------|
| **Table Viewer** | Visualiza e edita qualquer tabela inline, exporta CSV |
| **Query Console** | Editor SQL com Monaco, tradução NL→SQL, modo Safe |
| **Restaurant Builder** | Descobre + enriquece + insere restaurantes via Places API |
| **Data Enricher** | Preenche colunas nulas com Claude AI / Google Places / Web |
| **Agent Chat** | Chat conversacional com acesso total ao DB via tools |
| **Activity Logs** | Log imutável de todas as mutações |

---

## Tabela de auditoria (necessária para logs)

```sql
CREATE TABLE IF NOT EXISTS public.update_events (
  id          SERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL,
  record_id   TEXT,
  old_data    JSONB,
  new_data    JSONB,
  agent       TEXT DEFAULT 'db-architect',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Estrutura

```
app/api/db/route.ts        → CRUD PostgreSQL
app/api/places/route.ts    → Google Places API
app/api/scrape/route.ts    → Web research
app/api/agent/route.ts     → Claude AI (SSE streaming)
lib/db.ts                  → Pool de conexão + helpers
lib/places.ts              → Google Places client
lib/scraper.ts             → Web scraping (Brave + DuckDuckGo)
lib/agent.ts               → Loop agentico Anthropic
components/                → UI (TableViewer, QueryConsole, etc.)
```
