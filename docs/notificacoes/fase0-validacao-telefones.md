# Fase 0 — Validação E.164 da base de telefones

> Gerado em 2026-09-21 · credencial `twk_ro` (somente leitura) · nada foi escrito no banco.
> Biblioteca: `libphonenumber-js/max` 1.13.6 (metadados completos, com tipo de linha).
> Dono do documento: Orquestrador. Rotulagem: fato × suposição × lacuna.

## Por que este relatório existe

O WhatsApp transacional não pode ser ligado antes de sabermos quais números entregam.
Um template enviado ao número errado entrega nome, restaurante e data de reserva de um
cliente a um desconhecido — vazamento de dado pessoal — e derruba o *quality rating* do
nosso número na Meta. Este é o pré-requisito da Fase 1.

## Método

Para cada telefone testamos duas leituras concorrentes:

- **A — internacional**: `"+" + dígitos`. É exatamente o que `normalizePhone()` produz hoje,
  ou seja, **o número para onde a mensagem iria se ligássemos o sistema agora**.
- **B — nacional brasileiro**: os mesmos dígitos lidos como número do Brasil. Testada porque
  a análise de prefixos mostrou DDDs (65, 85, 91, 14, 16, 17, 19, 12, 21, 31) ocupando a
  posição do código de país.

| Veredito | Significado | Decisão operacional |
|---|---|---|
| `ENVIAVEL` | só a leitura A é válida, e a linha aceita WhatsApp | **enviar** |
| `ENVIAVEL_NAO_MOVEL` | leitura A válida, mas é fixo/VoIP | e-mail (fixo não tem WhatsApp) |
| `AMBIGUO_BR` | A **e** B válidas — duas leituras possíveis do mesmo número | **quarentena** |
| `CORRIGIVEL_BR` | A inválida, B válida — quase certamente BR sem o +55 | quarentena, recuperável |
| `INVALIDO` | nenhuma leitura válida | e-mail; recadastrar |

**[Lacuna declarada]** Não existe campo de país na tabela `nextauth."User"`. Por isso só
testamos a leitura nacional brasileira, que é a que os dados sustentam. Um cliente francês
que tenha gravado o número em formato nacional cairá em `INVALIDO`, não em `CORRIGIVEL`.
A correção definitiva é o seletor de país no formulário do site.

## Base inteira (contas ativas com telefone)

| Veredito | Nº | % |
|---|---:|---:|
| `ENVIAVEL` | 16799 | 74.2% |
| `ENVIAVEL_NAO_MOVEL` | 194 | 0.9% |
| `AMBIGUO_BR` | 245 | 1.1% |
| `CORRIGIVEL_BR` | 544 | 2.4% |
| `INVALIDO` | 4854 | 21.4% |
| `VAZIO` | 2 | 0.0% |
| **Total** | **22638** | 100% |

### Países dos enviáveis

| País | Enviáveis |
|---|---:|
| US | 3938 |
| GB | 1713 |
| SG | 1215 |
| FR | 751 |
| CA | 722 |
| AU | 709 |
| HK | 648 |
| IT | 502 |
| DE | 489 |
| BR | 429 |
| MY | 393 |
| IL | 349 |

## Clientes com reserva nos últimos 180 dias

| Veredito | Nº | % |
|---|---:|---:|
| `ENVIAVEL` | 1821 | 81.2% |
| `ENVIAVEL_NAO_MOVEL` | 21 | 0.9% |
| `AMBIGUO_BR` | 33 | 1.5% |
| `CORRIGIVEL_BR` | 82 | 3.7% |
| `INVALIDO` | 286 | 12.8% |
| **Total** | **2243** | 100% |

### Países dos enviáveis

| País | Enviáveis |
|---|---:|
| US | 356 |
| GB | 164 |
| SG | 132 |
| FR | 113 |
| BR | 81 |
| IT | 77 |
| CA | 63 |
| HK | 57 |
| DE | 48 |
| IN | 45 |
| IL | 43 |
| ES | 33 |

## Clientes com reserva futura

