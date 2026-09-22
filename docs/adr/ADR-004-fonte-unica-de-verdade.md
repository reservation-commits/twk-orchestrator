# ADR-004 — Fonte única de verdade por tipo de dado

**Status:** aceito · 2026-08-12

## Contexto
O Postgres `twk_auth` é hoje um barramento informal onde 3 agentes leem e escrevem sem donos claros. Conflitos reais: DBA tem `translate_description(apply=true)` sobre texto que o Editorial é dono; supressão de contato existe em dois lugares desconectados (arquivo do CLAVIS × `aria_contact_consent`); receita não tem dono que a ligue ao domínio.

## Decisão
Cada tipo de dado tem UM dono; os demais consultam, nunca duplicam:

| Dado | Dono |
|---|---|
| Catálogo (estrutura, `published`, contatos, horários, fotos) | **DBA** |
| Texto editorial (`about_*`, `meta_*`, `cities.description`) | **Editorial** |
| Reservas | **Plataforma** (nenhum agente escreve) |
| Receita/pagamentos | **Financeiro** |
| Consentimento de contato (todos os canais) | **Suporte** (`aria_contact_consent` como registro unificado) |
| Relacionamento comercial (`partner`, `negotiation_status`) | **Comercial** (escrita física via DBA sob proposta) |
| Estado de orquestração | **Orquestrador** |

Consequências imediatas: (a) remover `translate_description(apply=true)` do DBA — vira proposta ao Editorial; (b) CLAVIS consulta `aria_contact_consent` antes de todo envio e espelha seus opt-outs nela; (c) mudança de `published` é evento de negócio notificado aos consumidores, não UPDATE silencioso.

## Alternativas consideradas
1. **Duplicação com sync (cada agente com sua cópia):** reconciliação eterna, a fonte de bugs clássica. Rejeitada.
2. **Dono único = DBA para tudo:** recria o deus-agente na camada de dados e transforma o agente mais perigoso no mais requisitado. Rejeitada.
