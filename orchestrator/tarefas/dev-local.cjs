#!/usr/bin/env node
'use strict';
/**
 * Sobe o COMPASSO Tarefas LOCALMENTE para desenvolvimento e verificação visual (não é o caminho de produção).
 *   node orchestrator/tarefas/dev-local.cjs      → http://localhost:8790
 * Estado numa pasta temporária (nada do estado real é tocado); Márlon, Lucas e Julien entram com a senha "twk";
 * modelo só se ANTHROPIC_API_KEY estiver no ambiente (senão, etapas da heurística); sugestões lidas dos
 * arquivos reais do repositório, somente leitura.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const st = path.join(os.tmpdir(), 'twk-tarefas-dev-state');
fs.mkdirSync(st, { recursive: true });
process.env.PORT = process.env.PORT || '8790';
process.env.STATE_DIR = st;
process.env.NODE_ENV = 'development';
delete process.env.TAREFAS_DATABASE_URL;
console.log(`[dev-local] COMPASSO Tarefas em http://localhost:${process.env.PORT} · estado em ${st}`);
require('./server.js').iniciar();
