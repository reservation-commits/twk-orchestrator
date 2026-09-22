'use strict';
/**
 * Eval do executor de escrita do DBA (ADR-013 / ADR-011). Zero LLM, zero rede, zero banco.
 *
 * O validador foi coberto por 6 casos rodados à mão em 2026-09-08 e nunca entrou no
 * harness — "incorporar ao eval é o próximo passo" ficou 13 dias no ADR. Está aqui agora,
 * exercitando o `validar()` REAL de executar.js (exportado sem encerrar o processo).
 */
const { validar, Bloqueio } = require('../../agents/dba-escrita/executar.js');

const esperar = (cond, msg) => (cond ? [] : [msg]);

/** Espera bloqueio cuja mensagem contenha `trecho`. */
const bloqueia = (nome, sql, trecho, sev = 'hard') => ({
  nome, sev,
  run: () => {
    try { validar(sql); return [`passou sem bloquear (esperava "${trecho}")`]; }
    catch (e) {
      if (!(e instanceof Bloqueio)) return [`lançou erro genérico em vez de Bloqueio: ${e.message}`];
      return esperar(e.message.toLowerCase().includes(trecho.toLowerCase()), `bloqueou por outro motivo: "${e.message}"`);
    }
  },
});

/** Espera passar, devolvendo N backups declarados. */
const passa = (nome, sql, backupsEsperados = 0, sev = 'hard') => ({
  nome, sev,
  run: () => {
    try {
      const b = validar(sql);
      return esperar(b.length === backupsEsperados, `${b.length} backup(s) (esperado ${backupsEsperados})`);
    } catch (e) { return [`bloqueou indevidamente: ${e.message}`]; }
  },
});

