# Ligar o Olheiro do Instagram (@wantedchauffeur)

O Olheiro lê a conta uma vez por dia e só lê. Ligar é entregar a ele uma chave de leitura da conta. Leva uns
20 minutos, quase tudo no painel da Meta.

**Antes de começar:** a conta @wantedchauffeur precisa ser profissional (Criador ou Empresa). No aplicativo do
Instagram: Configurações, Tipo de conta e ferramentas, Mudar para conta profissional.

Ligar é colocar um fluxo novo em operação: pela constituição, é decisão do fundador. Fazer os passos abaixo é a
aprovação. Registre a frase no fim (passo 6).

## Qual caminho

| | Caminho A · login do Instagram | Caminho B · login pelo Facebook |
|---|---|---|
| Precisa de Página do Facebook | não | sim, ligada à conta |
| Chave vence | a cada 60 dias (renova com um comando) | não vence (usuário do sistema) |
| Números da própria conta | todos | todos |
| Números de outras contas (referências) | não | sim |
| Recomendação | **começar por aqui** | quando quiser as contas de referência |

## Caminho A · login do Instagram

1. **Abra o app da Meta.** Em developers.facebook.com, Meus apps. Pode usar o app do WhatsApp ou criar um novo do
   tipo Empresa. Em Adicionar produto, escolha **Instagram** e depois **Configuração da API com login do Instagram**.
2. **Ponha a conta como testadora.** Em Funções do app, Testadores do Instagram, adicione @wantedchauffeur. No
   aplicativo do Instagram, aceite o convite em Configurações, Apps e sites, Convites de testador.
   Pronto quando: a conta aparece como testadora aceita no painel.
3. **Gere a chave.** Em Gerar tokens de acesso, clique em Adicionar conta, entre com @wantedchauffeur e autorize
   estas três permissões: `instagram_business_basic`, `instagram_business_manage_insights`,
   `instagram_business_manage_comments`. Copie a chave e o número da conta que aparece ao lado (é o `IG_USER_ID`).
   Não cole a chave em chat, e-mail, card nem arquivo do OneDrive.
4. **Ponha no Easypanel, serviço da Central** (Environment), e clique em Deploy:

   ```
   IG_ACCESS_TOKEN=<a chave>
   IG_USER_ID=<o número da conta>
   IG_TOKEN_EXPIRA_EM=<hoje + 60 dias, AAAA-MM-DD>
   ```

   `ROTINAS_ENABLED=on` já deve estar lá.
5. **Rode a primeira leitura.** Na Central, com a chave da Central:

   ```bash
   curl -X POST -H "X-Center-Key: <chave da Central>" "https://<central>/api/rotinas/run?so=olheiro-instagram"
   curl -H "X-Center-Key: <chave da Central>" "https://<central>/api/instagram"
   ```

   Pronto quando: a segunda chamada mostra `"username": "wantedchauffeur"` e o número de seguidores.
6. **Ligue o chat.** No Easypanel, serviço do COMPASSO, confira `CENTER_URL` e `CENTER_TOKEN` (já usados pelas
   sugestões) e faça Deploy. No claude.ai, em Configurações, Conectores, abra o COMPASSO Tarefas e atualize as
   ferramentas. Pronto quando: as cinco ferramentas `instagram_*` aparecem.
   Registre a aprovação em `orchestrator/logs/`, com a data e a frase "ligar o Olheiro do Instagram".

## Aviso ao Julien no WhatsApp (pedido de reserva sem resposta há 30 min)

Decisão do fundador em 14/11. A Central roda uma vigia de comentários a cada 5 minutos. Quando um comentário que
pede preço, data ou reserva fica 30 minutos sem resposta da conta, a Aria manda ao Julien, em francês, a frase
« Il y a une demande de réservation sans réponse sur ce post : » com o link do post. Cada pedido gera um aviso só.
Pedido de mais de 24 h não gera aviso, para que ligar o Olheiro não dispare uma rajada de atrasos antigos.

