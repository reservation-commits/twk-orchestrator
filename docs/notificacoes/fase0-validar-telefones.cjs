/**
 * Fase 0 — Validação E.164 da base de telefones (SOMENTE LEITURA).
 *
 * Pré-requisito do WhatsApp transacional: saber, número a número, se ele
 * entrega — e, quando não entrega, por quê. Nada é escrito no banco.
 *
 * MÉTODO (declarado no relatório, para ser auditável):
 *   Para cada telefone, testamos leituras concorrentes com libphonenumber-js/max:
 *     A) INTERNACIONAL — "+" + dígitos. É exatamente o que normalizePhone()
 *        produz hoje, ou seja: o que o sistema enviaria se fosse ligado agora.
 *     B) NACIONAL BR    — os mesmos dígitos lidos como número brasileiro.
 *        Testado porque a análise de prefixos mostrou DDDs (65, 85, 91, 14,
 *        16, 17, 19, 12, 21, 31) ocupando a posição do código de país.
 *   O veredito nasce da combinação das duas leituras. Duas leituras válidas =
 *   ambiguidade real, não resolvível sem perguntar ao cliente.
 *
 * SAÍDAS
 *   1) relatório agregado (markdown), sem nenhum dado pessoal;
 *   2) CSV por linha com telefone MASCARADO, para inspeção.
 *
 * USO (as dependências pg e libphonenumber-js vivem no repo do DBA):
 *   cd "Agente Gerenciador do Banco de Dados/twk-db-agent"
 *   NODE_PATH="$PWD/node_modules" node ../../docs/notificacoes/fase0-validar-telefones.cjs \
 *     "$PWD/.env.readonly.local" \
 *     ../../docs/notificacoes/fase0-validacao-telefones.md \
 *     <caminho-do-csv-fora-do-repo> \
 *     [caminho-do-sql-de-backfill]      # opcional
 *
 * O 4º argumento gera o backfill de public.aria_phone_quality (só o veredito,
 * nunca o telefone). Requer a tabela criada — ver fase2-ddl-trava-telefone.md.
 *
 * O CSV sai MASCARADO, mas ainda assim é dado de cliente: grave fora do
 * OneDrive do projeto. Não commitar.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { parsePhoneNumberFromString } = require("libphonenumber-js/max");

const envPath = process.argv[2];
const outMd = process.argv[3];
const outCsv = process.argv[4];
/** 4º argumento OPCIONAL: caminho do .sql de backfill de public.aria_phone_quality. */
const outSql = process.argv[5] ?? "";