| Veredito | Nº | % |
|---|---:|---:|
| `ENVIAVEL` | 94 | 82.5% |
| `ENVIAVEL_NAO_MOVEL` | 1 | 0.9% |
| `AMBIGUO_BR` | 1 | 0.9% |
| `CORRIGIVEL_BR` | 8 | 7.0% |
| `INVALIDO` | 10 | 8.8% |
| **Total** | **114** | 100% |

### Países dos enviáveis

| País | Enviáveis |
|---|---:|
| US | 28 |
| SG | 10 |
| BR | 7 |
| JP | 5 |
| FR | 4 |
| HK | 4 |
| IL | 3 |
| GB | 3 |
| CA | 3 |
| MO | 2 |
| CH | 2 |
| NL | 2 |

## Clientes com reserva futura ACEITA (piloto)

| Veredito | Nº | % |
|---|---:|---:|
| `ENVIAVEL` | 10 | 66.7% |
| `ENVIAVEL_NAO_MOVEL` | 1 | 6.7% |
| `CORRIGIVEL_BR` | 3 | 20.0% |
| `INVALIDO` | 1 | 6.7% |
| **Total** | **15** | 100% |

## O que acontece se ligarmos hoje, sem corrigir nada

`normalizePhone()` cola um `+` nos dígitos e envia. Sobre a base inteira (22638 contas):

- **16799** chegariam ao destinatário certo;
- **194** iriam para linha fixa/VoIP — não entregam;
- **245** iriam para um número que existe, mas pode ser de outra pessoa em outro país;
- **544** falhariam no envio (número inexistente);
- **4854** falhariam no envio.

Os `AMBIGUO_BR` são o risco sério: **não falham** — entregam a um estranho.

Sinais de origem da sujeira: **5574** telefones gravados sem `+`; **2300** começando
com `0` (prefixo de tronco nacional, que não existe em E.164).

## Anatomia do balde `INVALIDO` — dá para recuperar por dedução?

São 4854 números. **Apenas 286 pertencem a quem reservou nos últimos
180 dias** — 94% do balde é base dormente. Para a notificação transacional, o impacto
imediato é pequeno; o problema é de qualidade de cadastro, não de operação.

Forma da falha:

- **2229** começam com `0` — prefixo de tronco nacional (formato europeu), que não existe em E.164;
- **277** passam de 15 dígitos (teto do E.164) — provavelmente dois números colados no mesmo campo;
- **180** têm menos de 8 dígitos — não é número discável;
- **41** são dígito repetido ou sequência (`11111…`, `12345…`) — preenchimento falso.

Testamos releitura como número nacional em 15 países:

| Resultado | Nº |
|---|---:|
| válido em **um único** país (recuperável) | 1007 |
| válido em **vários** países (ambíguo) | 1545 |
| inválido em todos (irrecuperável) | 2302 |

Dos "recuperáveis", a distribuição por país é DE=903, CH=31, BE=25, FR=23, IT=12, AE=8, NL=2, IN=1.

**[Suposição — não tratar como fato]** A concentração em DE é quase certamente artefato do
método, não 900 clientes alemães: o plano de numeração da Alemanha tem regras de comprimento
muito frouxas, então quase qualquer sequência iniciada por `0` valida como alemã. A prova
indireta: entre os números **bem formatados**, DE aparece 489 vezes. Seria estranho o balde
quebrado ter o dobro de alemães do balde íntegro.

**Conclusão:** o balde `INVALIDO` **não é recuperável por dedução**. Tirando o artefato alemão,
sobra ambiguidade ou lixo. Estes números só voltam à operação se o cliente informar de novo.
Adivinhar aqui é exatamente o erro que produz vazamento de dado pessoal.

## Próximo passo

1. Seletor de país no formulário de reserva do site, gravando E.164 — sem isso a sujeira volta.
2. Coluna `phone_e164` + `phone_status` em `nextauth."User"`, populada por este validador.
   **DDL e UPDATE exigem aprovação do fundador** (constituição) e passam por
   `orchestrator/agents/dba-escrita/executar.js`.
3. A Aria só envia para `phone_status = 'ENVIAVEL'`. Todo o resto segue por e-mail.
4. Quarentena (`AMBIGUO_BR` + `CORRIGIVEL_BR`) é resolvida perguntando ao cliente no
   próximo contato — nunca adivinhando.
