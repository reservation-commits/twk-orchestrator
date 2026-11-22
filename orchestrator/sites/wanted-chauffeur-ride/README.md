# Wanted Chauffeur · site de reserva (`/ride`)

Página de reserva do Wanted Chauffeur (Tesla Model X em Toulouse), em francês. HTML, CSS e JavaScript puros: **sem build,
sem framework, sem dependências**. Qualquer hospedagem de arquivos estáticos serve. A página conversa com a **Central**
(o servidor da The World Keys no Easypanel) por duas rotas públicas: a agenda e a gravação da reserva.

Separado em pastas em 22/11/2026. Antes disso a página morava dentro da Central (`command-center/public/ride/`), com o estilo
embutido no HTML. Esta pasta é agora a única cópia: a Central serve exatamente estes arquivos em `/ride`.

## Estrutura

```
wanted-chauffeur-ride/
├── README.md               este arquivo
├── package.json            só o script "dev" (nenhuma dependência)
├── servidor-dev.cjs        servidor local: página em /ride/ + API simulada (ou repasse para a Central)
└── public/                 ← é isto que se hospeda
    ├── index.html          a página (seções, formulário); sem script nem estilo embutido
    ├── css/
    │   ├── base.css        cores (:root), fontes, reset, botões, quadro de HQ
    │   ├── cabecalho.css   barra fixa e menu
    │   ├── secoes.css      hero, missões, a bordo, Toulouse, hotéis, perguntas, rodapé
    │   ├── reserva.css     formulário, faixa de dias, horários, prévia do WhatsApp
    │   └── responsivo.css  celular e tablet (carregado por último)
    ├── js/                 módulos ES (type="module"), um papel por arquivo
    │   ├── main.js         ponto de entrada
    │   ├── config.js       ← o único arquivo de configuração (endereço da API, WhatsApp)
    │   ├── precos.js       tabela de preços (tem que bater com o servidor; um teste confere)
    │   ├── datas.js        datas e horas em Paris, AM/PM, francês
    │   ├── disponibilidade.js  lê a agenda da Central e diz se um horário está livre
    │   ├── formulario.js   preço, mensagem, faixa de dias, horários, gravação
    │   └── menu.js         menu do celular
    └── img/
        ├── bd.webp         a ilustração (hero, a bordo, hotéis)
        └── favicon.svg
```

**A página mora no caminho `/ride/`.** Todos os arquivos são citados como `/ride/css/…`, `/ride/js/…`, `/ride/img/…`.
Assim ela funciona tanto em `theworldkeys.com/ride` quanto em `theworldkeys.com/ride/`. Para mudar o prefixo, troque
`/ride/` em todo o `index.html` e no `servidor-dev.cjs` (os módulos em `js/` se importam por caminho relativo e não mudam).

## Rodar no computador

```
cd orchestrator/sites/wanted-chauffeur-ride
npm run dev
```

Abre em `http://localhost:8792/ride/` com a **API simulada**: uma corrida confirmada depois de amanhã às 9:00 PM, um dia de
folga daqui a 4 dias, antecedência de 2 h. Nada sai, a reserva fica só na memória e aparece no terminal.

Para falar com a Central de verdade (as reservas ficam gravadas e o Julien é avisado; use com cuidado):

```
CENTRAL_URL=https://<endereço da Central> npm run dev
```

## Hospedar: três formas

| Forma | O que fazer | Quando usar |
|---|---|---|
| **1. A Central serve (já pronto)** | Deploy da Central (build 4.13.0 ou depois). A página fica em `https://<central>/ride`. No site principal (Next.js), três rewrites para a Central: `/ride`, `/ride/:path*` e `/api/chauffeur/:path*` | Recomendada: uma cópia só, deploy junto com a API |
| **2. Dentro do Next.js** | Copiar `public/` para `public/ride/` do projeto Next. Rewrite `/ride` → `/ride/index.html` e `/api/chauffeur/:path*` → Central | Se o dev preferir o site todo no mesmo deploy |
| **3. Hospedagem estática à parte** | Publicar `public/` em qualquer host estático, mantendo o caminho `/ride/`. Em `js/config.js`, `api: 'https://<central>'`. Na Central, o domínio da página em `CHAUFFEUR_ORIGINS` | Subdomínio próprio, CDN, testes |

Rewrites da forma 1 no `next.config.js`:

```js
async rewrites() {
  const CENTRAL = process.env.CENTRAL_URL; // https://<endereço da Central>
  return [
    { source: '/ride', destination: `${CENTRAL}/ride` },
    { source: '/ride/:path*', destination: `${CENTRAL}/ride/:path*` },
    { source: '/api/chauffeur/:path*', destination: `${CENTRAL}/api/chauffeur/:path*` },
  ];
}
```

Nas formas 1 e 2 `config.js` fica com `api: ''` (mesmo domínio). O link de confirmação do Julien (`/c/WTD-…`) aponta
direto para a Central e não precisa de rewrite.

## O que configurar

`public/js/config.js`:

