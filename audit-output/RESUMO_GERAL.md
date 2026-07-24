# 📘 RESUMO GERAL — Curadoria do Banco TWK
**Atualizado em 2026-06-09**

Documento em linguagem simples sobre o que foi feito no banco da The World Keys até aqui e o que ainda precisa ser feito.

---

## 🎯 Onde o banco está hoje (em uma olhada)

| Indicador | Valor |
|---|---:|
| Restaurantes no banco | **2.207** |
| Restaurantes publicados (na vitrine) | **2.006** |
| Despublicados nesta auditoria (fechados pelo Google) | **16** |
| Nota geral do banco (0 a 100) | **91,6** |
| Restaurantes com qualidade alta (80–100) | **2.079 (94%)** |
| Países distintos padronizados | **47** |
| Linhas de trilha de auditoria criadas | **6.755** |

**Nota geral no começo da auditoria: 72,2.** Em um dia, subimos quase **20 pontos**.

---

## ✅ O que foi feito (em ordem)

### 🔍 FASE 0 — Diagnóstico (só leitura)
Auditei o banco inteiro sem mexer em nada. Descobri:
- Onde tudo estava bem (nome, cidade, place_id Google)
- Onde tinha buracos (coordenadas, horários, prêmios, etc)
- Quais dados estavam sujos (emails com texto colado, países com typo)
- Onde existia risco escondido (9.971 registros sumidos em backup, 13 restaurantes duplicados)

📄 Entregue como `gap_report.md`.

---

### 🛠 FASE 1 — Reforma estrutural do banco (8 ajustes)

| # | Ajuste | Por que |
|---|---|---|
| 1 | **Carimbo de "verificado em"** | Pra saber, em qualquer momento, quando cada dado foi conferido e de qual fonte. Base de tudo. |
| 2 | **Fuso horário + status do restaurante** | Pra reservas no horário certo + pra marcar "fechou de vez" sem precisar deletar do banco. |
| 3 | **Tabela de prêmios** (Michelin, 50 Best, Gault&Millau) | Curadoria de elite com histórico por ano e URL da prova. |
| 4 | **15 campos premium** (chef, política de reserva, dress code, tags, menu degustação…) | Informação que o concierge VIP precisa. |
| 5 | **Descrição em vários idiomas** (PT/EN/FR) | TWK é global, conteúdo idem. |
| 6 | **Travas de qualidade** (telefone E.164, email, URL, partner=booleano) | Banco passa a recusar dados inválidos. |
| 7 | **Padronização de países** com código ISO | Suporte a integrações internacionais. |
| 8 | **Limpeza de 5 colunas zumbi** + reaproveitamento de `localization` para URL do Google Maps | Schema mais enxuto, campo útil. |

**Resultado:** 8 migrations aplicadas, ~30 colunas novas, 5 colunas antigas removidas, 5 tabelas novas (prêmios + tradução de países + trilha de auditoria), 16 travas de qualidade, 9 índices novos. **Zero perda de dados.**

---

### 📊 FASE 2 — Mapa do problema (só leitura)
Calculei, restaurante por restaurante, exatamente o que faltava. Score médio dos publicados: **77,8/100**. Identificadas as 4 lacunas herdadas mais críticas:
- 31,5% sem coordenadas
- 26,4% sem email de reserva
- 23,0% sem site oficial
- 17,1% sem horários estruturados

📄 Entregue como `phase2_summary.md` + CSVs.

---

### 🚀 FASE 3 — Enriquecimento (várias rodadas)

#### Lote #01 — Coordenadas e URL Google Maps
- **628 restaurantes** ganharam latitude/longitude do Google Places
- **627 restaurantes** ganharam URL do Google Maps (no campo `localization`)
- **8 restaurantes fechados** detectados e despublicados com motivo
- **4 e-mails corrompidos** removidos com auditoria (incluindo um onde alguém colou o log de um agente como e-mail 😱)
- Score subiu de 77,8 → **77,8** (coordenadas viabilizam mapa e busca por proximidade)

#### Lote #02 PRE — Limpeza
- **9 telefones** com espaço/caractere invisível → normalizados para E.164
- **3 sites** sem `https://` → corrigidos

#### Lote #02 — Fusos horários
- **2.128 restaurantes** ganharam fuso IANA (Europe/Paris, Asia/Bangkok, etc) calculado pelas coordenadas
- Score subiu para **91,0**

#### Lote #03 — Telefone + site + faixa de preço
- **19 telefones** novos
- **424 sites oficiais** novos
- **29 faixas de preço** novas
- **8 mais restaurantes fechados** detectados e despublicados
- **1 caso suspeito (ANNA-S)** isolado para revisão manual (Google realocou o `place_id`)
- Score subiu para **91,6**

#### Lote #04 — Padronização de países
- **2.198 restaurantes** ganharam código ISO de país (FR, US, BR, etc)
- **341 restaurantes** tiveram o nome do país corrigido (USA→United States, England→United Kingdom, Holland→Netherlands, Morrocco→Morocco, etc)
- **23 novos aliases** adicionados à tabela de tradução
- Casos especiais resolvidos: Saint Barths/Saint-Martin/Guadeloupe agrupados como France, Quebec como Canada, San José confirmado como Costa Rica
- Score continuou em **91,6** (padronização não conta pontos, mas viabiliza filtros e integrações)

---

## 📈 Antes x Depois — números chave

