/**
 * MAESTRO DB Exec — o braço de ESCRITA no banco (v4.3 "Domínio"), via DB Architect.
 * NUNCA chamado pelo modelo: quem dispara é o endpoint de decisão, depois do clique
 * do fundador no cartão de aprovação. A execução real acontece no DBA (que impõe
 * transação, backup dos dados antigos — old_data — e auditoria); a Central só orquestra.
 *
 * Camadas de segurança (defesa em profundidade — cada uma sozinha já barra o pior caso):
 *  1. Feature-flag: sem MAESTRO_DB_WRITE=on, toda escrita é recusada.
 *  2. Token DEDICADO de escrita (AGENT_DBA_WRITE_TOKEN), separado do de leitura (menor privilégio).
 *  3. Classificação da instrução: "dados" (UPDATE/INSERT) vs "destrutivo" (DELETE/DROP/TRUNCATE/DDL/published).
 *     Destrutivo exige confirmação tipada extra na UI (o servidor revalida o marcador).
 *  4. A execução delega ao endpoint auditado do DBA (/api/db mutate) — backup e rollback são de lá.
 *  5. Falhar alto: erro do DBA volta cru, a aprovação NÃO é consumida, nada é maquiado.
 */
const WRITE_ON = process.env.MAESTRO_DB_WRITE === 'on';
const TIMEOUT_MS = Number(process.env.DB_EXEC_TIMEOUT_MS || 20_000);

const baseUrl = () => process.env.AGENT_DBA_URL || '';
// Token de ESCRITA é separado do de leitura. Fallback explícito para o de leitura só se o
// fundador aceitar (mesma credencial) — mas o padrão é exigir o dedicado.
const writeToken = () => process.env.AGENT_DBA_WRITE_TOKEN || '';

function enabled() { return !!(WRITE_ON && baseUrl() && writeToken()); }
function statusLinha() {
  if (!WRITE_ON) return 'off (defina MAESTRO_DB_WRITE=on)';
  if (!baseUrl()) return 'off (AGENT_DBA_URL ausente)';
  if (!writeToken()) return 'off (AGENT_DBA_WRITE_TOKEN ausente — token de escrita dedicado)';
  return 'on (via DB Architect, com backup/auditoria do DBA)';
}

// ---------- classificação da instrução ----------
const RE_DESTRUTIVO = /\b(delete|drop|truncate|alter|create|grant|revoke|update\s+[^\s]+\s+set\b(?![\s\S]*\bwhere\b))\b/i;
const RE_PUBLISHED = /\bpublished\b/i;
const RE_MULTI = /;\s*\S/; // mais de uma instrução

function classificar(sql) {
  const s = String(sql || '').trim();
  if (!s) return { erro: 'SQL vazio' };
  if (RE_MULTI.test(s.replace(/;\s*$/, ''))) return { erro: 'apenas UMA instrução por operação (sem ";" no meio)' };
  const destrutivo = RE_DESTRUTIVO.test(s) || RE_PUBLISHED.test(s);
  // UPDATE sem WHERE é tratado como destrutivo (atinge a tabela toda) pela regex acima.
  return { tipo: destrutivo ? 'destrutivo' : 'dados' };
}

async function post(caminho, body) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(new URL(caminho, baseUrl()), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${writeToken()}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, texto: text.slice(0, 1500) };
  } catch (e) {
    return { ok: false, status: 0, texto: String(e && e.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : (e.message || e)).slice(0, 300) };
  } finally { clearTimeout(to); }
}

/**
 * Executa uma correção de dados no banco via DBA.
 * op: { sql, tipo, confirmacao_destrutiva }.
 * Retorna { ok, detalhe, tipo, backup, dba }.
 */
async function executar(op) {
  if (!WRITE_ON) return { ok: false, detalhe: 'escrita no banco desligada (MAESTRO_DB_WRITE≠on)' };
  if (!baseUrl()) return { ok: false, detalhe: 'AGENT_DBA_URL não configurada' };
  if (!writeToken()) return { ok: false, detalhe: 'AGENT_DBA_WRITE_TOKEN não configurado (token de escrita dedicado)' };

  const cls = classificar(op && op.sql);
  if (cls.erro) return { ok: false, detalhe: cls.erro };
  if (cls.tipo === 'destrutivo' && op.confirmacao_destrutiva !== 'CONFIRMAR') {
    return { ok: false, detalhe: 'operação destrutiva (DELETE/DDL/UPDATE-sem-WHERE/published) exige confirmação tipada "CONFIRMAR"', tipo: 'destrutivo' };
  }

  // Delega ao endpoint auditado do DBA. Contrato (auditoria 18/08): /api/db POST action "mutate",
  // que aplica em transação, grava old_data (backup) e audita. Enviamos trace/motivo para o log de lá.
  const r = await post('/api/db', {
    action: 'mutate',
    sql: op.sql,
    reason: op.motivo || 'correção aprovada pelo fundador na Central',
    trace_id: op.trace_id,
    source: 'maestro-central',
  });

  if (!r.ok) {
    return { ok: false, detalhe: `DBA recusou (HTTP ${r.status}): ${r.texto}`, tipo: cls.tipo, dba: r.json || r.texto };
  }
  // Sucesso: repassa o que o DBA devolveu (linhas afetadas, backup/old_data, id de auditoria)
  const d = r.json || {};
  return {
    ok: true, tipo: cls.tipo,
    detalhe: d.rowCount != null ? `${d.rowCount} linha(s) afetada(s)` : 'aplicado',
    backup: d.old_data || d.backup || d.oldData || null,
    auditoria_id: d.audit_id || d.auditId || null,
    dba: d,
  };
}

module.exports = { enabled, statusLinha, classificar, executar };
