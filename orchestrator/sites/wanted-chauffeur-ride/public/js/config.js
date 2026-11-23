/* Wanted Chauffeur · configuração do site.
   É o único arquivo que precisa mudar ao hospedar em outro lugar. */
export const CONFIG = {
  /* Endereço da Central (API de reservas e de agenda), sem barra no fim.
     O site vive em ride.theworldkeys.com e a API na Central, então o endereço é absoluto (a Central aceita a origem
     ride.theworldkeys.com por padrão; outro domínio precisa entrar em CHAUFFEUR_ORIGINS lá).
     Vazio = mesmo domínio da página (só se o host do site repassar /api/chauffeur/* para a Central). */
  api: /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? '' : 'https://theworldkeys-maestro.xis4ee.easypanel.host',
  /* ↑ no computador (npm run dev) fica vazio: o servidor-dev responde a API simulada ou repassa à Central (CENTRAL_URL). */

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