| Campo | Para quê |
|---|---|
| `api` | Endereço da Central. Vazio = mesmo domínio da página |
| `whatsapp`, `whatsappExibido` | Número que recebe a mensagem pronta (hoje o do Julien, +33 7 81 93 72 70) |
| `diasNaFaixa` | Quantos dias a faixa de dias mostra (14) |
| `passoMin`, `horaPadrao` | Horários de 5 em 5 minutos, 9:00 PM marcado (decisão do fundador: sempre AM/PM) |

Preços: `public/js/precos.js`, tabela aprovada em 16/11/2026. Mudou o preço? Mude também `PRECO_CENT` em
`orchestrator/agents/wanted-chauffeur/reservas.js` (é o valor que o servidor grava). O teste `test/site.test.js` falha se divergirem.

## A API (contrato)

### `GET /api/chauffeur/disponibilidade?de=AAAA-MM-DD&dias=N` (pública)

`de` padrão hoje, `dias` de 1 a 62 (padrão 14). Resposta, com horas em **minutos desde a meia-noite, hora de Paris**:

```json
{
  "fuso": "Europe/Paris", "hoje": "2026-11-22", "horizonte": "2027-02-20",
  "antecedencia_min": 120, "folga_min": 30, "passo_min": 5,
  "duracoes_min": { "transfer": 90, "mad": 120, "night": 60, "game": 180, "soiree": 300 },
  "dias": [
    { "data": "2026-11-24", "fechado": false, "ocupado": [[1230, 1440]] },
    { "data": "2026-11-26", "fechado": true,  "ocupado": [[0, 1440]] }
  ]
}
```

Um horário `h` está livre para um produto de duração `d` quando `[h, h + d)` não encosta em nenhuma faixa `ocupado` do dia
(e do dia seguinte, se passar da meia-noite). `disponibilidade.js` já faz essa conta. A resposta nunca diz por que está
ocupado: nem nome, nem código, nem motivo. Cache de 30 segundos na Central.

### `POST /api/chauffeur/reserva` (pública)

Corpo JSON: `codigo` (`WTD-<origem>-XXXX`), `produto` (`transfer|mad|night|game|soiree`), `data`, `hora` (`"9:00 PM"`),
`pessoas` (1–6), `horas` (MAD, 2–12), `idioma`, `imagens` (`ok|privadas`), `nome` (obrigatório: quem embarca), `whatsapp`,
`partida`, `destino`, `recado`.

| Resposta | Quando |
|---|---|
| `201` | gravada; a Central avisa o Julien no WhatsApp |
| `200` `repetido: true` | o mesmo código já existia (reenvio) |
| `400` | campo inválido (`error` diz qual) |
| `403` | origem fora de `CHAUFFEUR_ORIGINS` |
| `409` + `motivo` | agenda: `ocupado`, `dia_fechado`, `antecedencia`, `passado`, `horizonte` |
| `429` | mais de 30 pedidos por hora do mesmo endereço |

A Central confere a agenda de novo ao gravar: o que a página pinta é ajuda, a regra está no servidor.

### Com a chave da Central (painel `/chauffeur`, cabeçalho `X-Center-Key`)

`GET /api/chauffeur/agenda?dias=14` (agenda com códigos e motivos), `GET|POST /api/chauffeur/bloqueios`,
`DELETE /api/chauffeur/bloqueios/<id>`. No painel `/chauffeur`, seção **Agenda**, o Márlon ou o Julien fecham um dia ou uma
faixa (folga, garagem, viagem).

## Regras da agenda

- Um carro, um motorista. Ocupa a agenda: corrida **confirmada** (duração do produto + 30 min antes e depois) e bloqueio.
- Pedido ainda sem resposta **não** ocupa: dois clientes podem pedir o mesmo horário, e o Julien escolhe.
- Pedido só a partir de agora + 2 h, e até 90 dias à frente.
- Durações (suposição minha, a confirmar com o Julien): Transfer 1 h 30, Night Ride 1 h, Game Night 3 h, Soirée 5 h, MAD as horas pedidas.
- Tudo ajustável na Central: `CHAUFFEUR_FOLGA_MIN`, `CHAUFFEUR_ANTECEDENCIA_MIN`, `CHAUFFEUR_HORIZONTE_DIAS`,
  `CHAUFFEUR_DURACOES="transfer=90,night=60,game=180,soiree=300"`.

**Por que não uma API de terceiros.** As reservas já moram na Central, então a agenda sai de lá sem custo, sem conta nova e
sem mandar dado de cliente para fora. Se o Julien passar a usar o Google Agenda para a vida pessoal, dá para somar os
horários ocupados dele como mais uma fonte (API de free/busy do Google, só leitura). Não está ligado.

## Antes de publicar

- Rodapé: "Mentions légales" e "Conditions de réservation" ainda são links vazios (fundador e advogado).
- `CHAUFFEUR_ORIGINS` na Central com o domínio onde a página roda, se não for theworldkeys.com.
- Teste de ponta a ponta: pedido com o seu WhatsApp → aparece em `/chauffeur` → o horário fica livre até alguém confirmar.

## Testes

Em `orchestrator/agents/wanted-chauffeur`: `node --test "test/*.test.js"` (inclui `site.test.js` e `disponibilidade.test.js`).
Em `orchestrator/command-center`: `node --test "regencia/test/chauffeur.test.js"`. Os dois estão na Porta de Qualidade.