const casos = [
  // ── os 6 casos do ADR-013 (08/09), agora no harness ──────────────────────
  bloqueia('ADR-013 #1 palavra estrutural (DROP)', 'begin;\ndrop table public.reservations;\ncommit;', 'estrutural'),
  bloqueia('ADR-013 #2 DELETE sem WHERE', '-- backup: public.x where 1=0\nbegin;\ndelete from public.x;\ncommit;', 'DELETE sem WHERE'),
  bloqueia('ADR-013 #3 DELETE sem backup declarado', 'begin;\ndelete from public.x where id = 1;\ncommit;', 'backup'),
  bloqueia('ADR-013 #4 fora de transação', 'update public.x set a = 1 where id = 1;', 'transação'),
  bloqueia('ADR-013 #5 tautologia', 'begin;\nupdate public.x set a = 1 where true;\ncommit;', 'tautológico'),
  passa('ADR-013 #6 UPDATE válido em transação', 'begin;\nupdate public.x set a = 1 where id = 1;\ncommit;', 0),

  // ── estrutura: nenhuma palavra passa, em nenhuma caixa ───────────────────
  bloqueia('TRUNCATE', 'begin;\ntruncate public.x;\ncommit;', 'estrutural'),
  bloqueia('ALTER', 'begin;\nALTER TABLE public.x ADD COLUMN y int;\ncommit;', 'estrutural'),
  bloqueia('CREATE', 'begin;\nCreate Index i On public.x(a);\ncommit;', 'estrutural'),
  bloqueia('GRANT', 'begin;\ngrant all on public.x to alguem;\ncommit;', 'estrutural'),
  bloqueia('REVOKE', 'begin;\nrevoke select on public.x from alguem;\ncommit;', 'estrutural'),
  bloqueia('OWNER', 'begin;\nupdate public.x set a=1 where id=1; alter table public.x owner to eu;\ncommit;', 'estrutural'),
  bloqueia('COPY (exfiltração)', "begin;\ncopy public.x to '/tmp/x.csv';\ncommit;", 'estrutural'),

  // ── transação ────────────────────────────────────────────────────────────
  bloqueia('sem COMMIT no fim', 'begin;\nupdate public.x set a = 1 where id = 1;', 'transação'),
  bloqueia('COMMIT no meio, não no fim', 'begin;\nupdate public.x set a=1 where id=1;\ncommit;\nupdate public.x set a=2 where id=2;', 'transação'),
  passa('BEGIN/COMMIT em maiúsculas', 'BEGIN;\nUPDATE public.x SET a = 1 WHERE id = 1;\nCOMMIT;', 0),

  // ── WHERE obrigatório ────────────────────────────────────────────────────
  bloqueia('UPDATE sem WHERE', 'begin;\nupdate public.x set a = 1;\ncommit;', 'UPDATE sem WHERE'),
  bloqueia('UPDATE sem WHERE em caixa mista', 'begin;\nUpdate Public.X Set a = 1;\ncommit;', 'UPDATE sem WHERE'),
  bloqueia('segundo UPDATE sem WHERE numa lista', 'begin;\nupdate public.x set a=1 where id=1;\nupdate public.y set b=2;\ncommit;', 'UPDATE sem WHERE'),
  bloqueia('tautologia 1=1', 'begin;\nupdate public.x set a = 1 where 1=1;\ncommit;', 'tautológico'),
  bloqueia('tautologia 1 = 1 com espaços', 'begin;\ndelete from public.x where 1 = 1;\ncommit;', 'tautológico'),

  // ── backup ───────────────────────────────────────────────────────────────
  passa('DELETE com backup declarado', '-- backup: public.x where id = 1\nbegin;\ndelete from public.x where id = 1;\ncommit;', 1),
  passa('dois DELETEs, dois backups', '-- backup: public.x where id = 1\n-- backup: public.y where id = 2\nbegin;\ndelete from public.x where id = 1;\ndelete from public.y where id = 2;\ncommit;', 2),
  bloqueia('backup sem schema é mal formado', '-- backup: x where id = 1\nbegin;\ndelete from public.x where id = 1;\ncommit;', 'mal formada'),
  // Cabeçalho com injeção não casa com o padrão de backup → o DELETE fica sem backup → bloqueia
  // fail-closed. (O "drop" está numa linha de comentário e o banco também o ignoraria.)
  bloqueia('backup com injeção no nome da tabela é ignorado e o DELETE fica sem backup', '-- backup: public.x; drop table y where id = 1\nbegin;\ndelete from public.x where id = 1;\ncommit;', 'backup'),

  // ── comentários: o executor lê o SQL como o banco lê ─────────────────────
  passa('DROP dentro de comentário de linha não conta', '-- este script NÃO faz drop table\nbegin;\nupdate public.x set a = 1 where id = 1;\ncommit;', 0),
  passa('DROP dentro de comentário de bloco não conta', '/* drop table public.x */\nbegin;\nupdate public.x set a = 1 where id = 1;\ncommit;', 0),
  bloqueia('DROP fora do comentário conta', '/* inofensivo */\nbegin;\ndrop table public.x;\ncommit;', 'estrutural'),
  bloqueia('WHERE só dentro de comentário não vale', 'begin;\nupdate public.x set a = 1 -- where id = 1\n;\ncommit;', 'UPDATE sem WHERE'),

  // ── contrato do módulo ───────────────────────────────────────────────────
  { nome: 'require() do executor não executa nada (guarda require.main)', run: () => esperar(typeof validar === 'function' && typeof Bloqueio === 'function', 'exports ausentes') },
];

