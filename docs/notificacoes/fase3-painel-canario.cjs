/**
 * Painel do canário — notificação transacional de reserva por WhatsApp.
 * SOMENTE LEITURA (credencial twk_ro). Não escreve nada, não envia nada.
 *
 * Responde, em 20 segundos, as cinco perguntas que decidem seguir ou parar:
 *   1. de cada 100 eventos, quantos viraram mensagem — e por que os outros não?
 *   2. a trava de telefone está calibrada ou engolindo cliente legítimo?
 *   3. quantos pediram para sair?
 *   3. algum envio falhou na Cloud API?
 *   5. algum critério de parada foi atingido?
 *
 * USO:
 *   cd "Agente Gerenciador do Banco de Dados/twk-db-agent"
 *   NODE_PATH="$PWD/node_modules" node ../../docs/notificacoes/fase3-painel-canario.cjs \
 *     "$PWD/.env.readonly.local" [dias]      # dias: janela, padrão 7
 *
 * Critérios de parada em docs/notificacoes/fase3-plano-canario.md.
 */
const fs = require("fs");
const { Client } = require("pg");

const envPath = process.argv[2];
const DIAS = Number(process.argv[3] ?? 7);
const url = fs.readFileSync(envPath, "utf8").split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL_RO=")).slice("DATABASE_URL_RO=".length).trim().replace(/^["']|["']$/g, "");

// ── Critérios de parada (o plano é a fonte; aqui é a aritmética) ────────────
const PARADA = {
  falhaEnvioPct: 5,      // > 5% dos envios tentados falhando na Cloud API
  optOutPct: 3,          // > 3% dos que receberam pedindo para sair
  naoEnviavelPct: 35,    // > 35% barrados pela trava: a base é pior que o medido
  findingsPorDia: 3,     // > 3 escalações automáticas por dia
};

