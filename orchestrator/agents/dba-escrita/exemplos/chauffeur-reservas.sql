-- Reservas do Wanted Chauffeur (página theworldkeys.com/ride). Fase 1, escrito em 19/11/2026. NÃO EXECUTADO.
-- Substitui chauffeur-leads.sql (18/11), que guardava o pedido sem a pessoa: agora a reserva inteira mora aqui.
--
-- É DDL (CREATE TABLE no schema public): exige a FRASE DE APROVAÇÃO DO FUNDADOR pela porta única (ADR-017) e o
-- GRANT CREATE ao twk_dba. O papel twk_dba não cria tabela sozinho: o servidor recusa. Até a frase vir, as reservas
-- ficam no volume da Central (STATE_DIR/agents/wanted-chauffeur/reservas.jsonl, modo "arquivo" de reservas.js) e
-- `node orchestrator/agents/wanted-chauffeur/migrar.js --apply` passa tudo para estas tabelas sem perder linha.
--
-- Dado pessoal: nome de quem embarca, WhatsApp, partida, destino e recado. Mesmo nível do nextauth."User" (clientes da
-- plataforma): acesso mínimo (twk_ro lê para painel e agenda; twk_dba escreve; ninguém mais). reservas.js apaga
-- esses cinco campos 365 dias depois da corrida (anonimizado_em); código, produto, valor e status ficam para os números.
--
-- Rodar (depois da frase):  node orchestrator/agents/dba-escrita/executar.js orchestrator/agents/dba-escrita/exemplos/chauffeur-reservas.sql --apply
BEGIN;

CREATE TABLE IF NOT EXISTS public.chauffeur_reservas (
  codigo         varchar(12)  PRIMARY KEY,                       -- WTD-<origem>-XXXX, o mesmo da mensagem do WhatsApp
  origem         char(1)      NOT NULL CHECK (origem IN ('T','I','Y','W','H','S','R')),  -- T TikTok · I Instagram · Y YouTube · W Twitch · H hotel · S site · R direto
  produto        varchar(10)  NOT NULL CHECK (produto IN ('transfer','mad','night','game','soiree')),
  data           date,                                            -- o dia pedido (pode faltar)
  hora           varchar(8)   CHECK (hora ~ '^(1[0-2]|[1-9]):[0-5][05] (AM|PM)$'),  -- sempre AM/PM (decisão do fundador, 05/11)
  pessoas        smallint     CHECK (pessoas BETWEEN 1 AND 6),
  horas          smallint     CHECK (horas BETWEEN 2 AND 12),     -- só mise à disposition
  idioma         char(2)      CHECK (idioma IN ('fr','en','pt')),
  imagens        varchar(8)   NOT NULL DEFAULT 'privadas' CHECK (imagens IN ('ok','privadas')),  -- a caixa "images à bord"
  nome           varchar(80),                                     -- quem embarca (regra do fundador, 16/11) — PII
  whatsapp       varchar(16)  CHECK (whatsapp ~ '^\+[0-9]{8,15}$'), -- formato internacional — PII
  partida        varchar(120),                                    -- PII
  destino        varchar(120),                                    -- PII
  recado         varchar(300),                                    -- "un mot pour Julien" — PII
  valor_cent     integer      NOT NULL CHECK (valor_cent >= 0),   -- centavos de euro, tabela de 16/11; MAD = 9000 × horas
  moeda          char(3)      NOT NULL DEFAULT 'EUR',
  criado_em      timestamptz  NOT NULL DEFAULT now(),
  anonimizado_em timestamptz                                      -- quando os cinco campos de PII foram apagados
);
COMMENT ON TABLE public.chauffeur_reservas IS 'Reservas do Wanted Chauffeur (página /ride). Fonte única. PII apagada 365 dias depois da corrida. Dono: Central (agents/wanted-chauffeur/reservas.js).';

-- Linha do tempo: status (pedido → orcado → confirmado → feito | perdido | cancelado) e avisos enviados (nova_reserva, pendente).
-- Append-only: o último evento de tipo status é o status atual.
CREATE TABLE IF NOT EXISTS public.chauffeur_reservas_eventos (
  id         bigserial    PRIMARY KEY,
  codigo     varchar(12)  NOT NULL REFERENCES public.chauffeur_reservas(codigo),
  tipo       varchar(8)   NOT NULL CHECK (tipo IN ('status','aviso')),
  valor      varchar(24)  NOT NULL,                                -- status: pedido|orcado|confirmado|feito|perdido|cancelado · aviso: nova_reserva|pendente|…
  nota       varchar(200),                                         -- sem telefone (a Central recusa)
  por        varchar(40),                                          -- quem marcou: marlon, julien, central, importacao
  em         timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chauffeur_eventos_status_ok CHECK (tipo <> 'status' OR valor IN ('pedido','orcado','confirmado','feito','perdido','cancelado'))
);

-- Quem pediu para não ser filmado ou não receber mensagem. Consultado antes de qualquer envio ao cliente (Fase 2).
CREATE TABLE IF NOT EXISTS public.chauffeur_nao_contatar (
  id        bigserial    PRIMARY KEY,
  whatsapp  varchar(16)  CHECK (whatsapp ~ '^\+[0-9]{8,15}$'),
  nome      varchar(80),
  motivo    varchar(120),
  por       varchar(40),
  em        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chauffeur_nao_contatar_alguem CHECK (whatsapp IS NOT NULL OR nome IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS chauffeur_reservas_criado_em_idx ON public.chauffeur_reservas (criado_em);
CREATE INDEX IF NOT EXISTS chauffeur_reservas_data_idx ON public.chauffeur_reservas (data);
CREATE INDEX IF NOT EXISTS chauffeur_reservas_eventos_codigo_idx ON public.chauffeur_reservas_eventos (codigo, em DESC);

-- twk_ro lê (painel, agenda, relatórios); twk_dba escreve (a Central, em tempo real, e a migração). UPDATE só para a anonimização.
GRANT SELECT ON public.chauffeur_reservas, public.chauffeur_reservas_eventos, public.chauffeur_nao_contatar TO twk_ro;
GRANT SELECT, INSERT ON public.chauffeur_reservas, public.chauffeur_reservas_eventos, public.chauffeur_nao_contatar TO twk_dba;
GRANT UPDATE (nome, whatsapp, partida, destino, recado, anonimizado_em) ON public.chauffeur_reservas TO twk_dba;
GRANT USAGE ON SEQUENCE public.chauffeur_reservas_eventos_id_seq, public.chauffeur_nao_contatar_id_seq TO twk_dba;

COMMIT;

-- Depois da frase e desta DDL: na Central (Easypanel) CHAUFFEUR_RESERVAS_BANCO=on (TWK_DBA_URL já existe) e Deploy;
-- em seguida `node orchestrator/agents/wanted-chauffeur/migrar.js --apply` lê os .jsonl do volume e insere aqui (ON CONFLICT DO NOTHING).
