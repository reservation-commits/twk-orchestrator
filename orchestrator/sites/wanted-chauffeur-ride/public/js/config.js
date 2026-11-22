/* Wanted Chauffeur · configuração do site.
   É o único arquivo que precisa mudar ao hospedar em outro lugar. */
export const CONFIG = {
  /* Endereço da Central (API de reservas e de agenda), sem barra no fim.
     Vazio = o mesmo domínio da página: vale quando a Central serve /ride, ou quando o site principal faz
     rewrite de /api/chauffeur/* para a Central. Exemplo hospedando à parte: 'https://central.theworldkeys.com'.
     Nesse caso, o domínio da página precisa estar em CHAUFFEUR_ORIGINS na Central. */
  api: '',

  /* WhatsApp que recebe a mensagem pronta: só dígitos, com o código do país. */
  whatsapp: '33781937270',
  whatsappExibido: '+33 7 81 93 72 70',

  /* Quantos dias a faixa de dias mostra (o campo de data aceita até o horizonte que a API devolver). */
  diasNaFaixa: 14,

  /* Horários de 5 em 5 minutos, em AM/PM (decisão do fundador, 05/11/2026). */
  passoMin: 5,

  /* Horário que já vem marcado. */
  horaPadrao: '9:00 PM',
};
