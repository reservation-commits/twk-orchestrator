# Auditoria dos e-mails da plataforma · 2026-09-10

Varridos os 62 workflows do n8n; 50 nós de e-mail ativos. Critério "padrão TWK" = cartão escuro (#0B0A08), logo, dourado, botões no padrão dos fluxos 1/2/3 v2. Fonte: leitura por API, não memória.

## Placar (nós ativos)

| Estado | Nós | O que são |
|---|---|---|
| **Padrão TWK** | 18 → 21 | fluxos 1, 2, 3 e 5 (reservas), código de listagem, token/convite, reset de senha do restaurante, e — desde hoje — alteração de reserva (2) |
| **Antigo** (fonte Hind, fundo claro, banner antigo) | 21 → 19 | ver lista abaixo |
| Aviso sem template | 8 | textos curtos internos/transacionais (candidatura recebida/aprovada, remoção de listagem, sem e-mail do restaurante…) |
| HTML em runtime | 3 | MAESTRO, Aria (2) — o padrão vem de quem envia |

## Antigos que ainda executam (prioridade de redesenho)

| Workflow | Nós | Última execução | Por que importa |
|---|---|---|---|
| **4 - resposta ao reagendamento** (`8sKe89Lz5Vzpy3a5`) | Confirmado/Recusado × Cliente/Estabelecimento (4) | 31/08 | é o **fim do ciclo de reagendamento** que estreamos hoje (GIGI): quando o cliente clica Aceitar/Recusar, estes saem — e estão no template antigo |
| **envia email resetar senha** (`1pc2qJX4kYkBni3s`, cliente) | 1 | 05/09 | primeiro contato de um cliente que perdeu a senha; já corrigido contra corrupção, mas visual antigo |
| **candidatura a parceiro** — "recebida" (`6ONkRN…`) e "aprovada" (`TkC4zL…`) | 2 | 09/09 (5+) | **o funil de contas**: avisos sem template, e o "aprovado" diz "nossa equipe entrará em contato" — hoje o convite sai por outro e-mail (`send-token`); o texto precisa dizer isso e apontar para ele |

## Antigos que nunca executam (desligar ou ligar)

| Workflow | Situação | Recomendação |
|---|---|---|
| `cria reserva` (8 nós, `/response/?action=` quebrado) | 0 execuções | desligar após o dev confirmar que nada o chama |
| `resposta do restaurante (site antigo)` (4 nós) | 0 execuções | desligar (mesma conferência) |
| `envia feedback do restaurante (admin)` | 0 execuções | desligar ou documentar o gatilho |
| `6 - desativação de conta` | 0 execuções | redesenhar quando for usado; baixo |
| **`TWK — pedir avaliacao (email)`** | **0 execuções — nunca disparou** | o fluxo existe, o site nunca o chama: é uma **lacuna de gatilho**, não de template (ver "fluxos que faltam") |

## Achados de conteúdo (além do visual)
- "Customer (Decline)" (fluxo 3, já TWK) **não tem nenhum link**: o cliente recebe um "não" e um beco sem saída.
- E-mails antigos apontam o cliente para `theworldkeys.com/account`; os novos usam `/users/reservations`. Padronizar.
- Vários antigos carregam link de Google Maps do **nosso** endereço em Paris (rodapé) — ruído.
- Nós legados apontavam o restaurante para `twk-site.xis4ee.easypanel.host/admin/onboarding` (host interno).

## Fluxos que faltam (para ser profissional e surpreendente)

Ordenados por impacto e por **dependência**: os quatro primeiros não precisam do dev — nascem de um agendador nosso (o mesmo padrão do Guardião) + um template TWK + um webhook do n8n.

1. **Pós-visita com avaliação** — o fluxo já existe e nunca disparou. Gatilho nosso: no dia seguinte a cada reserva `Accepted`, chamar o webhook `pedir avaliacao` (template a redesenhar). Fecha o ciclo e alimenta `aria_experience_reviews`.
2. **Lembrete de véspera ao cliente** (reserva confirmada): data, hora, pessoas, endereço com mapa, "precisa mudar?" → `/users/reservations`, e o WhatsApp do concierge. É o e-mail que os grandes (OpenTable, Resy) mandam e que reduz no-show.
3. **Boas-vindas ao parceiro novo** (dia 0, quando nasce a linha em `restaurant_users`): "como responder em um toque", link do painel, e no dia 7 os primeiros números da casa. Ninguém que abre conta hoje recebe uma palavra.
4. **Recusa com alternativas**: quando o restaurante recusa, o e-mail ao cliente traz 2–3 casas semelhantes na mesma cidade (a Aria já sabe descobrir por afinidade) + "peça ao concierge". Transforma um "não" numa segunda chance.
5. **Convite de calendário (.ics)** anexado ao "reserva confirmada" — pequeno, elegante, raro.
6. **Aviso honesto de "sem resposta"** antes da data, com alternativas — o degrau 4 do Guardião, agora autônomo (ADR-014).
7. **Resumo semanal ao parceiro** (pedidos, respondidos, tempo de resposta, comparação com a cidade) — o que dá ao dono um motivo para abrir o painel.
