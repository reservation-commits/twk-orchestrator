'use strict';
/**
 * Conexão SOMENTE LEITURA ao twk_auth (papel twk_ro) com nova tentativa — biblioteca comum dos
 * agentes locais (Guardião, Ciclo do Cliente, Sentinela, Zelador).
 *
 * POR QUE EXISTE (2026-10-22, plano A1)
 * Em 19 e 20/10 as tarefas agendadas do Windows rodaram no instante em que o notebook ligou e
 * morreram em "timeout expired" (15 s de conexão) antes de o Wi-Fi subir. Minutos depois, a mesma
 * consulta respondia em 360 ms. Uma única tentativa transforma um atraso de rede num dia perdido.
 * Aqui: até 3 tentativas (0 s, 60 s, 180 s), cada uma com o mesmo limite de 15 s, e a sessão é
 * conferida como read-only antes de devolver o cliente.
 *
 * Também resolve credencial e biblioteca `pg` para a máquina do Orquestrador E para o container da
 * Central hospedada (onde não existe o repositório do DBA): DATABASE_URL_RO no ambiente vence tudo;
 * `pg` do próprio pacote vence os node_modules dos outros agentes.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

function urlRo() {
  if (process.env.DATABASE_URL_RO) return process.env.DATABASE_URL_RO.trim().replace(/^"|"$/g, '');
  const candidatos = [
    process.env.TWK_RO_ENV,
    path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local'),
  ].filter(Boolean);
  for (const f of candidatos) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(/DATABASE_URL_RO=(.+)/);
      if (m) return m[1].trim().replace(/^"|"$/g, '');
    } catch { /* próximo */ }
  }
  throw new Error('credencial somente leitura ausente: defina DATABASE_URL_RO ou TWK_RO_ENV (ou mantenha o .env.readonly.local do DBA)');
}

function pg() {
  const tentativas = [
    () => require('pg'),
    () => require(path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', 'node_modules', 'pg')),
    () => require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'node_modules', 'pg')),
    () => require(path.join(RAIZ, 'Agente Comercial', 'service', 'node_modules', 'pg')),
    () => require(path.join(RAIZ, 'orchestrator', 'command-center', 'node_modules', 'pg')),
  ];
  for (const t of tentativas) { try { return t(); } catch { /* próximo */ } }
  throw new Error('biblioteca pg não encontrada — rode npm install em orchestrator/command-center (ou na Aria)');
}

/** Esperas entre tentativas (ms). TWK_DB_RETRY_MS="0,60000,180000" sobrescreve (testes usam valores curtos). */
function esperas() {
  const v = process.env.TWK_DB_RETRY_MS;
  if (v) return v.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0);
  return [0, 60_000, 180_000];
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const transitorio = (e) => /timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|terminat|Connection terminated|server closed/i.test(String(e && e.message || e));

/**
 * Abre uma sessão read-only, com nova tentativa em falha transitória de rede.
 * Devolve o Client conectado (quem chama fecha com `end()`); lança depois da última tentativa.
 * `log` recebe uma linha por tentativa falhada — o chamador grava no audit se quiser.
 */
async function conectarRo(opts = {}) {
  const { Client } = pg();
  const waits = opts.esperas || esperas();
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  let ultimo = null;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i] > 0) await dormir(waits[i]);
    const c = new Client({
      connectionString: urlRo(),
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: opts.connectionTimeoutMillis || 15_000,
      statement_timeout: opts.statement_timeout || 50_000,
    });
    try {
      await c.connect();
      const who = await c.query("select current_user u, current_setting('default_transaction_read_only') ro");
      if (who.rows[0].ro !== 'on') { await c.end().catch(() => {}); throw new Error(`sessão não é read-only (user=${who.rows[0].u}) — abortando por segurança`); }
      if (i > 0) log(`conectou na tentativa ${i + 1} de ${waits.length}`);
      return c;
    } catch (e) {
      ultimo = e;
      try { await c.end(); } catch { /* já fechado */ }
      if (!transitorio(e) || i === waits.length - 1) break;
      log(`tentativa ${i + 1} de ${waits.length} falhou (${String(e.message).slice(0, 80)}) — nova tentativa em ${Math.round(waits[i + 1] / 1000)} s`);
    }
  }
  const err = new Error(`conexão read-only falhou após ${waits.length} tentativa(s): ${String(ultimo && ultimo.message || ultimo)}`);
  err.causa = ultimo;
  throw err;
}

/** Executa `fn(client)` numa sessão read-only e fecha sempre. */
async function comClienteRo(fn, opts) {
  const c = await conectarRo(opts);
  try { return await fn(c); } finally { await c.end().catch(() => {}); }
}

module.exports = { conectarRo, comClienteRo, urlRo, pg, esperas, RAIZ };
