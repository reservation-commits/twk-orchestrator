# Selo de verificação no WhatsApp da Aria (Conta Comercial Oficial) — runbook, 09/11/2026

**O que é.** O selo azul ao lado do nome "The World Keys" nas conversas do número **+55 21 96784-1007** (o número da Aria, WhatsApp Cloud API). Na Meta ele se chama **Official Business Account (OBA)** / Conta Comercial Oficial. Desde 2025 o selo é **azul**, não mais verde. Ele é **gratuito** para números da plataforma (API): não é a assinatura paga "Meta Verified", que vale para o app WhatsApp Business e não para o nosso caso.

**Fonte.** Página oficial da Meta para desenvolvedores: `developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts` (lida em 09/11/2026). Tudo que está abaixo como *fato* vem dela ou da leitura da nossa conta pela API; o que é *suposição* está marcado.

## Critérios da Meta e onde estamos (lido pela API em 09/11/2026)

| # | Critério publicado pela Meta | Estado da TWK | Origem |
|---|---|---|---|
| 1 | Cumprir a WhatsApp Business Messaging Policy | **OK** (fato: qualidade `GREEN`, sem bloqueio; suposição: uso de suporte + templates de reserva com opt-in é o caso de uso previsto na política) | `quality_rating` do número |
| 2 | Pelo menos 30 dias na WhatsApp Business Platform | **OK** — o número está em modo `LIVE` desde antes de 29/09/2026 (templates criados pela API nessa data) | `account_mode`, runbook de templates |
| 3 | Portfólio do negócio verificado (Business Verification) | **OK** — `business_verification_status = verified`, revisão da conta `APPROVED` | conta `912548304699169` |
| 4 | Verificação em duas etapas ligada no número | **CONFERIR** — a API não expõe; é o passo 1 abaixo | WhatsApp Manager |
| 5 | Nome de exibição aprovado | **OK** — `"The world keys"`, `name_status = APPROVED` (com "world keys" em minúsculas) | número `1042654062259988` |
| — | Pedido do selo | **nunca feito** — `oba_status = NOT_STARTED`, `is_official_business_account = false` | número |

Ou seja: **só falta ligar a verificação em duas etapas (se ainda não estiver) e clicar em "Enviar solicitação".** Não há documento novo a enviar, porque a verificação do negócio já está feita.

Para reconferir a qualquer momento (só leitura, sem segredo no chat):

```bash
node orchestrator/agents/notificacao-reserva/meta-selo-status.mjs
```

## Estado em 2026-11-11 — pedido indisponível; próximo passo é o Suporte da Meta

Conferido no WhatsApp Manager pelo Chrome do fundador e pela API (log `orchestrator/logs/selo-whatsapp-2026-11-09.jsonl`):

- **Verificação em duas etapas não é mais um passo.** A Meta está aposentando o PIN para números elegíveis da Cloud API; para esses números a aba *Verificação em duas etapas* deixa de existir no WhatsApp Manager (é o nosso caso: não aparece em Perfil, em Mais, nem nas Configurações da conta). O PIN é exigido no registro do número na Cloud API, então o critério 4 está cumprido. Fonte: página de two-step verification da Cloud API.
- **O botão "Enviar solicitação" existe, mas está desabilitado**, com a dica: *"Pedidos de contas comerciais oficiais não estão disponíveis para sua empresa no momento. Verifique outra vez mais tarde."* A Meta não publica o motivo (lacuna).
- **A API tem `POST /{phone_number_id}/official_business_account`** (campos `business_website_url`, `primary_country_of_operation`, `primary_language`, `additional_supporting_information`, `supporting_links` 5–10). Script: `meta-selo-pedido.mjs` (simulação sem flag; `--apply` envia). Em 11/11, com a frase do fundador ("Enviar com França"), cinco variantes devolveram **HTTP 500, código 1, "An unknown error has occurred."** e `oba_status` seguiu `NOT_STARTED`. Nenhum pedido chegou a existir. A aresta GET do mesmo nome não existe para o nosso token; o estado se lê por `?fields=official_business_account`.
- Conclusão (fato): o pedido de OBA está indisponível para o portfólio, no painel e na API. Caminho que a página da Meta indica: **Suporte da Meta** (Meta Business Suite → Ajuda → Suporte, ou business.facebook.com/business-support-home), pedindo a verificação de elegibilidade. Texto do chamado: ver "Chamado ao Suporte" abaixo.

**Chamado aberto em 2026-11-11 pelo fundador: caso Meta `4757335437829700`** (ativo informado: "The World Keys", ID 937481542790891; a Meta ofereceu "Iniciar conversa"). Acompanhar em business.facebook.com/business-support-home. Quando a Meta liberar: `meta-selo-pedido.mjs --apply` ou o botão *Enviar solicitação*; conferir com `meta-selo-status.mjs`. Nota: a página de contato do Suporte congela o Chrome neste notebook quando automatizada; abrir à mão.

### Chamado ao Suporte (texto enviado no caso acima)

> Assunto: Official Business Account request unavailable for a fully eligible number
>
> Business portfolio: The World Keys (ID 1160127927797199), business verification: verified. WhatsApp Business Account ID 912548304699169, phone number ID 1042654062259988 (+55 21 96784-1007), Cloud API, live since September 2026, quality rating GREEN, display name "The World Keys" approved, two-step verification set at registration.
>
> In WhatsApp Manager → Phone numbers → Profile → Official business account, the "Submit request" button is disabled with the message "Official business account requests are not available for your business at this time". The API endpoint POST /{phone_number_id}/official_business_account returns HTTP 500, error code 1 ("An unknown error has occurred"), fbtrace_id AyoaD1nowswozcB5BbGHYka. oba_status stays NOT_STARTED.
>
> We meet all five published criteria. Could you confirm whether the number is eligible for the OBA application and enable the request, or tell us which criterion is missing? Website: https://theworldkeys.com. Primary country of operation: France. Thank you.