// ── ADR-017: reversibilidade (o que pode rodar em modo autônomo) ────────────
const { verificarReversibilidade } = require('../../agents/dba-escrita/executar.js');
const rev = (nome, sql, esperado, trecho = '') => ({
  nome, run: () => {
    const r = verificarReversibilidade(sql);
    return [
      ...esperar(r.reversivel === esperado, `reversivel=${r.reversivel} (esperado ${esperado}) — ${r.motivo}`),
      ...(trecho ? esperar(r.motivo.toLowerCase().includes(trecho.toLowerCase()), `motivo "${r.motivo}" não cita "${trecho}"`) : []),
    ];
  },
});
casos.push(
  rev('reversível: DELETE com backup da tabela', '-- backup: public.rest_contacts where id = 1\nbegin;\ndelete from public.rest_contacts where id = 1;\ncommit;', true),
  rev('reversível: UPDATE com backup da tabela', '-- backup: public.db_restaurants where restaurant_id = \'1\'\nbegin;\nupdate public.db_restaurants set city = \'Paris\' where restaurant_id = \'1\';\ncommit;', true),
  rev('reversível: só INSERT não precisa de backup', 'begin;\ninsert into public.rest_contacts (id, email) values (1, \'a@b.co\');\ncommit;', true, 'INSERT'),
  rev('NÃO reversível: UPDATE sem backup declarado', 'begin;\nupdate public.db_restaurants set city = \'Paris\' where restaurant_id = \'1\';\ncommit;', false, 'sem backup'),
  rev('NÃO reversível: backup de OUTRA tabela não conta', '-- backup: public.cities where id = 1\nbegin;\ndelete from public.rest_contacts where id = 1;\ncommit;', false, 'rest_contacts'),
  rev('NÃO reversível: duas tabelas, um backup só', '-- backup: public.a where id = 1\nbegin;\nupdate public.a set x=1 where id=1;\nupdate public.b set y=2 where id=2;\ncommit;', false, 'public.b'),
  rev('NÃO reversível: nextauth nunca, mesmo com backup', '-- backup: nextauth."User" where id = \'x\'\nbegin;\ndelete from nextauth."User" where id = \'x\';\ncommit;', false, 'nextauth'),
  rev('tabela sem schema é entendida como public', '-- backup: public.rest_contacts where id = 1\nbegin;\ndelete from rest_contacts where id = 1;\ncommit;', true),
);

// ── desfazer: o UPSERT de restauração é montado certo ───────────────────────
const { montarUpsert } = require('../../agents/dba-escrita/desfazer.js');
casos.push(
  { nome: 'desfazer: upsert restaura todas as colunas menos a pk, via ON CONFLICT', run: () => {
    const { sql, params } = montarUpsert('public', 'rest_contacts', 'id', [{ id: 1, email: 'a@b.co', phone: null }, { id: 2, email: 'c@d.co', phone: '+1' }]);
    return [
      ...esperar(/INSERT INTO "public"\."rest_contacts" \("id", "email", "phone"\)/.test(sql), 'lista de colunas errada: ' + sql),
      ...esperar(/json_populate_recordset\(NULL::"public"\."rest_contacts", \$1\)/.test(sql), 'sem json_populate_recordset'),
      ...esperar(/ON CONFLICT \("id"\) DO UPDATE SET "email" = EXCLUDED\."email", "phone" = EXCLUDED\."phone"/.test(sql), 'ON CONFLICT errado: ' + sql),
      ...esperar(params.length === 1 && JSON.parse(params[0]).length === 2, 'params errados'),
    ];
  } },
  { nome: 'desfazer: tabela só com pk vira DO NOTHING (não há o que atualizar)', run: () => esperar(/DO NOTHING$/.test(montarUpsert('public', 't', 'id', [{ id: 1 }]).sql), 'esperava DO NOTHING') },
  { nome: 'desfazer: recusa backup sem a pk entre as colunas', run: () => { try { montarUpsert('public', 't', 'id', [{ email: 'x' }]); return ['passou']; } catch (e) { return esperar(/chave primária/.test(e.message), e.message); } } },
  { nome: 'desfazer: recusa linhas com colunas diferentes entre si', run: () => { try { montarUpsert('public', 't', 'id', [{ id: 1, a: 1 }, { id: 2, b: 2 }]); return ['passou']; } catch (e) { return esperar(/colunas diferentes/.test(e.message), e.message); } } },
  { nome: 'desfazer: recusa identificador com injeção', run: () => { try { montarUpsert('public', 't"; drop table x; --', 'id', [{ id: 1 }]); return ['passou']; } catch (e) { return esperar(/identificador inválido/.test(e.message), e.message); } } },
  { nome: 'desfazer: recusa backup vazio', run: () => { try { montarUpsert('public', 't', 'id', []); return ['passou']; } catch (e) { return esperar(/sem linhas/.test(e.message), e.message); } } },
);

module.exports = { casos };
