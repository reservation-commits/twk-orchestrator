# Agenda do Julien às 9:00 AM — como ligar

Rotina hospedada da Central que, todo dia às 9:00 AM (Paris), lê a planilha de clientes do Wanted Chauffeur, monta a
agenda do dia e pede à Aria o aviso no WhatsApp do Julien. Escrita em 18/11/2026. **Está no código e desligada**: liga
com uma chave no Easypanel. Não está no COMPASSO (decisão do Márlon, 18/11): é rotina, não card.

## O que ela faz

1. Às 9:00 AM Paris (a cada 5 min dentro dessa hora, até conseguir; no máximo 3 tentativas), roda
   `orchestrator/agents/wanted-chauffeur/agenda-run.js` dentro do container da Central.
2. Baixa a aba **clientes** da planilha (URL publicada como CSV), pega as linhas com `data` = hoje e `resultado` =
   confirmado, ordena por hora.
3. Monta UMA linha em francês, até 300 caracteres (limite do template de WhatsApp da Aria; a Meta não aceita quebra
   de linha): `Agenda du mardi 24 novembre : 7:00 AM · Paul Durand · Transfer · Hôtel Capitole · 80 € | 9:00 PM · Léa
   Martin · Game Night · Saint-Cyprien · 350 € | 1 à confirmer`. Se não couber, diz quantas faltam e manda olhar a folha.
   Nunca o telefone do cliente; a origem e o código ficam na planilha.
4. Pede à Aria (`POST /webhook/alerta-equipe`, nome "julien", nunca o número; evento `agenda:<dia>`). A Aria manda o
   template `twk_team_alert` com hora em AM/PM.
5. Grava `agents/wanted-chauffeur/agenda-<dia>.json` no volume: **1 envio por dia**, e a Aria também recusa o mesmo
   evento em 24 h.
6. **Dia sem corrida: não manda nada** (regra de 24/09: push sem conteúdo vira ruído). Para mandar "aucune course
   confirmée" mesmo assim: `CHAUFFEUR_AGENDA_VAZIA=on`.
7. Falha (planilha fora do ar, URL devolvendo HTML, sem segredo, Aria recusou): sai com erro, grava o motivo e abre
   uma **Ação na Central** ("A agenda do dia não chegou ao Julien"). Nunca "ok" vazio.

## Ligar (5 passos, ~10 minutos)

1. **Planilha.** Na planilha de clientes (card T-20261116-0013), aba `clientes` com o cabeçalho exato:
   `nome_da_reserva,whatsapp,hotel_ou_bairro,origem_do_pedido,produto,data,hora,codigo,resultado,observacao`
   (modelo em `orchestrator/agents/wanted-chauffeur/planilha/clientes.csv`). `data` em AAAA-MM-DD, `hora` em AM/PM.
2. **Publicar a aba como CSV.** Arquivo → Compartilhar → Publicar na web → escolher a aba `clientes` → formato CSV →
   Publicar → copiar o link. Atenção: o link publicado abre sem login para quem o tiver; é só a aba, não a planilha.
   Alternativa sem publicar: um Apps Script `doGet` que devolve o CSV com um token na URL, ou a API do Sheets com a
   conta de serviço do Quill (mais trabalho; decidir se a publicação incomoda).
3. **Aria.** Conferir que `TEAM_ALERT_TO` da Aria tem `julien=+33…` e anotar `TEAM_ALERT_SECRET` (o Olheiro já usa).
4. **Easypanel da Central**, variáveis:
   ```
   CHAUFFEUR_AGENDA=on
   CHAUFFEUR_AGENDA_CSV_URL=<o link do passo 2>
   ARIA_TEAM_ALERT_SECRET=<o mesmo TEAM_ALERT_SECRET da Aria>   (se já existe para o Olheiro, não repetir)
   CHAUFFEUR_AGENDA_HORA=9            (opcional; hora de Paris)
   CHAUFFEUR_AGENDA_PARA=julien       (opcional)
   CHAUFFEUR_AGENDA_VAZIA=off         (opcional)
   ```
   `ROTINAS_ENABLED=on` já precisa estar lá (é o que liga o relógio das rotinas). Deploy.
5. **Conferir.** No log do container deve aparecer `[rotinas] agenda do Julien às 9h Paris pela Aria` sem os avisos
   "SEM PLANILHA" / "SEM SEGREDO". No dia seguinte, `logs/tarefas/agenda-julien-<dia>.log` no volume e
   `agents/wanted-chauffeur/agenda-<dia>.json` com `enviado: true`.

## Testar antes de ligar, sem mandar nada

Na máquina local, com a planilha exportada em CSV:
```
node orchestrator/agents/wanted-chauffeur/agenda-run.js --dry-run --csv caminho/clientes.csv --dia 2026-11-24
```
Mostra a mensagem exata (e o tamanho) e não envia. Com a URL publicada: `CHAUFFEUR_AGENDA_CSV_URL=<link> node … --dry-run`.

## Desligar

`CHAUFFEUR_AGENDA=off` (ou apagar a variável) e Deploy. Nada mais muda.

## Testes

`node --test "test/*.test.js"` em `orchestrator/agents/wanted-chauffeur` (9 testes: desligada não lê nem avisa; 1 envio
por dia; sem telefone; dia vazio não manda; falhas saem com 1; dry-run). Na Porta, chave `chauffeur`.