**Estado em 16/11:** código commitado nos dois repositórios (raiz e Aria v27); pacote
`Agente de Suporte e Concierge/aria_agent_whatsapp-2026-11-16-v27.zip` pronto; template `twk_team_alert` (fr)
**aprovado pela Meta**, porém como MARKETING (ver "Categoria do template", abaixo). Nada disso está no ar ainda.

### Ordem de ligação (faça nesta ordem; cada passo diz como saber que ficou pronto)

1. **Olheiro lendo a conta.** Passos 1 a 5 do Caminho A, acima. Pronto quando `GET /api/instagram` da Central
   mostra `"username": "wantedchauffeur"`. Sem isso, não há comentário para vigiar.
2. **Segredo do aviso.** Na máquina local, gere e guarde fora do OneDrive (por exemplo em `~/.twk/aria-equipe.env`):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. **Aria v27 no ar.** No Easypanel, serviço da Aria: suba o zip da v27 e acrescente ao Environment:

   ```
   TEAM_ALERT_SECRET=<o segredo do passo 2>
   TEAM_ALERT_WHATSAPP=julien=<número do Julien em +33…, sem espaços>
   TEAM_ALERT_TEMPLATE=twk_team_alert
   TEAM_ALERT_LOCALE=fr
   ```

   Deploy. Pronto quando `/health` da Aria mostra a versão `2026-11-14-v27-alerta-equipe-instagram`,
   `"alertaEquipe": true` e `"alertaEquipePessoas": ["julien"]`. Se `alertaEquipe` vier `false`, falta uma das
   quatro variáveis ou o número não está em formato internacional.
4. **Teste do aviso antes de ligar a vigia.** Da máquina local, um pedido de teste direto à Aria (troque o segredo):

   ```bash
   curl -X POST "https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host/webhook/alerta-equipe" -H "content-type: application/json" -H "x-aria-secret: <o segredo>" -d "{\"destinatario\":\"julien\",\"sistema\":\"Test The World Keys\",\"situacao\":\"Message de test : si tu lis ceci, le canal fonctionne. Rien à faire.\",\"evento\":\"teste-2026-11-16\"}"
   ```

   Pronto quando a resposta é `{"ok":true,"desfecho":"enviado"}` **e o Julien confirma que recebeu**. Respostas
   possíveis: `404` = segredo não configurado na Aria; `401` = segredo diferente; `destinatario_desconhecido` =
   `TEAM_ALERT_WHATSAPP` sem o nome julien; `meta_recusou` = template ou idioma errados na Aria; `ja_enviado` =
   repetiu o mesmo `evento` em 24 h (troque o texto depois de `teste-`).
5. **Central com o segredo.** No Easypanel, serviço da Central: `ARIA_TEAM_ALERT_SECRET=<o mesmo segredo>`. Deploy.
   Pronto quando `GET /api/rotinas` (com `X-Center-Key`) mostra `vigia_instagram.aviso_ligado: true` e, uns minutos
   depois, `vigia_instagram.ultima.exit: 0`.
6. **Prova real.** Peça a alguém de confiança para comentar num post recente « C'est combien pour samedi ? » e não
   responda. Entre 30 e 35 minutos depois, o Julien recebe o aviso com o link do post. Depois responda ao comentário
   pela conta: a vigia seguinte vê a resposta e o pedido sai da fila.
7. **Registre a aprovação** em `orchestrator/logs/olheiro-instagram-<data>.jsonl` com a frase e a data.

Opcionais na Central: `OLHEIRO_LIMITE_RESERVA_MIN` (padrão 30), `OLHEIRO_VIGIA_MIN` (padrão 5), `OLHEIRO_AVISAR`
(padrão julien), `OLHEIRO_AVISO_IDIOMA=pt` (volta à frase em português), `OLHEIRO_ARIA_URL` (padrão: o endereço da
Aria que a Regência já usa).

O número do Julien fica só no ambiente da Aria. A Central e o Olheiro mandam o nome "julien", nunca o número, e a
Aria só aceita nomes da lista. A Aria tem teto de 12 avisos por pessoa por hora.

