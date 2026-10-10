#!/usr/bin/env node
'use strict';
/**
 * PANORAMA — exporta, da máquina do Orquestrador, as métricas que a Central hospedada não consegue
 * calcular (porta de qualidade, avaliações, sentinela, Guardião, zelador, compromissos, convites,
 * auditoria). Grava orchestrator/state/plataforma-local.json; push-state.ps1 envia esse arquivo.
 *
 *   node orchestrator/command-center/plataforma-exportar.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { exportarLocais } = require('./plataforma.js');
const stateDir = path.join(__dirname, 'state');
const saida = path.resolve(__dirname, '..', 'state', 'plataforma-local.json');
const pacote = exportarLocais(stateDir);
fs.writeFileSync(saida, JSON.stringify(pacote), 'utf8');
const ok = Object.values(pacote.metricas).filter((m) => m.s === 'ok').length;
console.log(`plataforma-local.json: ${ok} de ${Object.keys(pacote.metricas).length} métricas com leitura · ${path.relative(process.cwd(), saida)}`);
