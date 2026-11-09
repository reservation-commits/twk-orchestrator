#!/usr/bin/env node
'use strict';
/**
 * COMPASSO — um login para cada pessoa, sem digitar nada e sem selecionar texto no terminal.
 *
 *   1. No EasyPanel (serviço compasso → Ambiente), clique na caixa de texto, Ctrl+A, Ctrl+C.
 *   2. Rode:  node orchestrator/tarefas/logins.cjs
 *   3. Volte à caixa do Ambiente, Ctrl+A, Ctrl+V, Salvar, Implantar.
 *
 * O script lê o Ambiente da área de transferência, troca só a linha TAREFAS_USUARIOS (mantém o admin e todas as
 * outras linhas exatamente como estavam), devolve o Ambiente pronto para a área de transferência e mostra, só neste
 * terminal, as senhas provisórias de Márlon, Lucas e Julien. Nada vai para a rede; nada é gravado em disco.
 *
 * Opções:  --de-novo lucas[,julien]  gera provisória nova para quem já tem login ("esqueci a senha")
 *          --colar                   não lê a área de transferência: pede o valor aqui no terminal
 *          --sem-admin               aceita ficar sem o login admin
 *          --janela                  senhas numa janela na tela, não na saída (o Claude pode rodar sem vê-las)
 *
 * No primeiro acesso, o app obriga a pessoa a escolher a própria senha; a provisória deixa de valer na hora.
 */
const crypto = require('node:crypto');
const readline = require('node:readline');
const { execFileSync, spawnSync } = require('node:child_process');
const { hashSenha, conferirSenha, FORMATO_HASH, PESSOAS, LOGINS } = require('./auth.js');

const CHAVE = 'TAREFAS_USUARIOS';
// Sem letras que se confundem ao ditar ou ler (0/o, 1/l/i): mais fácil de digitar no celular.
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
function senhaProvisoria() {
  const grupos = [];
  for (let g = 0; g < 4; g++) { let s = ''; for (let i = 0; i < 4; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)]; grupos.push(s); }
  return grupos.join('-'); // 16 sinais de 31: cerca de 79 bits
}

/** JSON só com caracteres ASCII ("Márlon" vira "Márlon"): nenhum caminho de cópia estraga um acento. */
const jsonAscii = (v) => JSON.stringify(v).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Limpa o que uma cópia costuma estragar: quebra de linha e espaço no meio, aspas em volta. */
function limparValor(v) {
  let s = String(v || '').replace(/[\r\n\t]+/g, '').trim();
  if (s.length > 1 && (s[0] === "'" || s[0] === '"') && s[s.length - 1] === s[0] && s[1] === '[') s = s.slice(1, -1);
  return s;
}

/**
 * Entende o que veio colado: o Ambiente inteiro, só a linha TAREFAS_USUARIOS, ou só o valor [ … ].
 * Devolve { modo: 'ambiente'|'linha', valor, linhas, i, aspas, eol }.
 */