### Categoria do template

A Meta aprovou o `twk_team_alert` como **MARKETING**, apesar do pedido em UTILITY. Funciona, mas: custa o preço de
conversa de marketing, e mensagens de marketing têm um limite por destinatário que a Meta pode aplicar **descartando
o aviso sem erro** (código 131049 no rastreio de entrega). **Decisão do fundador em 16/11: ficar com o
`twk_team_alert` como está.** A segunda redação `twk_team_pending_request`
(`docs/notificacoes/templates-meta-v6b-equipe-fr-utility-2026-11-16.md`) fica guardada, não enviada; se um dia um
aviso for descartado com 131049, ela é o plano B: enviar à Meta e, aprovada como UTILITY, trocar
`TEAM_ALERT_TEMPLATE` na Aria. O rastreio de entrega (`aria_delivery_status`, destinatário "operador") é onde o
descarte apareceria; a Sentinela lê essa tabela.

## Renovar a chave (Caminho A, a cada 60 dias)

O relato avisa 10 dias antes. Na máquina local, com a chave atual em `~/.twk/instagram.env` (`IG_ACCESS_TOKEN=…`):

```bash
node orchestrator/agents/olheiro-instagram/renovar-chave.js
```

Troque `IG_ACCESS_TOKEN` e `IG_TOKEN_EXPIRA_EM` no Easypanel e faça Deploy. Se a chave já venceu, volte ao passo 3.

## Caminho B · login pelo Facebook (para as contas de referência)

1. Ligue @wantedchauffeur a uma Página do Facebook (Central de Contas da Meta).
2. No Gerenciador de Negócios, crie um **usuário do sistema** com acesso ao app e à Página, e gere um token com
   `instagram_basic`, `instagram_manage_insights`, `instagram_manage_comments`, `pages_show_list`,
   `pages_read_engagement` e `business_management`. Esse token não vence.
3. O `IG_USER_ID` é o `instagram_business_account` da Página (`GET /<id da página>?fields=instagram_business_account`).
4. No Easypanel da Central: `IG_LOGIN=facebook`, `IG_ACCESS_TOKEN`, `IG_USER_ID`, e as contas de referência em
   `IG_CONCORRENTES=conta1,conta2,conta3` (só contas profissionais; sem @). Apague `IG_TOKEN_EXPIRA_EM`.

## Quando algo falha

| Sinal | O que é | O que fazer |
|---|---|---|
| Relato `sem_credencial` | chave ausente, vencida ou sem permissão | refazer o passo 3 ou renovar |
| Lacuna "métricas recusadas pela Meta" | a Meta mudou a lista de métricas | nada urgente: o resto segue; atualizar `METRICAS` em `coletar.js` |
| Lacuna "público … 100 seguidores" | regra da Meta | some sozinha com 100 seguidores |
| Sentinela: rotina `olheiro-instagram` falhou | erro na rodada | ler `logs/tarefas/olheiro-instagram-<dia>.log` no volume |
| Ferramentas `instagram_*` dizem "não está ligado" | COMPASSO sem `CENTER_URL` | passo 6 |
| Lacuna "aviso ao Julien desligado" | falta `ARIA_TEAM_ALERT_SECRET` na Central | seção do aviso, passo 3 |
| Lacuna "aviso … não saiu (meta_recusou)" | template de alerta não aprovado no idioma configurado | conferir `OPERATOR_ALERT_TEMPLATE` e `OPERATOR_ALERT_LOCALE` na Aria |
| Ação "vigia … falhou 3 vezes seguidas" | a vigia de comentários está quebrando | ler `logs/tarefas/olheiro-vigia-<dia>.log` no volume |

## O que este agente nunca faz

Publicar, comentar, responder, mandar DM ou mexer no perfil. As permissões pedidas no passo 3 não incluem publicação
nem mensagens. Escrever na conta é outra fase, com aprovação do fundador.
