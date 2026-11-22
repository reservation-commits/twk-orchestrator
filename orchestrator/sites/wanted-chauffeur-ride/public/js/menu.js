/* Wanted Chauffeur · menu do celular (abre e fecha; fecha ao escolher uma seção). */
export function iniciarMenu() {
  const botao = document.getElementById('menubtn'), menu = document.getElementById('menu');
  if (!botao || !menu) return;
  const abrir = (sim) => { menu.classList.toggle('open', sim); botao.setAttribute('aria-expanded', String(sim)); botao.textContent = sim ? '✕' : '☰'; };
  botao.addEventListener('click', () => abrir(!menu.classList.contains('open')));
  menu.addEventListener('click', (e) => { if (e.target.tagName === 'A') abrir(false); });
}