function lerFonte(texto) {
  const t = String(texto || '');
  if (!t.trim()) throw new Error('Não há nada copiado. No EasyPanel, clique na caixa do Ambiente, Ctrl+A, Ctrl+C, e rode de novo.');
  const eol = t.includes('\r\n') ? '\r\n' : '\n';
  const linhas = t.split(/\r?\n/);
  const i = linhas.findIndex((l) => new RegExp(`^\\s*(?:export\\s+)?${CHAVE}\\s*=`).test(l));
  const pareceAmbiente = linhas.some((l) => /^\s*[A-Z_][A-Z0-9_]*\s*=/.test(l));
  if (i >= 0) {
    const bruto = linhas[i].slice(linhas[i].indexOf('=') + 1).trim();
    const aspas = /^(['"])\[/.test(bruto) && bruto.endsWith(bruto[0]) ? bruto[0] : '';
    return { modo: pareceAmbiente && linhas.filter((l) => l.trim()).length > 1 ? 'ambiente' : 'linha', valor: limparValor(bruto), linhas, i, aspas, eol };
  }
  if (limparValor(t).startsWith('[')) return { modo: 'linha', valor: limparValor(t), linhas: [], i: -1, aspas: '', eol };
  if (pareceAmbiente) return { modo: 'ambiente', valor: '', linhas, i: -1, aspas: '', eol }; // Ambiente sem a linha: ela será acrescentada
  throw new Error(`O texto copiado não é o Ambiente do EasyPanel nem o valor de ${CHAVE}. Clique na caixa do Ambiente, Ctrl+A, Ctrl+C, e rode de novo.`);
}

/** Devolve o texto para colar: o Ambiente inteiro com só a linha trocada, ou só a linha. */
function escreverFonte(fonte, lista) {
  const linha = `${CHAVE}=${fonte.aspas}${jsonAscii(lista)}${fonte.aspas}`;
  if (fonte.modo !== 'ambiente') return linha;
  const linhas = fonte.linhas.slice();
  if (fonte.i >= 0) linhas[fonte.i] = linha;
  else { const fim = linhas.length && linhas[linhas.length - 1] === '' ? linhas.length - 1 : linhas.length; linhas.splice(fim, 0, linha); }
  return linhas.join(fonte.eol);
}

/**
 * Monta a lista nova. `atual` = valor de TAREFAS_USUARIOS (ou vazio). `ids` = pessoas que recebem senha provisória.
 * Devolve { lista, provisorias: {id: senha} }. Quem não está em `ids` fica exatamente como estava.
 */
function montar(atual, ids, gerar = senhaProvisoria) {
  let lista = [];
  const texto = limparValor(atual);
  if (texto) {
    try { lista = JSON.parse(texto); } catch { throw new Error(`O valor de ${CHAVE} não é JSON válido. Copie de novo a caixa inteira do Ambiente.`); }
    if (!Array.isArray(lista)) throw new Error(`${CHAVE} precisa ser uma lista: [ … ].`);
    for (const u of lista) {
      if (!u || !LOGINS[u.id]) throw new Error(`Login desconhecido no valor atual: ${u && u.id}. Os aceitos são: ${Object.keys(LOGINS).join(', ')}.`);
      u.senha = String(u.senha || '').replace(/\s+/g, '');
      if (!FORMATO_HASH.test(u.senha)) throw new Error(`O login ${u.id} não tem a senha no formato scrypt:salt:hash. Copie de novo a caixa inteira do Ambiente.`);
    }
  }
  const provisorias = {};
  for (const id of ids) {
    if (!PESSOAS[id]) throw new Error(`Só Márlon, Lucas e Julien recebem senha provisória aqui (recebido: ${id}).`);
    const senha = gerar();
    provisorias[id] = senha;
    const novo = { id, nome: PESSOAS[id], senha: hashSenha(senha), trocar: true };
    const i = lista.findIndex((u) => u.id === id);
    if (i >= 0) lista[i] = novo; else lista.push(novo);
  }
  const ordem = ['admin', 'marlon', 'lucas', 'julien'];
  lista.sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id));
  for (const [id, senha] of Object.entries(provisorias)) if (!conferirSenha(senha, lista.find((u) => u.id === id).senha)) throw new Error('Conferência do hash falhou: nada foi gerado.');
  if (JSON.stringify(lista).includes('$')) throw new Error('O valor tem "$", que o EasyPanel engole. Gere de novo.');
  return { lista, provisorias };
}

// ---------------------------------------------------------------- área de transferência (Windows e macOS)
// Por base64: o texto atravessa o PowerShell sem passar por nenhuma página de código, então acento e sinal não mudam.
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
function lerArea() {
  if (process.platform === 'win32') {
    const b64 = ps('$t = Get-Clipboard -Raw; if ($t) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t)) }').trim();
    return b64 ? Buffer.from(b64, 'base64').toString('utf8') : '';
  }
  if (process.platform === 'darwin') return execFileSync('pbpaste', { encoding: 'utf8' });
  throw new Error('área de transferência não suportada neste sistema');
}
function escreverArea(texto) {
  if (process.platform === 'win32') { ps(`Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(texto, 'utf8').toString('base64')}')))`); return lerArea() === texto; }
  if (process.platform === 'darwin') { execFileSync('pbcopy', { input: texto }); return execFileSync('pbpaste', { encoding: 'utf8' }) === texto; }
  return false;
}

/**
 * --janela: as senhas aparecem numa janela na tela de quem está no computador, e não na saída do comando. Assim o
 * Claude pode rodar o script sem nunca ver uma senha. Nada vai para disco: o texto chega à janela pela entrada padrão
 * (nem na linha de comando aparece), e o comando só termina quando a janela é fechada.
 * `fecharEmMs` existe para o teste: a janela se fecha sozinha.
 */
