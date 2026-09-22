# Biblioteca TWK — site dos planos e documentos

Site estático, com senha, servido por um Node sem dependências (`server.js`). Os documentos vivem em `docs/agentes/`
(são também a fonte dos artifacts); `documentos.json` diz quais entram no site e com que estado.

## Atualizar o site (local)

```bash
node docs/site/montar.js
```

Gera `docs/site/public/` (índice + cópias dos documentos) e o zip `docs/site/twk-biblioteca-<carimbo>.zip`.
Para conferir antes de publicar: `node docs/site/server.js` e abrir http://localhost:8080 (sem senha em desenvolvimento).

## Idiomas (português e francês)

O site sai nos dois idiomas: `/` em português e `/fr/` em francês, com o seletor PT · FR no índice e uma barra fixa em cada documento.
A tradução dos documentos é feita por `traduzir.js`, nesta ordem de preferência:

1. tradução manual em `docs/agentes/<slug>.fr.html` (sempre vence; hoje: o Plano Reserva Direta);
2. cache em `docs/site/traducoes/`, reutilizado enquanto o original não mudar;
3. chamada à Claude (`claude-opus-5`) na hora de montar, guardada no cache. Exige `ANTHROPIC_API_KEY` no ambiente
   ou em `~/.twk/regencia.env` (a mesma chave que a Aria e o MAESTRO usam no Easypanel).

Toda tradução automática passa por uma verificação antes de entrar: mesma estrutura de páginas (tags) e os mesmos
números do original. Reprovou, o montador tenta mais uma vez com o motivo; reprovou de novo, a montagem falha.

- `node docs/site/montar.js` → traduz o que falta (custa API só para documentos novos ou alterados);
- `node docs/site/montar.js --sem-traducao` → não chama a API; documento sem tradução ganha em `/fr/` uma página
  "Traduction en préparation" que leva ao original, e o índice marca "en portugais";
- `node docs/site/montar.js --forcar-traducao` → retraduz tudo.

Títulos e descrições do índice em francês vêm de `documentos.json` (`titulo_fr`, `descricao_fr`).

## Publicar no Easypanel (primeira vez)

1. **Create Service → App**, nome `biblioteca`. Em **Fonte**: **Upload** do zip gerado. Em **Build**, escolher **Dockerfile** (caminho `Dockerfile`). O pacote também traz `package.json`, então o modo automático (Nixpacks) funciona, mas o Dockerfile é o caminho testado.
2. **Environment:** `DOCS_USER`, `DOCS_PASS` (senha forte), `NODE_ENV=production`, `PORT=8080`. Sem usuário e senha o site responde 503 de propósito.
3. **Domains:** adicionar `docs.theworldkeys.com` (ou o domínio automático do Easypanel), porta interna `8080`, HTTPS ligado.
4. **Deploy.** Conferir `https://<dominio>/health` → `{"ok":true,"build":"...","documentos":4,"auth":"senha"}`.

## Publicar uma versão nova

`node docs/site/montar.js` → subir o zip novo no serviço → **Redeploy**. O `build` em `/health` e no rodapé do índice muda; se não mudou, o deploy não pegou.

## Regras

- Documento listado em `documentos.json` que não existe derruba a montagem (falhar alto).
- Nada de dado pessoal nos documentos publicados: nomes de clientes só como exemplo fictício e marcado.
- A senha é compartilhada com quem precisa ler (fundador, desenvolvedor). Trocar em `Environment` e Redeploy.

## Lição de 14/09

O primeiro zip foi feito com `Compress-Archive` (PowerShell), que grava os caminhos com barra invertida
(`public\index.html`). No Linux do Easypanel isso vira um arquivo chamado "public\index.html" na raiz, a pasta
`public` não existe, o `COPY public` falha e o serviço fica "not reachable". O montador usa o `tar.exe` do Windows
(`System32`), que gera barras normais; o tar do Git Bash não serve (trata `C:` como servidor remoto).