const pct = (n, d) => (d === 0 ? 0 : (n * 100) / d);
const barra = (n, max, largura = 28) =>
  "█".repeat(Math.max(0, Math.round((n / Math.max(max, 1)) * largura)));

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const janela = `created_at >= NOW() - interval '${DIAS} days'`;
  const alertas = [];

  // A tabela só existe depois do deploy com as migrations novas.
  const existe = await c.query(
    `SELECT to_regclass('public.aria_outbound_log') IS NOT NULL AS ok`,
  );
  if (!existe.rows[0].ok) {
    console.log("\naria_outbound_log ainda não existe — suba o deploy com as migrations antes do canário.");
    await c.end();
    return;
  }

  console.log(`\n${"═".repeat(64)}`);
  console.log(`  CANÁRIO · notificação de reserva · últimos ${DIAS} dias`);
  console.log(`  ${new Date().toISOString()}`);
  console.log(`${"═".repeat(64)}`);

  // ── 1. Desfechos ──────────────────────────────────────────────────────────
  const d = await c.query(
    `SELECT desfecho, count(*)::int n FROM public.aria_outbound_log
      WHERE ${janela} GROUP BY 1 ORDER BY 2 DESC`,
  );
  const total = d.rows.reduce((s, r) => s + r.n, 0);
  const de = (k) => d.rows.find((r) => r.desfecho === k)?.n ?? 0;

  console.log(`\n── desfechos (${total} eventos) ──`);
  if (total === 0) console.log("  nada registrado na janela");
  for (const r of d.rows) {
    console.log(`  ${r.desfecho.padEnd(22)} ${String(r.n).padStart(5)}  ${pct(r.n, total).toFixed(1).padStart(5)}%  ${barra(r.n, total)}`);
  }

  const enviados = de("enviado");
  const naoEnviavel = de("telefone_nao_enviavel") + de("sem_telefone");
  const falhas = de("falha_envio");
  const tentados = enviados + falhas;

  // ── 2. A trava de telefone ────────────────────────────────────────────────
  const q = await c.query(
    `SELECT qualidade_telefone, count(*)::int n FROM public.aria_outbound_log
      WHERE ${janela} AND qualidade_telefone IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC`,
  );
  console.log(`\n── trava de telefone ──`);
  if (q.rows.length === 0) console.log("  sem dados");
  for (const r of q.rows) {
    console.log(`  ${String(r.qualidade_telefone).padEnd(22)} ${String(r.n).padStart(5)}  ${pct(r.n, total).toFixed(1).padStart(5)}%`);
  }
  console.log(`\n  Comparar com o medido em 21/09: 81,2% ENVIAVEL entre quem reserva.`);
  console.log(`  Desvio grande para baixo = a base piorou, ou a trava está severa demais.`);

  // ── 3. Idioma e país de quem recebeu ──────────────────────────────────────
  const loc = await c.query(
    `SELECT coalesce(locale,'?') locale, coalesce(pais,'?') pais, count(*)::int n
       FROM public.aria_outbound_log
      WHERE ${janela} AND desfecho = 'enviado'
      GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10`,
  );
  console.log(`\n── quem recebeu (top 10) ──`);
  if (loc.rows.length === 0) console.log("  nenhum envio ainda");
  for (const r of loc.rows) console.log(`  ${r.pais.padEnd(4)} ${r.locale.padEnd(8)} ${String(r.n).padStart(5)}`);

  // ── 4. Opt-out ────────────────────────────────────────────────────────────
  const opt = await c.query(
    `SELECT count(*)::int total,
            count(*) FILTER (WHERE updated_at >= NOW() - interval '${DIAS} days')::int na_janela
       FROM public.aria_contact_consent WHERE outbound_opted_out = true`,
  );
  const optJanela = opt.rows[0].na_janela;
  console.log(`\n── consentimento ──`);
  console.log(`  opt-outs na janela: ${optJanela}   ·   acumulado: ${opt.rows[0].total}`);
  if (enviados > 0) console.log(`  taxa sobre quem recebeu: ${pct(optJanela, enviados).toFixed(1)}%`);

  // ── 5. Findings ───────────────────────────────────────────────────────────
  const esc = await c.query(
    `SELECT count(*)::int n FROM public.aria_escalations
      WHERE created_at >= NOW() - interval '${DIAS} days'
        AND (summary LIKE '[evento-reserva]%' OR summary LIKE '[reminders]%'
          OR summary LIKE '[briefing]%' OR summary LIKE '[review]%')`,
  );
  const findings = esc.rows[0].n;
  console.log(`\n── findings automáticos ──`);
  console.log(`  ${findings} na janela (${(findings / Math.max(DIAS, 1)).toFixed(1)}/dia)`);

  // ── 6. Veredito ───────────────────────────────────────────────────────────
  if (tentados > 0 && pct(falhas, tentados) > PARADA.falhaEnvioPct)
    alertas.push(`falha de envio em ${pct(falhas, tentados).toFixed(1)}% (teto ${PARADA.falhaEnvioPct}%)`);
  if (enviados > 0 && pct(optJanela, enviados) > PARADA.optOutPct)
    alertas.push(`opt-out em ${pct(optJanela, enviados).toFixed(1)}% de quem recebeu (teto ${PARADA.optOutPct}%)`);
  if (total > 0 && pct(naoEnviavel, total) > PARADA.naoEnviavelPct)
    alertas.push(`${pct(naoEnviavel, total).toFixed(1)}% barrados pela trava de telefone (teto ${PARADA.naoEnviavelPct}%)`);
  if (findings / Math.max(DIAS, 1) > PARADA.findingsPorDia)
    alertas.push(`${(findings / Math.max(DIAS, 1)).toFixed(1)} findings/dia (teto ${PARADA.findingsPorDia})`);

  console.log(`\n${"═".repeat(64)}`);
  if (alertas.length === 0) {
    console.log(`  SEGUIR — nenhum critério de parada atingido`);
  } else {
    console.log(`  PARAR — ${alertas.length} critério(s) atingido(s):`);
    for (const a of alertas) console.log(`    · ${a}`);
    console.log(`\n  Desligar com RESERVATION_EVENTS_ENABLED=false e reavaliar.`);
  }
  console.log(`${"═".repeat(64)}`);
  console.log(`\n  O quality rating do número NÃO está aqui — só o WhatsApp Manager`);
  console.log(`  mostra. Conferir manualmente todo dia durante o canário.\n`);

  await c.end();
  process.exitCode = alertas.length > 0 ? 1 : 0;
})().catch((e) => { console.error("FALHA:", e.message); process.exit(2); });