| Coisa | Antes | Agora |
|---|---:|---:|
| Restaurantes com coordenadas (publicados) | 68,5% | **100%** ✅ |
| Restaurantes com fuso horário | 0% | **100%** ✅ |
| Restaurantes com país ISO padronizado | 0% | **100%** ✅ |
| Dados corrompidos (telefones/sites/emails) | 16 | **0** ✅ |
| Restaurantes fechados ainda na vitrine | ~16 conhecidos + ? | **0 detectados** ✅ |
| Trilha de auditoria | 0 linhas | **6.755 linhas** ✅ |
| Nota geral do banco | 72,2/100 | **91,6/100** ✅ |
| Restaurantes "premium-ready" (80–100) | 38% | **94%** ✅ |

---

## 🔧 O que ainda precisa ser feito

### 🎯 Curto prazo — enriquecimento (lotes prontos pra atacar)

| Lacuna | Quantos faltam | Fonte | Custo aproximado |
|---|---:|---|---|
| 📸 Galeria premium (capa + 3 fotos + logo) | **601** | Google Places | ~US$ 10 |
| 🏆 Prêmios (Michelin, 50 Best, Gault&Millau) | **1.606** | Scraping de guias | Tempo |
| 👨‍🍳 Nome e bio do chef | **2.006** | Site oficial + Michelin | Tempo |
| 📝 Política de reserva | **2.006** | Site oficial | Tempo |
| ☎️ Telefones que faltam | **48** | Scraping site oficial | Tempo |
| 💰 Faixas de preço que faltam | **25** | Scraping menus | Tempo |
| 🌐 Sites oficiais que faltam | **21** | Scraping/busca | Tempo |
| 📞 Canal de reserva (qualquer um) | **21** | Site oficial | Tempo |

### 🧹 Médio prazo — higiene e dedupe (FASE 5)

| Tarefa | Quantos | Observação |
|---|---:|---|
| Resolver duplicatas por Google Place ID | **13 grupos** | Mesma casa cadastrada 2× (ex: `VICTORIA`/`VICTORIA PARIS`) |
| Investigar **9.971 registros no backup** sumidos do principal | 9.971 | Pode ter perdido restaurantes legítimos por engano. Decidir caso a caso. |
| **Caso ANNA-S** (id 87614) | 1 | Google realocou o `place_id`. Conferir se é o mesmo restaurante. |
| Ativar trava de unicidade do Place ID | — | Liga sozinho assim que terminarmos o dedup |

### 🌍 Médio prazo — descrições traduzidas

| Tarefa | Quantos |
|---|---:|
| `about_pt` preenchido | 0 (campo novo) |
| `about_en` preenchido | 0 (campo novo) |
| `about_fr` preenchido | 0 (campo novo) |
| `about_text` (legado, vamos migrar) | 2.006 |

A migração do texto antigo para os 3 idiomas pode ser feita em lote com tradução automática + revisão humana.

### 🌟 Longo prazo — expansão (FASE 6)

Identificar e cadastrar os melhores restaurantes premium **ausentes** do banco em cada cidade que vocês atendem:
- Michelin: vocês têm ~430 ligados a alguma menção Michelin, num universo global de **mais de 3.500 estrelas**. Cobertura provável < 15%.
- 50 Best, Asia 50 Best, LatAm 50 Best, World's 50 Best Bars — nenhum cadastro ainda.
- Gault&Millau (guia francês) — nenhum cadastro.

### 📅 Pequenos pendentes técnicos

| Item | Quando |
|---|---|
| Migration #008b — apagar definitivamente as 5 colunas zumbi renomeadas | Já apagadas direto (você optou por pular o período de quarentena) ✅ |
| Validar as 4 travas de qualidade nos dados antigos | Quando o backfill terminar |

---

## 🎁 Bônus — o que o banco ganhou de capacidades novas

Coisas que **agora dá pra fazer** e antes não dava:

- 🗺 **Mapa funciona em 100% dos restaurantes publicados** (busca por proximidade, pinos no mapa)
- 🕒 **Horários corretos em qualquer fuso do mundo** (Tóquio às 19h ≠ Paris às 19h)
- 🏷 **Filtros geográficos confiáveis** ("United States" agora encontra os 166 que estavam como "USA")
- 🔍 **Trilha de qualquer mudança** — `enrichment_log` em cada restaurante mostra o histórico completo
- 🚪 **Saída controlada** — restaurantes fechados saem da vitrine mas não somem do banco, com motivo registrado
- 🌐 **Banco pronto pra internacionalização** (códigos ISO, fuso IANA, telefone E.164)
- 🛡 **Banco rejeita dado inválido na entrada** — não dá mais pra salvar `"reservations@3bk.com⁣"` com caractere invisível

---

## 💰 Investimento

- Google Places API: **~US$ 37** gastos até aqui (lotes 01, 03, 04 + dry-run repetido do 03)
- Lotes futuros estimados: ~US$ 10 (galeria) + valores menores conforme avançarmos

---

## 🗺 Arquivos importantes em `audit-output/`

| Documento | O que tem |
|---|---|
| `RESUMO_GERAL.md` | Este documento |
| `gap_report.md` | Diagnóstico inicial (Fase 0) |
| `schema_proposals.md` | Detalhe das 8 migrations da Fase 1 |
| `approval_queue.md` | Histórico de aprovações |
| `phase2_summary.md` | Auditoria por restaurante (Fase 2) |
| `enrichment_proposals_lot01.md` | Proposta detalhada do primeiro lote de enriquecimento |
| `phase2-action-plan.csv` | Lista priorizada dos restaurantes que ainda precisam de atenção |
| `phase3-lot0*-*.csv` | Propostas + resultados de cada lote |
