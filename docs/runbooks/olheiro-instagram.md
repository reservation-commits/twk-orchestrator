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

## O que este agente nunca faz

Publicar, comentar, responder, mandar DM ou mexer no perfil. As permissões pedidas no passo 3 não incluem publicação
nem mensagens. Escrever na conta é outra fase, com aprovação do fundador.