## Passo a passo (fundador, ~15 minutos, mais a espera da Meta)

Tudo em **business.facebook.com → WhatsApp Manager**, logado como administrador do portfólio "The World Keys".

### Passo 0 — nome que vai aparecer com o selo — **FEITO em 09/11/2026**

O nome aprovado era `The world keys`. Com a frase do fundador ("Sim, corrigir nome", log `orchestrator/logs/selo-whatsapp-2026-11-09.jsonl`), o pedido de troca para **`The World Keys`** foi enviado pela API (`POST /{phone_number_id}` com `new_display_name`). Estado lido logo depois: nome atual segue `APPROVED`, novo nome em `PENDING_REVIEW` — a Aria continua operando com o nome antigo até a Meta aprovar.

1. A Meta devolve a análise em geral em 1–2 dias (suposição, a partir de relatos de provedores; a Meta não publica prazo). Acompanhar com o script de status (linha "novo nome pedido").
2. Só siga ao passo 2 quando o script mostrar `"The World Keys": APPROVED` como nome de exibição — o critério 5 exige nome aprovado no momento do pedido.
3. Se a Meta recusar o novo nome, o antigo continua valendo e o pedido do selo pode ser feito com ele. (Suposição: trocar o nome depois do selo reabre a análise do nome; a página da Meta não diz nada sobre isso.)

Regra de segurança: o nome tem de ser o da marca ou da razão social, sem "Support", "Oficial", "Reservas" ou emoji — nomes genéricos ou diferentes do site são a causa comum de recusa de nome.

### Passo 1 — ligar a verificação em duas etapas (PIN de 6 dígitos)

1. WhatsApp Manager → **Números de telefone** → clique no número → **Configurações** → **Verificação em duas etapas**.
2. Se já estiver **Ativada**, nada a fazer. Se não, clique em **Ativar**, escolha um PIN de 6 dígitos e confirme.
3. Guarde o PIN **fora do OneDrive e fora do chat**: uma linha `META_PIN_2FA=…` em `C:\Users\bianc\.twk\meta.env` (a mesma pasta dos outros segredos). Esse PIN é exigido pela Meta para qualquer novo registro do número na Cloud API (por exemplo, se um dia o número migrar de app ou de servidor). Perder o PIN = ficar 7 dias sem conseguir registrar o número de novo.

### Passo 2 — enviar o pedido do selo

1. WhatsApp Manager → **Visão geral** → clique no número **+55 21 96784-1007**.
2. Em **Números de telefone → Perfil**, localize o bloco **Conta comercial oficial** e clique em **Enviar solicitação** (em inglês, *Submit Request*).
3. Se o botão **não aparecer** mesmo com os cinco critérios cumpridos, a página da Meta manda abrir um chamado no **Suporte da Meta** (Meta Business Suite → Ajuda → Suporte) dizendo que o portfólio está verificado, o nome aprovado, a 2FA ligada e que o botão de OBA não aparece. Não contratar "provedor de solução" (BSP) para isso: a página da Meta diz que o pedido direto é possível e a nossa conta é `ownership_type = SELF`.
4. Se um formulário pedir justificativa, descrever em uma frase: plataforma de reservas gastronômicas premium, atendimento a clientes e a restaurantes por este número, site `theworldkeys.com`. Nada de inflar notoriedade: a lista oficial de critérios **não** inclui "notoriedade" (a Meta retirou esse critério da página; guias antigos de provedores ainda o citam).

### Passo 3 — esperar e acompanhar

- O estado passa de `NOT_STARTED` para um estado de análise; conferir com o script acima ou no mesmo bloco do WhatsApp Manager. A Meta não publica prazo (relatos de provedores: dias a algumas semanas).
- Enquanto espera: **não** mudar o nome de exibição, **não** trocar o número, **não** deixar a qualidade cair (o critério 1 é avaliado no pedido). A Aria continua operando normalmente.
- **Aprovado:** `is_official_business_account = true`; o selo aparece sozinho nos chats, sem configuração nossa. Registrar em `orchestrator/logs/` e avisar Suporte/Comercial (os templates e o kit do Programa OUI podem citar "número verificado").
- **Recusado:** a Meta diz apenas que "não cumpre os requisitos neste momento", sem motivo detalhado, e **só aceita novo pedido 30 dias depois**. Antes de repetir: rodar o script, reconferir os cinco critérios, conferir se o site do portfólio é `theworldkeys.com` e se o nome legal do portfólio bate com os documentos da verificação. Nunca abrir um segundo portfólio ou segundo número para "tentar de novo" — isso é o que a Meta trata como contorno e pode derrubar a conta.

## O que NÃO fazer (segurança da conta)

- Não contratar serviço que "garante o selo": a Meta não tem canal pago para OBA, e o selo não pode ser comprado.
- Não assinar **Meta Verified** achando que é o selo: é outro produto, para o app WhatsApp Business, e não se aplica a número da Cloud API.
- Não gerar token, PIN ou documento no chat nem em arquivo dentro do OneDrive (regra de `docs/runbooks/segredos-fora-do-onedrive.md`).
- Não mexer no webhook, no token de sistema nem no app de desenvolvedor durante o processo: nada disso faz parte do pedido.

## Depois do selo

- Atualizar o rodapé dos e-mails e o botão de opt-in (n8n) para "WhatsApp verificado" só depois que `is_official_business_account = true` for lido pela API — nunca antes.
- O selo não aumenta limite de envio nem muda preço; isso vem da verificação do negócio (já feita) e da qualidade.
