-- Tabela dos pedidos de corrida do Wanted Chauffeur (leads da página theworldkeys.com/ride).
-- Card T-20261109-0023, etapa 5. Escrito em 18/11/2026. NÃO EXECUTADO.
--
-- É DDL (CREATE TABLE no schema public): exige a FRASE DE APROVAÇÃO DO FUNDADOR pela porta única (ADR-017) e o
-- GRANT CREATE ao twk_dba. O papel twk_dba não cria tabela sozinho: o servidor recusa. Até a frase vir, os pedidos
-- ficam em orchestrator/command-center → STATE_DIR/chauffeur-leads.jsonl (plano B, já no ar na Central), e a
-- migração para esta tabela é um INSERT por linha do arquivo, sem perder nada.
--
-- O que a tabela guarda: só o que o painel precisa para contar de onde vêm os pedidos.
-- O que ela NUNCA guarda: nome, telefone, e-mail, endereço de partida ou chegada. A pessoa fica na planilha de
-- clientes (Google Sheets, acesso Márlon/Lucas/Julien), fora do site e fora deste banco.
--
-- Rodar (depois da frase):  node orchestrator/agents/dba-escrita/executar.js orchestrator/agents/dba-escrita/exemplos/chauffeur-leads.sql --apply
BEGIN;

CREATE TABLE IF NOT EXISTS public.chauffeur_leads (
  codigo        varchar(12)  PRIMARY KEY,                      -- WTD-<origem>-XXXX, o mesmo que vai na mensagem do WhatsApp
  origem        char(1)      NOT NULL CHECK (origem IN ('T','I','Y','W','H','S','R')),  -- T TikTok · I Instagram · Y YouTube · W Twitch · H hotel · S site · R direto
  produto       varchar(10)  NOT NULL CHECK (produto IN ('transfer','mad','night','game','soiree')),
  data_pedida   date,                                           -- o dia que o cliente pediu (pode faltar)
  hora_pedida   varchar(8)   CHECK (hora_pedida ~ '^(1[0-2]|[1-9]):[0-5][05] (AM|PM)$'),  -- sempre AM/PM (decisão do fundador, 05/11)
  horas         smallint     CHECK (horas BETWEEN 2 AND 12),    -- só para mise à disposition
  pessoas       smallint     CHECK (pessoas BETWEEN 1 AND 6),
  idioma        char(2)      CHECK (idioma IN ('fr','en','pt')),
  imagens       varchar(8)   NOT NULL DEFAULT 'privadas' CHECK (imagens IN ('ok','privadas')),  -- a caixa "images à bord" da página
  criado_em     timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.chauffeur_leads IS 'Pedidos de corrida do Wanted Chauffeur vindos da página /ride. Sem PII: a pessoa está na planilha de clientes. Dono: Central (command-center/chauffeur.js).';

-- O resultado é marcado à mão pelo código (orçado, confirmado, feito, perdido). Append-only: o último vale.
CREATE TABLE IF NOT EXISTS public.chauffeur_leads_resultados (
  id            bigserial    PRIMARY KEY,
  codigo        varchar(12)  NOT NULL REFERENCES public.chauffeur_leads(codigo),
  resultado     varchar(12)  NOT NULL CHECK (resultado IN ('orcado','confirmado','feito','perdido')),
  nota          varchar(200),                                   -- sem telefone (a Central recusa)
  marcado_em    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chauffeur_leads_criado_em_idx ON public.chauffeur_leads (criado_em);
CREATE INDEX IF NOT EXISTS chauffeur_leads_resultados_codigo_idx ON public.chauffeur_leads_resultados (codigo, marcado_em DESC);

-- Leitura pelo painel e pelos relatórios: twk_ro só lê; twk_dba escreve (INSERT) pela porta única.
GRANT SELECT ON public.chauffeur_leads, public.chauffeur_leads_resultados TO twk_ro;
GRANT SELECT, INSERT ON public.chauffeur_leads, public.chauffeur_leads_resultados TO twk_dba;
GRANT USAGE ON SEQUENCE public.chauffeur_leads_resultados_id_seq TO twk_dba;

COMMIT;

-- Migração do plano B (rodar depois, como arquivo separado e reversível):
--   cada linha de chauffeur-leads.jsonl → INSERT INTO public.chauffeur_leads (codigo, origem, produto, data_pedida, hora_pedida, horas, pessoas, idioma, imagens, criado_em) VALUES (...) ON CONFLICT DO NOTHING;
--   cada linha de chauffeur-leads-resultados.jsonl → INSERT INTO public.chauffeur_leads_resultados (codigo, resultado, nota, marcado_em) VALUES (...);
