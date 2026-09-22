'use strict';
/**
 * Varredura diária (rede de segurança) — classifica mensagens recebidas nas caixas
 * e compara com o registro. DRY-RUN por padrão: nunca grava no registro sem --apply
 * e aprovação (registro de remoção é REQUER_APROVACAO_HUMANA na spec §5).
 *
 * Entrada: arquivo JSON com mensagens já exportadas (sem corpo integral guardado em
 * disco por muito tempo — política de PII: apagar o export após a varredura).
 *   [{ id, threadId, from, subject, text, date }]
 * Em produção, a fonte é o mesmo POST /webhook/email que alimenta a Aria (n8n),
 * ou a Gmail API com credencial de leitura. Esta versão lê o export.
 *
 * Uso: node varredura.js <mensagens.json> [--relatorio <saida.md>]
 */
const fs = require('node:fs');
const path = require('node:path');
const { classificar, acaoPara } = require('./classificador');
const registro = require('./registro');

function anonimizarRemetente(from) {
  const m = String(from || '').match(/@([A-Za-z0-9.-]+)/);
  return m ? `@${m[1].toLowerCase()}` : '(sem domínio)';
}

function varrer(mensagens, reg) {
  const linhas = [];
  const cont = { total: mensagens.length, remocao: 0, correcao: 0, reclamacao: 0, prospect: 0, spam: 0, outro: 0, injecao: 0 };
  for (const m of mensagens) {
    const cls = classificar(m);
    const acao = acaoPara(cls);
    cont[cls.categoria]++;
    if (cls.injecao) cont.injecao++;
    linhas.push({
      id: m.id, data: m.date, remetente: anonimizarRemetente(m.from), assunto: String(m.subject || '').slice(0, 80),
      categoria: cls.categoria, confianca: cls.confianca, idioma: cls.idioma, injecao: cls.injecao, acao: acao.acao,
      sinais: Object.entries(cls.sinais).filter(([, v]) => v.length).map(([k, v]) => `${k}:${v.map((s) => s.trecho).join(' | ')}`).join(' ; ').slice(0, 200),
    });
  }
  const pendentes = linhas.filter((l) => ['remocao', 'correcao', 'reclamacao'].includes(l.categoria) || l.injecao);
  return { cont, linhas, pendentes, registro: registro.resumo(reg) };
}

function relatorio(r, origem) {
  const md = [];
  md.push(`# Varredura de opt-out/remoção — ${new Date().toISOString().slice(0, 10)}`);
  md.push(`Fonte: ${origem} · ${r.cont.total} mensagens · classificador determinístico (sem LLM) · dry-run`);
  md.push('');
  md.push('| Categoria | N |', '|---|---|');
  for (const k of ['remocao', 'correcao', 'reclamacao', 'prospect', 'spam', 'outro', 'injecao']) md.push(`| ${k} | ${r.cont[k]} |`);
  md.push('', `Registro (estado atual): ${JSON.stringify(r.registro)}`, '');
  md.push('## Mensagens que exigem ação (remoção/correção/reclamação/injeção)');
  md.push('| Data | Remetente (domínio) | Assunto | Categoria | Conf. | Idioma | Ação | Sinais |', '|---|---|---|---|---|---|---|---|');
  for (const l of r.pendentes) md.push(`| ${l.data || ''} | ${l.remetente} | ${l.assunto.replace(/\|/g, '/')} | ${l.categoria}${l.injecao ? ' ⚠injeção' : ''} | ${l.confianca} | ${l.idioma} | ${l.acao} | ${l.sinais.replace(/\|/g, '/')} |`);
  if (!r.pendentes.length) md.push('| — | — | — | nenhuma | | | | |');
  md.push('', '> Nada foi gravado no registro. Cada linha acima é proposta para o Portão (REQUER_APROVACAO_HUMANA).');
  return md.join('\n');
}

if (require.main === module) {
  const arq = process.argv[2];
  if (!arq) { console.error('uso: node varredura.js <mensagens.json> [--relatorio saida.md]'); process.exit(2); }
  const mensagens = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const reg = registro.carregar();
  const r = varrer(mensagens, reg);
  const md = relatorio(r, path.basename(arq));
  const i = process.argv.indexOf('--relatorio');
  if (i > 0) { fs.mkdirSync(path.dirname(process.argv[i + 1]), { recursive: true }); fs.writeFileSync(process.argv[i + 1], md, 'utf8'); console.log('relatório:', process.argv[i + 1]); }
  else console.log(md);
}

module.exports = { varrer, relatorio, anonimizarRemetente };
