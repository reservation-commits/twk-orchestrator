# ADR-015 — Porta única de saída da Aria e fim das promessas sem lastro

**Data:** 2026-09-11 · **Estado:** aceito · **Origem:** incidente com a cliente Nicole Eisenmann (BASF) · **trace_id:** `trc-reparo-20260911`

## Contexto

Em 11/09/2026 às 13:02 UTC a Aria respondeu a uma cliente — assistente do Managing Director da BASF, que escreve em inglês — com o seguinte texto, entregue dentro do template oficial da marca:

> "Escalei o caso à equipe com prioridade (SLA de 2 horas) para acelerar a confirmação junto ao Baan Chiang. A cliente foi informada do prazo e do canal de acompanhamento na conta."

Uma anotação interna, em português, em terceira pessoa, afirmando que "a cliente foi informada" numa mensagem que era a única comunicação existente.

A auditoria que se seguiu mostrou que o defeito visível era a ponta de dois defeitos estruturais:

1. **A Aria prometia o que a empresa não faz.** O protocolo de escalação do prompt mandava dizer "nossa equipe retorna em até 2 horas" (e 4 horas, e 1 dia útil, e 24/48 horas) e oferecer um "Concierge via WhatsApp". Nada disso existe: `escalate_to_human` apenas insere uma linha em `aria_escalations`, o alerta por e-mail está desligado por padrão, as 11 escalações da tabela estavam **todas** abertas — a mais antiga de 29/07 — e `reservations.followup_6h_sent_at` nunca foi preenchido em nenhuma linha da base: a cobrança automática ao restaurante jamais aconteceu. Só em 11/09 a promessa das "2 horas" foi feita três vezes (duas a Hanna Opsahl, uma a Nicole Eisenmann) sem nenhum contato ao restaurante.
2. **A rede de proteção só pegava uma família de defeito.** `looksLikeInternalNote` reconhecia a família do silêncio ("resposta vazia", "relatório automático") em 12 frases fixas, todas em português, e apenas nos 300 primeiros caracteres. Relato de ação em primeira pessoa, dump de JSON, narração de tool, nota em outro idioma, marcador `[[SILENCIO]]` com sufixo e o placeholder `"..."` passavam direto. Não havia nenhuma verificação de idioma em nenhum dos dois canais.

## Decisão

**1. Nenhum prazo de terceiro sai da boca da Aria.** O protocolo de escalação deixa de ter SLA. A tag registra o caso para auditoria e não aciona ninguém; quem resolve é a Aria, ponta a ponta (ADR-014). Onde o prompt prometia equipe e prazo, ele passa a oferecer o que a Aria executa na hora: alternativas equivalentes com link pronto, o contato do restaurante, o campo de observações, a conta profissional. A regra de ouro e a Lei #7, que **obrigavam** a citar um prazo em toda escalação, foram invertidas: é proibido citar prazo de ação humana ou de resposta do restaurante.

**2. Porta única de saída nos dois canais.** `outboundGate(resposta, entrada)` em `src/format.ts` é o único caminho para o cliente, chamado por `emailChannel.ts` e por `index.ts`. Barra, com motivo registrado: nota interna e relato de ação em 1ª pessoa (4 idiomas), vocabulário interno (SLA, nome de tool, nome de tabela, nome de coluna), JSON/dump, marcador de silêncio em qualquer posição, resposta vazia ou só reticências, texto que não cumprimenta nem fala com o destinatário, e **resposta em idioma diferente do da mensagem recebida**. Política fail-closed: na dúvida não envia, registra em `aria_scope_blocks` com `layer='outbound'` e o MAESTRO revisa. Silêncio é ruim; carta errada assinada pela marca é pior.

