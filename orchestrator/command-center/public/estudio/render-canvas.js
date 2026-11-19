/* Imagens prontas para postar, desenhadas no navegador (Canvas), na identidade do Wanted Chauffeur.
   window.WCRender.imagem({ fond, titre, sous_titre, bas, contador, formato }) → <canvas> 1080×1350 (post/carrossel) ou 1080×1920 (story)
   window.WCRender.overlay({ texte, assinatura }) → <canvas> 1080×1920 transparente (texto de tela de um Reel, para o CapCut)
   window.WCRender.baixar(canvas, nome) · window.WCRender.prontas() carrega as fontes antes de desenhar. */
(() => {
  'use strict';
  const C = { violet: '#8b5cf6', rose: '#ff4fa3', ciel: '#6fd3ff', branco: '#ffffff' };
  const FONTES = ['800 100px Unbounded', '700 60px Unbounded', '600 44px Manrope', '500 36px "JetBrains Mono"', '400 90px Yellowtail'];
  async function prontas() { try { await Promise.all(FONTES.map((f) => document.fonts.load(f))); } catch { /* fallback do sistema */ } }

  function fundo(ctx, W, H, fond, seed = 1) {
    let s = seed * 9301 + 49297; const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    ctx.fillStyle = '#0b0714'; ctx.fillRect(0, 0, W, H);
    if (fond === 'noir') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    if (fond === 'nuit') {
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0a0520'); g.addColorStop(.36, '#1d0f47'); g.addColorStop(.6, '#4a1a7a'); g.addColorStop(.67, '#0a0616'); g.addColorStop(1, '#05030b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const h = ctx.createRadialGradient(W / 2, H * .66, 10, W / 2, H * .66, W * .7); h.addColorStop(0, 'rgba(255,79,163,.55)'); h.addColorStop(1, 'rgba(255,79,163,0)'); ctx.fillStyle = h; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 14; i++) { const x = rnd() * W, y = H * (.56 + rnd() * .08), r = 8 + rnd() * 22; const b = ctx.createRadialGradient(x, y, 0, x, y, r); const cor = [ '255,209,102', '111,211,255', '255,79,163', '255,255,255' ][i % 4]; b.addColorStop(0, `rgba(${cor},.85)`); b.addColorStop(1, `rgba(${cor},0)`); ctx.fillStyle = b; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
      ctx.strokeStyle = 'rgba(255,79,163,.16)'; ctx.lineWidth = 2; for (let y = H * .68; y < H; y += 34) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      return;
    }
    if (fond === 'led') {
      const g = ctx.createRadialGradient(W / 2, H * .7, 10, W / 2, H * .7, W); g.addColorStop(0, '#1a0c36'); g.addColorStop(1, '#05030b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const l = ctx.createLinearGradient(0, H * .2, W, H * .8); l.addColorStop(.15, 'rgba(139,92,246,0)'); l.addColorStop(.35, 'rgba(139,92,246,.8)'); l.addColorStop(.5, 'rgba(255,79,163,.85)'); l.addColorStop(.65, 'rgba(111,211,255,.8)'); l.addColorStop(.85, 'rgba(111,211,255,0)');
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.filter = 'blur(40px)'; ctx.fillStyle = l; ctx.fillRect(0, 0, W, H); ctx.restore();
      const bar = ctx.createLinearGradient(W * .12, 0, W * .88, 0); bar.addColorStop(0, C.violet); bar.addColorStop(.5, C.rose); bar.addColorStop(1, C.ciel); ctx.fillStyle = bar; ctx.shadowColor = 'rgba(255,79,163,.7)'; ctx.shadowBlur = 50; ctx.fillRect(W * .12, H * .84, W * .76, 14); ctx.shadowBlur = 0;
      return;
    }
    if (fond === 'ciel') {
      const g = ctx.createRadialGradient(W / 2, H * .3, 10, W / 2, H * .3, H * .9); g.addColorStop(0, '#1d1147'); g.addColorStop(1, '#05030b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const v = ctx.createRadialGradient(W * .3, H * .34, 10, W * .3, H * .34, W * .6); v.addColorStop(0, 'rgba(139,92,246,.42)'); v.addColorStop(1, 'rgba(139,92,246,0)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 140; i++) { const x = rnd() * W, y = rnd() * H, r = .8 + rnd() * 2.6; ctx.fillStyle = ['#fff', '#cfe9ff', '#ffd9ec'][i % 3]; ctx.globalAlpha = .4 + rnd() * .6; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#07040f'); g.addColorStop(.6, '#0d0820'); g.addColorStop(1, '#130b2b'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const e = ctx.createLinearGradient(0, H * .46, 0, H * .7); e.addColorStop(0, 'rgba(111,211,255,.45)'); e.addColorStop(1, 'rgba(139,92,246,.3)'); ctx.save(); ctx.filter = 'blur(30px)'; ctx.fillStyle = e; ctx.fillRect(W * .18, H * .46, W * .64, H * .24); ctx.restore();
  }
  function vinheta(ctx, W, H) { const v = ctx.createRadialGradient(W / 2, H / 2, W * .35, W / 2, H / 2, W * .95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.62)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H); }
  function linhas(ctx, texto, largura) {
    const out = []; for (const par of String(texto || '').split(/\n/)) { let l = ''; for (const w of par.split(/\s+/)) { const t = l ? `${l} ${w}` : w; if (ctx.measureText(t).width > largura && l) { out.push(l); l = w; } else l = t; } out.push(l); } return out;
  }
  function escrever(ctx, texto, x, y, { fonte, cor = C.branco, largura, alinhar = 'center', entre = 1.12, sombra = true }) {
    ctx.font = fonte; ctx.fillStyle = cor; ctx.textAlign = alinhar; ctx.textBaseline = 'alphabetic';
    const tam = parseInt(fonte.match(/(\d+)px/)[1], 10); const ls = linhas(ctx, texto, largura);
    if (sombra) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6; }
    ls.forEach((l, i) => ctx.fillText(l, x, y + i * tam * entre));
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    return ls.length * tam * entre;
  }
  function tituloComCidade(ctx, texto, W, y, tam) {
    const partes = String(texto || '').split(/\s+·\s+/);
    const cidade = /^toulouse$/i.test(partes[0]) && partes.length > 1 ? partes.shift() : null;
    let dy = 0;
    if (cidade) { const g = ctx.createLinearGradient(W * .2, 0, W * .8, 0); g.addColorStop(0, C.violet); g.addColorStop(.55, C.rose); g.addColorStop(1, C.ciel); dy += escrever(ctx, cidade.toUpperCase(), W / 2, y, { fonte: `800 ${Math.round(tam * .62)}px Unbounded`, cor: g, largura: W * .86 }) + 10; }
    dy += escrever(ctx, partes.join(' · '), W / 2, y + dy, { fonte: `800 ${tam}px Unbounded`, largura: W * .86 });
    return dy;
  }
  function marca(ctx, W, H, contador) {
    const g = ctx.createLinearGradient(0, H - 200, 0, H); g.addColorStop(0, 'rgba(11,7,20,0)'); g.addColorStop(1, 'rgba(11,7,20,.85)'); ctx.fillStyle = g; ctx.fillRect(0, H - 200, W, 200);
    escrever(ctx, 'WANTED CHAUFFEUR', 70, H - 86, { fonte: '800 26px Unbounded', largura: W, alinhar: 'left', sombra: false });
    escrever(ctx, 'Vous jouez. On conduit. · @wantedchauffeur', 70, H - 44, { fonte: '500 26px "JetBrains Mono"', cor: 'rgba(255,255,255,.72)', largura: W, alinhar: 'left', sombra: false });
    if (contador) escrever(ctx, contador, W - 70, H - 44, { fonte: '500 26px "JetBrains Mono"', cor: 'rgba(255,255,255,.72)', largura: W, alinhar: 'right', sombra: false });
    const b = ctx.createLinearGradient(0, 0, W, 0); b.addColorStop(0, C.violet); b.addColorStop(.55, C.rose); b.addColorStop(1, C.ciel); ctx.fillStyle = b; ctx.fillRect(0, H - 10, W, 10);
  }

  function imagem({ fond = 'nuit', titre = '', sous_titre = '', bas = '', contador = '', formato = 'post', seed = 1 }) {
    const story = formato === 'story'; const W = 1080, H = story ? 1920 : 1350;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    fundo(ctx, W, H, fond, seed); vinheta(ctx, W, H);
    const topo = story ? H * .32 : H * .3;
    let y = topo; y += tituloComCidade(ctx, titre, W, y, story ? 92 : 84) + 26;
    if (sous_titre) y += escrever(ctx, sous_titre, W / 2, y + 20, { fonte: '600 44px Manrope', cor: 'rgba(255,255,255,.92)', largura: W * .8, entre: 1.25 });
    if (bas) { ctx.font = '500 34px "JetBrains Mono"'; const w = ctx.measureText(bas).width + 60; const yb = story ? H * .72 : H * .74; ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect((W - w) / 2, yb - 36, w, 66, 33); ctx.fill(); ctx.stroke(); escrever(ctx, bas, W / 2, yb + 10, { fonte: '500 34px "JetBrains Mono"', largura: W, sombra: false }); }
    marca(ctx, W, H, contador);
    return cv;
  }
  function overlay({ texte = '', assinatura = false }) {
    const W = 1080, H = 1920; const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    const [a, b] = String(texte).split(/\s+·\s+@/);
    if (assinatura || b) { escrever(ctx, a, W / 2, H * .66, { fonte: '800 64px Unbounded', largura: W * .86 }); if (b) escrever(ctx, `@${b}`, W / 2, H * .66 + 90, { fonte: '500 36px "JetBrains Mono"', cor: C.ciel, largura: W }); }
    else tituloComCidade(ctx, texte, W, H * .3, 92);
    return cv;
  }
  function baixar(cv, nome) { return new Promise((ok) => cv.toBlob((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => { URL.revokeObjectURL(url); ok(); }, 400); }, 'image/png')); }

  window.WCRender = { imagem, overlay, baixar, prontas };
})();