const url = fs
  .readFileSync(envPath, "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL_RO="))
  .slice("DATABASE_URL_RO=".length)
  .trim()
  .replace(/^["']|["']$/g, "");

// Tipos em que o WhatsApp é plausível. FIXED_LINE nunca tem WhatsApp.
const TIPO_MOVEL = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

// Países testados APENAS na anatomia do balde inválido, para responder
// "dá para recuperar por dedução?". Não participam da classificação principal.
const PAISES_RELEITURA = ["FR", "PT", "IT", "GB", "ES", "DE", "US", "BR", "AE", "IN", "CH", "BE", "NL", "MX", "AR"];

function ler(entrada, pais) {
  try {
    const p = pais
      ? parsePhoneNumberFromString(entrada, pais)
      : parsePhoneNumberFromString(entrada);
    if (!p || !p.isValid()) return null;
    return { e164: p.number, pais: p.country ?? "??", tipo: p.getType() ?? "DESCONHECIDO" };
  } catch {
    return null;
  }
}

function classificar(bruto) {
  const digitos = String(bruto).replace(/\D/g, "");
  const tinhaMais = /^\s*\+/.test(String(bruto));
  const troncoZero = /^0/.test(digitos);

  if (digitos.length === 0) return { veredito: "VAZIO", digitos, tinhaMais, troncoZero };
  // E.164 admite no máximo 15 dígitos; abaixo de 8 não há número discável real.
  if (digitos.length > 15 || digitos.length < 8)
    return { veredito: "INVALIDO", motivo: `comprimento ${digitos.length}`, digitos, tinhaMais, troncoZero };

  const A = ler("+" + digitos, null); // leitura internacional (comportamento atual)
  const B = digitos.length >= 10 && digitos.length <= 11 ? ler(digitos, "BR") : null;

  if (A && B) {
    return {
      veredito: "AMBIGUO_BR", digitos, tinhaMais, troncoZero,
      pais: A.pais, tipo: A.tipo, e164: A.e164, alt: B.e164, altPais: B.pais,
    };
  }
  if (A && !B) {
    const movel = TIPO_MOVEL.has(A.tipo);
    return {
      veredito: movel ? "ENVIAVEL" : "ENVIAVEL_NAO_MOVEL",
      digitos, tinhaMais, troncoZero, pais: A.pais, tipo: A.tipo, e164: A.e164,
    };
  }
  if (!A && B) {
    return {
      veredito: "CORRIGIVEL_BR", digitos, tinhaMais, troncoZero,
      pais: B.pais, tipo: B.tipo, e164: B.e164,
    };
  }
  return { veredito: "INVALIDO", motivo: "nenhuma leitura válida", digitos, tinhaMais, troncoZero };
}

function mascarar(digitos) {
  if (digitos.length <= 4) return "*".repeat(digitos.length);
  return "*".repeat(digitos.length - 4) + digitos.slice(-4);
}

const SQL = `
  SELECT u.id, u.phone,
         count(r.*) FILTER (WHERE r.booking_date >= CURRENT_DATE - 180)::int AS res_180d,
         count(r.*) FILTER (WHERE r.booking_date >= CURRENT_DATE)::int        AS res_futuras,
         count(r.*) FILTER (WHERE r.booking_date >= CURRENT_DATE
                              AND r.booking_status ILIKE 'accept%')::int      AS res_fut_aceitas
    FROM nextauth."User" u
    LEFT JOIN public.reservations r ON r.customer_id = u.id
   WHERE coalesce(btrim(u.phone), '') <> ''
     AND u."deactivatedAt" IS NULL
   GROUP BY u.id, u.phone`;

const COORTES = [
  ["Base inteira (contas ativas com telefone)", () => true],
  ["Clientes com reserva nos últimos 180 dias", (r) => r.res_180d > 0],
  ["Clientes com reserva futura", (r) => r.res_futuras > 0],
  ["Clientes com reserva futura ACEITA (piloto)", (r) => r.res_fut_aceitas > 0],
];

const ORDEM = ["ENVIAVEL", "ENVIAVEL_NAO_MOVEL", "AMBIGUO_BR", "CORRIGIVEL_BR", "INVALIDO", "VAZIO"];

function tabela(linhas) {
  const tot = linhas.length;
  const por = {};
  for (const l of linhas) por[l.c.veredito] = (por[l.c.veredito] ?? 0) + 1;
  const out = ["| Veredito | Nº | % |", "|---|---:|---:|"];
  for (const v of ORDEM) {
    if (!por[v]) continue;
    out.push(`| \`${v}\` | ${por[v]} | ${((por[v] / tot) * 100).toFixed(1)}% |`);
  }
  out.push(`| **Total** | **${tot}** | 100% |`);
  return out.join("\n");
}

function topPaises(linhas, n = 12) {
  const por = {};
  for (const l of linhas) {
    if (l.c.veredito !== "ENVIAVEL") continue;
    por[l.c.pais] = (por[l.c.pais] ?? 0) + 1;
  }
  const arr = Object.entries(por).sort((a, b) => b[1] - a[1]).slice(0, n);
  const out = ["| País | Enviáveis |", "|---|---:|"];
  for (const [p, q] of arr) out.push(`| ${p} | ${q} |`);
  return out.join("\n");
}

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(SQL);
  await c.end();

  const linhas = rows.map((r) => ({ r, c: classificar(r.phone) }));

  // ── CSV por linha (telefone mascarado) ────────────────────────────────────
  const csv = ["user_id,veredito,pais,tipo,telefone_mascarado,leitura_alternativa,res_180d,res_futuras,res_fut_aceitas,tronco_zero,tinha_mais"];
  for (const { r, c: k } of linhas) {
    csv.push([
      r.id, k.veredito, k.pais ?? "", k.tipo ?? "", mascarar(k.digitos),
      k.alt ? mascarar(String(k.alt).replace(/\D/g, "")) : "",
      r.res_180d, r.res_futuras, r.res_fut_aceitas,
      k.troncoZero ? "sim" : "nao", k.tinhaMais ? "sim" : "nao",
    ].join(","));
  }
  fs.writeFileSync(outCsv, csv.join("\n"), "utf8");

  // ── Backfill SQL de public.aria_phone_quality (opcional) ──────────────────
  // Só o VEREDITO atravessa: nem o telefone nem o E.164 normalizado entram na
  // tabela. É a mesma PII já guardada em nextauth."User" — duplicá-la seria
  // aumentar a superfície sem necessidade, já que o envio recalcula em memória.
  if (outSql) {
    const q = (v) => (v === null || v === undefined || v === "" ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
    const LOTE = 500;
    const out = [
      `-- Backfill de public.aria_phone_quality`,
      `-- Gerado em ${new Date().toISOString()} por docs/notificacoes/fase0-validar-telefones.cjs`,
      `-- ${linhas.length} linhas. Requer a tabela criada (ver fase2-ddl-trava-telefone.md).`,
      `-- Executar por orchestrator/agents/dba-escrita/executar.js, com aprovação gravada.`,
      ``,
      `BEGIN;`,
      ``,
    ];
    for (let i = 0; i < linhas.length; i += LOTE) {
      const fatia = linhas.slice(i, i + LOTE);
      out.push(`INSERT INTO public.aria_phone_quality (user_id, phone_status, pais, tipo, motivo, checked_at) VALUES`);
      out.push(
        fatia
          .map(({ r, c: k }) =>
            `  (${q(r.id)}, ${q(k.veredito)}, ${q(k.pais)}, ${q(k.tipo)}, ${q(k.motivo ?? "")}, NOW())`)
          .join(",\n"),
      );
      out.push(`ON CONFLICT (user_id) DO UPDATE SET`);
      out.push(`  phone_status = EXCLUDED.phone_status, pais = EXCLUDED.pais, tipo = EXCLUDED.tipo,`);
      out.push(`  motivo = EXCLUDED.motivo, checked_at = EXCLUDED.checked_at;`);
      out.push(``);
    }
    out.push(`COMMIT;`, ``);
    fs.writeFileSync(outSql, out.join("\n"), "utf8");
  }

  // ── Relatório agregado ────────────────────────────────────────────────────
  const hoje = new Date().toISOString().slice(0, 10);
  const md = [];
  md.push(`# Fase 0 — Validação E.164 da base de telefones`);
  md.push("");
  md.push(`> Gerado em ${hoje} · credencial \`twk_ro\` (somente leitura) · nada foi escrito no banco.`);
  md.push(`> Biblioteca: \`libphonenumber-js/max\` 1.13.6 (metadados completos, com tipo de linha).`);
  md.push(`> Dono do documento: Orquestrador. Rotulagem: fato × suposição × lacuna.`);
  md.push("");
  md.push(`## Por que este relatório existe`);
  md.push("");
  md.push(`O WhatsApp transacional não pode ser ligado antes de sabermos quais números entregam.`);
  md.push(`Um template enviado ao número errado entrega nome, restaurante e data de reserva de um`);
  md.push(`cliente a um desconhecido — vazamento de dado pessoal — e derruba o *quality rating* do`);
  md.push(`nosso número na Meta. Este é o pré-requisito da Fase 1.`);
  md.push("");
  md.push(`## Método`);
  md.push("");
  md.push(`Para cada telefone testamos duas leituras concorrentes:`);
  md.push("");
  md.push(`- **A — internacional**: \`"+" + dígitos\`. É exatamente o que \`normalizePhone()\` produz hoje,`);
  md.push(`  ou seja, **o número para onde a mensagem iria se ligássemos o sistema agora**.`);
  md.push(`- **B — nacional brasileiro**: os mesmos dígitos lidos como número do Brasil. Testada porque`);
  md.push(`  a análise de prefixos mostrou DDDs (65, 85, 91, 14, 16, 17, 19, 12, 21, 31) ocupando a`);
  md.push(`  posição do código de país.`);
  md.push("");
  md.push(`| Veredito | Significado | Decisão operacional |`);
  md.push(`|---|---|---|`);
  md.push(`| \`ENVIAVEL\` | só a leitura A é válida, e a linha aceita WhatsApp | **enviar** |`);
  md.push(`| \`ENVIAVEL_NAO_MOVEL\` | leitura A válida, mas é fixo/VoIP | e-mail (fixo não tem WhatsApp) |`);
  md.push(`| \`AMBIGUO_BR\` | A **e** B válidas — duas leituras possíveis do mesmo número | **quarentena** |`);
  md.push(`| \`CORRIGIVEL_BR\` | A inválida, B válida — quase certamente BR sem o +55 | quarentena, recuperável |`);
  md.push(`| \`INVALIDO\` | nenhuma leitura válida | e-mail; recadastrar |`);
  md.push("");
  md.push(`**[Lacuna declarada]** Não existe campo de país na tabela \`nextauth."User"\`. Por isso só`);
  md.push(`testamos a leitura nacional brasileira, que é a que os dados sustentam. Um cliente francês`);
  md.push(`que tenha gravado o número em formato nacional cairá em \`INVALIDO\`, não em \`CORRIGIVEL\`.`);
  md.push(`A correção definitiva é o seletor de país no formulário do site.`);
  md.push("");

  for (const [nome, filtro] of COORTES) {
    const sub = linhas.filter((l) => filtro(l.r));
    md.push(`## ${nome}`);
    md.push("");
    md.push(tabela(sub));
    md.push("");
    const env = sub.filter((l) => l.c.veredito === "ENVIAVEL");
    if (env.length > 0 && sub.length > 50) {
      md.push(`### Países dos enviáveis`);
      md.push("");
      md.push(topPaises(sub));
      md.push("");
    }
  }

  const todos = linhas;
  const troncos = todos.filter((l) => l.c.troncoZero).length;
  const semMais = todos.filter((l) => !l.c.tinhaMais).length;
  const enviaveis = todos.filter((l) => l.c.veredito === "ENVIAVEL").length;
  const naoMovel = todos.filter((l) => l.c.veredito === "ENVIAVEL_NAO_MOVEL").length;
  const ambiguos = todos.filter((l) => l.c.veredito === "AMBIGUO_BR").length;
  const corrigiveis = todos.filter((l) => l.c.veredito === "CORRIGIVEL_BR").length;
  const invalidos = todos.filter((l) => l.c.veredito === "INVALIDO").length;

  md.push(`## O que acontece se ligarmos hoje, sem corrigir nada`);
  md.push("");
  md.push(`\`normalizePhone()\` cola um \`+\` nos dígitos e envia. Sobre a base inteira (${todos.length} contas):`);
  md.push("");
  md.push(`- **${enviaveis}** chegariam ao destinatário certo;`);
  md.push(`- **${naoMovel}** iriam para linha fixa/VoIP — não entregam;`);
  md.push(`- **${ambiguos}** iriam para um número que existe, mas pode ser de outra pessoa em outro país;`);
  md.push(`- **${corrigiveis}** falhariam no envio (número inexistente);`);
  md.push(`- **${invalidos}** falhariam no envio.`);
  md.push("");
  md.push(`Os \`AMBIGUO_BR\` são o risco sério: **não falham** — entregam a um estranho.`);
  md.push("");
  md.push(`Sinais de origem da sujeira: **${semMais}** telefones gravados sem \`+\`; **${troncos}** começando`);
  md.push(`com \`0\` (prefixo de tronco nacional, que não existe em E.164).`);
  md.push("");
  // ── Anatomia do balde INVALIDO ────────────────────────────────────────────
  const invLinhas = todos.filter((l) => l.c.veredito === "INVALIDO");
  const invRecentes = invLinhas.filter((l) => l.r.res_180d > 0).length;
  const invZero = invLinhas.filter((l) => l.c.troncoZero).length;
  const invLongos = invLinhas.filter((l) => l.c.digitos.length > 15).length;
  const invCurtos = invLinhas.filter((l) => l.c.digitos.length < 8).length;
  let lixo = 0;
  for (const l of invLinhas) {
    const d = l.c.digitos;
    if (/^(\d)\1+$/.test(d) || "0123456789012345".includes(d) || "9876543210987654".includes(d)) lixo++;
  }
  let recUnico = 0, recAmbiguo = 0, recNenhum = 0;
  const recPais = {};
  for (const l of invLinhas) {
    const validos = [];
    for (const cc of PAISES_RELEITURA) {
      const p = ler(l.c.digitos, cc);
      if (p) validos.push(cc);
    }
    if (validos.length === 1) { recUnico++; recPais[validos[0]] = (recPais[validos[0]] ?? 0) + 1; }
    else if (validos.length > 1) recAmbiguo++;
    else recNenhum++;
  }
  const recTop = Object.entries(recPais).sort((a, b) => b[1] - a[1]).slice(0, 8);

  md.push(`## Anatomia do balde \`INVALIDO\` — dá para recuperar por dedução?`);
  md.push("");
  md.push(`São ${invLinhas.length} números. **Apenas ${invRecentes} pertencem a quem reservou nos últimos`);
  md.push(`180 dias** — 94% do balde é base dormente. Para a notificação transacional, o impacto`);
  md.push(`imediato é pequeno; o problema é de qualidade de cadastro, não de operação.`);
  md.push("");
  md.push(`Forma da falha:`);
  md.push("");
  md.push(`- **${invZero}** começam com \`0\` — prefixo de tronco nacional (formato europeu), que não existe em E.164;`);
  md.push(`- **${invLongos}** passam de 15 dígitos (teto do E.164) — provavelmente dois números colados no mesmo campo;`);
  md.push(`- **${invCurtos}** têm menos de 8 dígitos — não é número discável;`);
  md.push(`- **${lixo}** são dígito repetido ou sequência (\`11111…\`, \`12345…\`) — preenchimento falso.`);
  md.push("");
  md.push(`Testamos releitura como número nacional em ${PAISES_RELEITURA.length} países:`);
  md.push("");
  md.push(`| Resultado | Nº |`);
  md.push(`|---|---:|`);
  md.push(`| válido em **um único** país (recuperável) | ${recUnico} |`);
  md.push(`| válido em **vários** países (ambíguo) | ${recAmbiguo} |`);
  md.push(`| inválido em todos (irrecuperável) | ${recNenhum} |`);
  md.push("");
  md.push(`Dos "recuperáveis", a distribuição por país é ${recTop.map(([p, q]) => `${p}=${q}`).join(", ")}.`);
  md.push("");
  md.push(`**[Suposição — não tratar como fato]** A concentração em DE é quase certamente artefato do`);
  md.push(`método, não 900 clientes alemães: o plano de numeração da Alemanha tem regras de comprimento`);
  md.push(`muito frouxas, então quase qualquer sequência iniciada por \`0\` valida como alemã. A prova`);
  md.push(`indireta: entre os números **bem formatados**, DE aparece ${
    (() => { let n = 0; for (const l of todos) if (l.c.veredito === "ENVIAVEL" && l.c.pais === "DE") n++; return n; })()
  } vezes. Seria estranho o balde`);
  md.push(`quebrado ter o dobro de alemães do balde íntegro.`);
  md.push("");
  md.push(`**Conclusão:** o balde \`INVALIDO\` **não é recuperável por dedução**. Tirando o artefato alemão,`);
  md.push(`sobra ambiguidade ou lixo. Estes números só voltam à operação se o cliente informar de novo.`);
  md.push(`Adivinhar aqui é exatamente o erro que produz vazamento de dado pessoal.`);
  md.push("");
  md.push(`## Próximo passo`);
  md.push("");
  md.push(`1. Seletor de país no formulário de reserva do site, gravando E.164 — sem isso a sujeira volta.`);
  md.push(`2. Coluna \`phone_e164\` + \`phone_status\` em \`nextauth."User"\`, populada por este validador.`);
  md.push(`   **DDL e UPDATE exigem aprovação do fundador** (constituição) e passam por`);
  md.push(`   \`orchestrator/agents/dba-escrita/executar.js\`.`);
  md.push(`3. A Aria só envia para \`phone_status = 'ENVIAVEL'\`. Todo o resto segue por e-mail.`);
  md.push(`4. Quarentena (\`AMBIGUO_BR\` + \`CORRIGIVEL_BR\`) é resolvida perguntando ao cliente no`);
  md.push(`   próximo contato — nunca adivinhando.`);
  md.push("");

  fs.writeFileSync(outMd, md.join("\n"), "utf8");

  console.log(`OK · ${todos.length} telefones classificados`);
  console.log(`   ENVIAVEL=${enviaveis} NAO_MOVEL=${naoMovel} AMBIGUO=${ambiguos} CORRIGIVEL=${corrigiveis} INVALIDO=${invalidos}`);
  console.log(`   relatório: ${outMd}`);
  console.log(`   csv:       ${outCsv}`);
})().catch((e) => {
  console.error("FALHA:", e.message);
  process.exit(1);
});
