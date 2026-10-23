#!/usr/bin/env node
'use strict';
/**
 * Sobe a Central LOCALMENTE para desenvolvimento e verificação visual (não é o caminho de produção).
 *   node orchestrator/command-center/dev-local.cjs      → http://localhost:8788
 * Estado numa pasta temporária (nada do estado real é tocado), sem CENTER_TOKEN (dev aberto), leitura do banco
 * pela credencial twk_ro do DBA (regencia/db.js já a encontra), rotinas e Regência desligadas.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const st = path.join(os.tmpdir(), 'twk-central-dev-state');
fs.mkdirSync(st, { recursive: true });
process.env.PORT = process.env.PORT || '8788';
process.env.STATE_DIR = st;
process.env.NODE_ENV = 'development';
delete process.env.CENTER_TOKEN;
process.env.ROTINAS_ENABLED = 'off';
process.env.REGENCIA_ENABLED = 'off';
process.env.MAESTRO_TOOLS = 'off';
console.log(`[dev-local] Central em http://localhost:${process.env.PORT} · estado em ${st}`);
require('./server.js');
