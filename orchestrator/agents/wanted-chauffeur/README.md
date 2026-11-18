# Wanted Chauffeur — ferramentas de operação

Ferramentas (não conteúdo: roteiros, legendas e ideias são do Julien). Escritas em 18/11/2026 para os cards do COMPASSO.

## 1. Pedidos de corrida na Central (cards T-20261109-0024 · 0027 · 0023 plano B)

| Peça | Onde | O que faz |
|---|---|---|
| Módulo | `orchestrator/command-center/chauffeur.js` | recebe o pedido da página `/ride` (**POST `/api/chauffeur/lead`**, sem chave, só da origem `theworldkeys.com`, teto por endereço), grava em `STATE_DIR/chauffeur-leads.jsonl`; serve o painel (**GET `/api/chauffeur/leads?dias=30`**), os links por rede (**GET `/api/chauffeur/links`**) e o resultado por código (**POST `/api/chauffeur/lead/resultado`**), estes três com a chave da Central |
| Painel | `https://<central>/chauffeur` (`public/chauffeur/`) | pedidos por origem, por produto, por dia, quantos viraram corrida; cada linha tem o seletor de resultado (orçado · confirmado · feito · perdido); os 6 links com a letra para copiar |
| Testes | `regencia/test/chauffeur.test.js` | 6 testes: sem PII no arquivo, formato estrito, origem e CORS, teto 429, painel e resultado, links. Na Porta (chave `regencia`) |
| DDL | `orchestrator/agents/dba-escrita/exemplos/chauffeur-leads.sql` | a tabela `chauffeur_leads` (+ `_resultados`) para quando o fundador der a frase; até lá vale o `.jsonl` |

**O que fica guardado:** código `WTD-<letra>-XXXX`, origem, produto, data, hora (AM/PM), pessoas, horas (só mise à disposition), idioma, caixa de imagens. **Nunca** nome, telefone, endereço. O nome vai só na mensagem do WhatsApp; a pessoa fica na planilha.

**Letras de origem:** T TikTok · I Instagram · Y YouTube · W Twitch · H hotel · S site · R direto (sem link).
Link na bio de cada rede: `https://theworldkeys.com/ride?o=T` (I, Y, W); cartão e QR dos hotéis: `?o=H`; botões do site: `?o=S`.

**Para ligar em produção (Lucas):**
1. Na Central (Easypanel), opcional: `CHAUFFEUR_ORIGINS=https://theworldkeys.com,https://www.theworldkeys.com` (é o padrão), `CHAUFFEUR_TETO_HORA=30`, `CHAUFFEUR_PAGINA=https://theworldkeys.com/ride`.
2. Na página `/ride`, pôr em `CENTRAL_LEAD` o endereço `https://<central>/api/chauffeur/lead` (o protótipo em `docs/estrategia/wanted-chauffeur/page-ride-prototype-2026-11-17.html` já lê `?o=`, monta o código e envia por `sendBeacon` ao clicar em "Ouvrir WhatsApp" ou "Copier").
3. Teste: abrir `/ride?o=T`, mandar um pedido de teste; ele aparece em `/chauffeur` com origem TikTok e o código que foi na mensagem.

**Quem marca o resultado:** o Márlon, no fim do dia, pelo código que aparece na conversa do Julien (a combinar; card 0027, etapa 2).

## 2. Planilha de clientes (card T-20261116-0013) — modelos para importar no Google Sheets

`planilha/clientes.csv`, `planilha/nao-contatar.csv`, `planilha/videos.csv`: uma aba cada (Arquivo → Importar → "Inserir nova(s) página(s)"). A linha de exemplo se apaga no primeiro cliente de verdade. Acesso só Márlon, Lucas e Julien. É dado pessoal: **fica na planilha, fora do site e fora do banco da TWK.**

- `clientes`: nome_da_reserva (quem embarca), whatsapp, hotel_ou_bairro, origem_do_pedido, produto, data, hora (AM/PM), codigo (o WTD- da Central), resultado, observacao.
- `nao-contatar`: quem pediu para não ser filmado ou não receber mensagem, com a data. Quem está aqui nunca recebe mensagem.
- `videos`: data, rede, tipo, gancho, views em 24 h, comentários, pedidos que trouxe e os códigos. É daqui que saem os 3 números de segunda.

## 3. Agenda do dia às 9:00 AM (card T-20261116-0012)

```
node orchestrator/agents/wanted-chauffeur/agenda-do-dia.js <clientes.csv> [--dia AAAA-MM-DD] [--ideia "…"] [--hotel "…"]
```

**Rotina hospedada (18/11):** `agenda-run.js` roda sozinho na Central às 9:00 AM Paris e manda ao Julien pela Aria; está desligada até `CHAUFFEUR_AGENDA=on` no Easypanel. Como ligar: `docs/runbooks/agenda-julien-9am.md`. A versão à mão continua valendo:

Lê a exportação CSV da aba `clientes`, pega as linhas do dia com resultado `confirmado`, ordena por hora e imprime a mensagem em francês (hora em AM/PM, nome de quem embarca, trajeto/bairro, origem, valor da tabela de 16/11, código). Dia sem corrida: a ideia do dia e o hotel do cartão (passados na linha de comando; a ideia é do Julien ou do estúdio dele). **Nada é enviado:** copiar e mandar no WhatsApp é passo do Márlon; o telefone do cliente não entra na mensagem. Coluna faltando = erro, não agenda vazia. Testes: `node --test "test/*.test.js"` (Porta, chave `chauffeur`).