function abrirJanela(texto, { fecharEmMs = 0 } = {}) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing',
    '$t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()))',
    '$f = New-Object Windows.Forms.Form; $f.Text = "COMPASSO: senhas provisórias"; $f.Width = 760; $f.Height = 480; $f.StartPosition = "CenterScreen"; $f.TopMost = $true',
    '$c = New-Object Windows.Forms.TextBox; $c.Multiline = $true; $c.ReadOnly = $true; $c.ScrollBars = "Vertical"; $c.WordWrap = $true; $c.Dock = "Fill"; $c.Font = New-Object Drawing.Font("Consolas", 11); $c.Text = $t',
    '$b = New-Object Windows.Forms.Button; $b.Text = "Já anotei: fechar"; $b.Dock = "Bottom"; $b.Height = 40; $b.Add_Click({ $f.Close() })',
    '$f.Controls.Add($c); $f.Controls.Add($b); $f.Add_Shown({ $f.Activate(); $c.SelectionLength = 0; [Console]::Out.WriteLine("janela aberta") })',
    fecharEmMs ? `$tm = New-Object Windows.Forms.Timer; $tm.Interval = ${Number(fecharEmMs)}; $tm.Add_Tick({ $f.Close() }); $tm.Start()` : '',
    '[void]$f.ShowDialog(); [Console]::Out.WriteLine("janela fechada")',
  ].filter(Boolean).join('\n');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { input: Buffer.from(texto.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'), encoding: 'utf8', windowsHide: false, maxBuffer: 1024 * 1024 });
  const saida = String(r.stdout || '');
  return { aberta: saida.includes('janela aberta'), fechada: saida.includes('janela fechada'), erro: r.status === 0 ? null : String(r.stderr || r.error || '').replace(/#< CLIXML[\s\S]*/, '').slice(0, 200) };
}

async function principal() {
  const args = process.argv.slice(2);
  const opcao = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] || '') : null; };
  const deNovo = String(opcao('--de-novo') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const janela = args.includes('--janela');
  if (janela && process.platform !== 'win32') { console.log('   --janela só funciona no Windows.\n'); process.exitCode = 1; return; }
  console.log('\nCOMPASSO: um login para cada pessoa\n');

  let texto = '';
  if (!args.includes('--colar')) { try { texto = lerArea(); } catch (e) { console.log(`   (não consegui ler a área de transferência: ${e.message})`); } }
  let fonte = null;
  try { fonte = lerFonte(texto); } catch (e) { if (!janela && (args.includes('--colar') || !texto)) fonte = null; else { console.log(`   ${e.message}\n`); process.exitCode = 1; return; } }
  if (!fonte) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const colado = await new Promise((ok) => rl.question(`   Cole aqui o valor de ${CHAVE} e aperte Enter: `, ok));
    rl.close();
    fonte = lerFonte(colado);
  }
  const existentes = fonte.valor ? JSON.parse(limparValor(fonte.valor)).map((u) => u && u.id) : [];
  if (!existentes.includes('admin') && !args.includes('--sem-admin')) {
    console.log(`   O texto copiado não tem o login admin em ${CHAVE}. Sem ele, o seu login deixaria de existir.`);
    console.log('   Confira se copiou a caixa inteira do Ambiente. Se quiser mesmo ficar sem o admin, rode com --sem-admin.\n');
    process.exitCode = 1; return;
  }
  for (const id of deNovo) if (!PESSOAS[id]) { console.log(`   --de-novo aceita marlon, lucas ou julien (recebido: ${id}).\n`); process.exitCode = 1; return; }
  const ids = Object.keys(PESSOAS).filter((id) => !existentes.includes(id) || deNovo.includes(id));
  if (!ids.length) { console.log('   Márlon, Lucas e Julien já têm login. Para gerar senha nova para alguém: --de-novo lucas\n'); return; }

  const { lista, provisorias } = montar(fonte.valor, ids);
  const saida = escreverFonte(fonte, lista);
  // Confere antes de entregar: o texto novo é lido de volta e precisa dar a mesma lista, com as outras linhas iguais.
  const volta = lerFonte(saida);
  if (jsonAscii(JSON.parse(volta.valor)) !== jsonAscii(lista)) throw new Error('Conferência do texto final falhou: nada foi copiado.');
  if (fonte.modo === 'ambiente' && fonte.linhas.some((l, k) => k !== fonte.i && l !== volta.linhas[k])) throw new Error('Uma linha do Ambiente mudaria: nada foi copiado.');

  let copiado = false;
  try { copiado = escreverArea(saida); } catch { copiado = false; }
  if (janela) {
    const linhasSenha = Object.entries(provisorias).map(([id, senha]) => `   ${PESSOAS[id].padEnd(7)} usuário: ${id.padEnd(7)} senha provisória: ${senha}`);
    const passo1 = copiado
      ? (fonte.modo === 'ambiente' ? 'O Ambiente atualizado já está copiado. No EasyPanel, clique na caixa do Ambiente: Ctrl+A, Ctrl+V, Salvar, Implantar.' : `A linha ${CHAVE} nova já está copiada. No EasyPanel, selecione a linha ${CHAVE} inteira na caixa do Ambiente e cole por cima. Salvar, Implantar.`)
      : `Não consegui copiar sozinho. Copie a linha abaixo inteira e cole por cima da linha ${CHAVE} no Ambiente. Salvar, Implantar.\r\n\r\n${escreverFonte({ ...fonte, modo: 'linha' }, lista)}`;
    console.log(`${copiado ? 'O Ambiente atualizado está na área de transferência' : 'Não consegui copiar; a linha nova vai na janela'}. Abrindo a janela com as senhas de ${Object.keys(provisorias).map((id) => PESSOAS[id]).join(', ')}; o comando termina quando ela for fechada.`);
    const r = abrirJanela(['COMPASSO: logins de Márlon, Lucas e Julien', '', `1. ${passo1}`, '   Faça isto ANTES de copiar qualquer coisa desta janela.', '', '2. Senhas provisórias. Entregue a cada um em particular, nunca em grupo nem em conversa com o Claude:', '', ...linhasSenha, '', '   No primeiro acesso o app pede uma senha nova; a provisória deixa de valer na hora.', '', 'Anote e feche esta janela. As senhas não ficam gravadas em lugar nenhum.'].join('\n'));
    if (!r.aberta) { console.log(`A janela não abriu${r.erro ? ` (${r.erro})` : ''}. Nada mudou no EasyPanel: não cole o que está na área de transferência. Rode de novo num terminal, sem --janela.`); process.exitCode = 1; return; }
    console.log(`Janela ${r.fechada ? 'aberta e fechada' : 'aberta'}. Nenhuma senha foi impressa aqui.`);
    return;
  }
  if (copiado && fonte.modo === 'ambiente') {
    console.log(`1. Pronto: a área de transferência já tem o Ambiente com ${CHAVE} atualizado (as outras linhas estão iguais).`);
    console.log('   No EasyPanel, clique na caixa do Ambiente → Ctrl+A → Ctrl+V → Salvar → Implantar.\n');
  } else if (copiado) {
    console.log(`1. Pronto: a área de transferência já tem a linha ${CHAVE} nova.`);
    console.log(`   No EasyPanel, na caixa do Ambiente, selecione a linha ${CHAVE} inteira e cole por cima (Ctrl+V). Salvar → Implantar.\n`);
  } else {
    console.log('1. Não consegui copiar sozinho. Copie a linha abaixo inteira, sem quebrar, e cole por cima da linha atual no Ambiente:\n');
    console.log(escreverFonte({ ...fonte, modo: 'linha' }, lista));
    console.log('\n   Salvar → Implantar.\n');
  }
  console.log('2. Senhas provisórias. Entregue a cada um em particular, nunca em grupo nem em conversa com o Claude:\n');
  for (const [id, senha] of Object.entries(provisorias)) console.log(`   ${PESSOAS[id].padEnd(7)} usuário: ${id.padEnd(7)} senha provisória: ${senha}`);
  console.log('\n   Elas só aparecem aqui: anote antes de fechar este terminal.');
  console.log('   No primeiro acesso o app pede uma senha nova; a provisória deixa de valer na hora.\n');
}

module.exports = { montar, senhaProvisoria, lerFonte, escreverFonte, limparValor, jsonAscii, ALFABETO, _area: { lerArea, escreverArea }, _abrirJanela: abrirJanela };
if (require.main === module) principal().catch((e) => { console.error(`\nErro: ${e.message}`); process.exit(1); });
