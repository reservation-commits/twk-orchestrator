# C2 — por que nenhum cliente tem opt-in de WhatsApp (22/10/2026)

## Fato, lido pela API do n8n em 22/10

O fluxo ativo **"1 - nova reserva (site novo)"** (id `ztI9ws9F6BAGJSGr`, última alteração **09/09/2026**) manda ao cliente o e-mail "Solicitação Enviada Usuário" com:

- o botão **"Follow my request"** → `theworldkeys.com/users/reservations` (a conta, atrás de login);
- o rodapé genérico "Message our concierge on WhatsApp" → `wa.me/5521967841007` sem mensagem pronta.

O botão da v20 ("Receive updates on WhatsApp", com a mensagem pronta e o código da reserva — `docs/notificacoes/templates/familia/wf1-solicitacao-enviada-cliente.v20-proposta.html`, linhas 66-76) **nunca entrou no fluxo**. A Aria v20 está no ar desde 05/10 esperando a primeira mensagem que esse botão provocaria; sem o botão, a mensagem nunca chega. Resultado medido: 0 clientes com opt-in, 168 mensagens de pendência mortas em `sem_opt_in` em 30 dias.

A Sentinela acusava isso desde 21/10 (`wa_optin_clientes`: "20 ou mais pedidos em 14 dias e nenhum cliente fez opt-in — o botão está no e-mail?"). A resposta é: não está.

## O que está pronto

`orchestrator/agents/notificacao-reserva/aplicar-botao-optin-n8n.cjs`

- **Dry-run** (padrão): lê o fluxo, mostra que o bloco da v20 entraria logo depois do botão "Follow my request" (+1.260 caracteres), nada gravado. Rodado em 22/10: ok.
- **`--apply`**: grava o fluxo pela API, relê e confere que o botão está lá, registra em `orchestrator/logs/audit-<dia>.jsonl`. Nada é removido do e-mail.

Alterar um fluxo em produção é mudança de configuração permanente: **só com o "pode aplicar" do fundador** no chat. Comando:

```bash
node orchestrator/agents/notificacao-reserva/aplicar-botao-optin-n8n.cjs --apply
```

## Como medir (sem instrumentar o clique)

- `aria_contact_consent` com `tipo = 'cliente'` e `whatsapp_reservas = true`: cada linha é um cliente que tocou no botão e enviou a mensagem. A Sentinela já vigia (`wa_optin_clientes`).
- Meta do plano: ≥ 30 % dos pedidos com opt-in em 30 dias.

## O que fica para depois

- Rastreio do clique pelo `/go` (utm `optin-<código>`): depende da decisão pendente `CMP-20260918-RASTREIO-CTA` (alterar o nó Redirecionar do fluxo `/go` para aceitar destino). Até lá o link é direto e a medida é o opt-in gravado, não o clique.
- O mesmo botão nos e-mails "Confirmação Automática Usuário" e "Restaurante Sem Email Usuário" do mesmo fluxo (hoje só o "Solicitação Enviada" o recebe). Mesma técnica; segunda rodada.