**2-bis. Discrição: honestidade não é exposição.** Correção do fundador em 11/09, sobre a primeira versão destas cartas. Dizer ao cliente que a casa "não é parceira", que "a mesa não é nossa" ou que "não podemos garantir" é comercialmente indefensável — a resposta natural dele é "então por que vocês oferecem esse restaurante no site?". Também não se escreve um parágrafo explicando um erro nosso: reconhece-se em uma frase e segue-se para a solução. Passa a ser proibido revelar ao cliente a distinção entre casa parceira e casa listada, a nossa falta de meios para forçar uma resposta, e qualquer detalhe de processo, fila ou falha interna. A fórmula que resolve honestidade e discrição ao mesmo tempo: **diga o que você já fez, diga o que o cliente recebe automaticamente, e dê uma data em que VOCÊ volta com alternativas** — nada disso depende de terceiro, nada disso expõe a casa. A contrapartida é inegociável: discrição nunca vira mentira, e continua proibido afirmar mesa, confirmação ou resposta que não existam.

**3. Três Leis Imutáveis novas.** #18 proíbe relatar ação ou pensar por escrito na mensagem, e falar do cliente em terceira pessoa numa mensagem dirigida a ele. #19 obriga a responder no idioma exato do cliente e declara que os modelos em português do prompt são estrutura, nunca texto a copiar. #20 fixa a discrição descrita acima. O mesmo vale fora da Aria: o rascunho ao cliente do Guardião da Reserva foi reescrito e a sua lista de tokens proibidos passou a barrar "not a partner", "cannot promise" e "depends on them".

**4. As mesmas travas nos dois lados.** As tools `send_*` do WhatsApp, que entregam texto ao aparelho antes da resposta final, passam a recusar corpo que o detector reprove. O canal de e-mail passa a neutralizar o marcador `[Sistema:` forjado pelo remetente, como o WhatsApp já fazia. O idioma do "chrome" do e-mail passa a vir da mensagem do cliente, não da resposta gerada.

**5. A distância entre promessa e ação vira número diário.** A Regência passa a apurar as pendências vivas sem nenhuma cobrança ao restaurante e a levantar achado crítico quando houver mesa em até três dias nessa situação. A fila de escalações deixa de ser "esperando uma pessoa" e passa a ser trabalho do MAESTRO, com log.

## Consequências

- A Aria fica mais honesta e menos vendedora: ela deixa de anunciar prazos que não controla. Em troca, tem de entregar alternativas na hora — o que ela sabe fazer.
- Algumas respostas legítimas serão barradas (falso positivo). O custo é um atendimento que atrasa e aparece no painel; o benefício é que nenhuma nota interna volta a sair assinada pela marca.
- A promessa só passa a ter lastro quando o lote do Guardião da Reserva for aprovado: **a cobrança ao restaurante depende dessa aprovação humana**, e sem ela o número de pendências sem contato continua subindo.
- Testes: `test/outboundGate.test.ts` fixa o texto exato do incidente como caso de regressão, junto com cartas legítimas em português, inglês e francês que não podem ser barradas. Suíte completa 115/115.

## Rastreabilidade

Auditorias em `orchestrator/logs/2026-09-11-incidente-aria.md`. Correções em `src/systemPrompt.ts` (36 trechos), `src/format.ts`, `src/emailChannel.ts`, `src/index.ts`, `src/tools.ts`, `src/claude.ts`, `src/dashboard/logger.ts`. Pacote de deploy `aria_agent_whatsapp-INCIDENTE-2026-09-11.zip`.

## Adendo de 2026-09-14 — nada de disponibilidade prometida, e alternativa só de quem confirma

Três dias depois, com as travas já em produção, a Aria respondeu a um cliente irritado (Alan Wilde, pedido FG8ATHCY no La Petite Maison) oferecendo três casas "with instant availability" e "confirmation in hand". As três nunca tinham confirmado um único pedido pela plataforma. A resposta passou pelo portão porque ele barrava forma e idioma, não uma promessa falsa escrita num bom inglês.

**Decisão.** (1) O portão de saída passa a barrar, em cinco idiomas, promessa de disponibilidade, confirmação imediata ou mesa garantida. (2) As buscas de restaurante entregam ao modelo o histórico de 90 dias de cada casa e a marca `confirma_pedidos` (≥4 pedidos e ≥50% aceitos, o mesmo critério do Guardião da Reserva). (3) Alternativa oferecida a quem ficou sem mesa só pode vir de casa que confirma; sem nenhuma, não se nomeia casa como solução. (4) A mesma regra vale para as cartas do MAESTRO (`exclusao.js`), que além disso passam a escrever no idioma do cliente, nunca no do país do restaurante.
