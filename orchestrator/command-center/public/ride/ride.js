/* Wanted Chauffeur · page /ride (Fase 1, 19/11/2026). Script externo: a Central serve a página com CSP script-src 'self'.
   O que faz: calcula o preço, monta a mensagem do WhatsApp com a referência WTD-<origem>-XXXX, e ao clicar em
   "Préparer le message" GRAVA a reserva na Central (POST /api/chauffeur/reserva: nome de quem embarca, WhatsApp, trajeto,
   produto, data, hora, pessoas, recado, caixa de imagens). Só então abre o WhatsApp do Julien. A Central avisa o Julien.
   Se a gravação falhar (rede), o cliente ainda consegue abrir o WhatsApp: a mensagem leva a referência de todo jeito. */
(function(){
  var PRIX={transfer:{n:"Transfer",p:80,h:false},mad:{n:"Mise à disposition",p:90,h:true},night:{n:"Night Ride",p:250,h:false},game:{n:"Game Night",p:350,h:false},soiree:{n:"Soirée",p:390,h:false,plus:" + dîner"}};
  var $=function(id){return document.getElementById(id)};
  var produit=$("produit"),heures=$("heures"),lblH=$("lbl-heures"),date=$("date"),heure=$("heure"),seg=$("seg"),depart=$("depart"),arrivee=$("arrivee"),nom=$("nom"),tel=$("tel"),msg=$("msg"),img=$("img"),total=$("total"),totalpp=$("total-pp"),bubble=$("bubble"),reply=$("reply"),wa=$("wa"),refout=$("refout"),toast=$("toast"),lblA=$("lbl-arrivee"),submit=$("submit");
  var NUM="33781937270";
  var pax=6;
  /* A data padrão é hoje em Paris (o protótipo trazia uma data fixa). */
  (function(){try{var d=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());date.value=d;date.min=d}catch(e){}})();
  /* heures de 5 en 5 minutes, en AM/PM, de 12:00 AM à 11:55 PM ; 9:00 PM présélectionné */
  (function(){var f=document.createDocumentFragment();for(var m=0;m<24*60;m+=5){var h=Math.floor(m/60),mn=m%60,h12=h%12||12,ap=h<12?"AM":"PM";var o=document.createElement("option");o.textContent=h12+":"+(mn<10?"0":"")+mn+" "+ap;if(h===21&&mn===0)o.selected=true;f.appendChild(o)}heure.appendChild(f)})();
  /* Origem do pedido: a letra vem do link (?o=T TikTok · I Instagram · Y YouTube · W Twitch · H hôtel · S site). Sem letra = R, direto. */
  var ORIGEM=(function(){var o=(new URLSearchParams(location.search).get("o")||"R").toUpperCase();return /^[TIYWHS]$/.test(o)?o:"R"})();
  var ref=(function(){var a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",s="";for(var i=0;i<4;i++)s+=a[Math.floor(Math.random()*a.length)];return "WTD-"+ORIGEM+"-"+s})();
  /* Central: mesma origem por padrão (a página é servida por ela). Atrás de outro domínio, pôr o endereço em data-central
     no <html> — ou fazer o rewrite de /api/chauffeur/* junto com o de /ride. */
  var CENTRAL=(document.documentElement.getAttribute("data-central")||"").replace(/\/+$/,"");
  var RESERVA=CENTRAL+"/api/chauffeur/reserva";
  var gravada=false, gravando=false;
  refout.textContent=ref;
  function fmtDate(v){ if(!v) return "la date à préciser"; var d=new Date(v+"T12:00:00"); var j=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"][d.getDay()]; var m=["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"][d.getMonth()]; return j+" "+d.getDate()+" "+m; }
  function montant(){ var o=PRIX[produit.value]; var h=Math.max(2,parseInt(heures.value||"2",10)); return o.h? o.p*h : o.p; }
  function render(){
    var o=PRIX[produit.value]; lblH.hidden=!o.h; lblA.hidden=false;
    var m=montant(); total.textContent=m+" €"+(o.plus||"");
    totalpp.textContent=Math.round(m/pax)+" € par personne à "+pax+(o.plus?", hors dîner":"");
    var h=Math.max(2,parseInt(heures.value||"2",10));
    var lignes=["Bonjour, [Réf "+ref+"]",
      o.n+(o.h?" "+h+" h":"")+", "+fmtDate(date.value)+", "+heure.value+", "+pax+" personne"+(pax>1?"s":"")+".",
      "Départ : "+(depart.value.trim()||"à préciser")+(arrivee.value.trim()?" → "+arrivee.value.trim():"")+".",
      "Réservation au nom de "+(nom.value.trim()||"…")+".",
      (msg.value.trim()?msg.value.trim()+"\n":"")+"Images à bord : "+(img.checked?"ok pour publication":"privées")+"."];
    var text=lignes.join("\n");
    bubble.textContent=""; bubble.appendChild(document.createTextNode(text));
    var t=document.createElement("span");t.className="t";t.textContent="maintenant";bubble.appendChild(t);
    wa.href="https://wa.me/"+NUM+"?text="+encodeURIComponent(text);
    bubble.dataset.text=text;
    var r="Bonjour, c'est confirmé pour "+fmtDate(date.value)+" "+heure.value+", au nom de "+(nom.value.trim()||"…")+". "+m+" €"+(o.plus||"")+" pour la voiture. Réf "+ref+". Portes ouvertes à l'heure dite.";
    reply.textContent=r; var t2=document.createElement("span");t2.className="t";t2.textContent="exemple de réponse de Julien";reply.appendChild(t2);
  }
  function aviso(texto,ok){toast.style.color=ok?"var(--ok)":"var(--warn)";toast.textContent=texto}
  function corpo(){
    var o=PRIX[produit.value];
    return {codigo:ref,produto:produit.value,data:date.value||null,hora:heure.value||null,pessoas:pax,horas:o.h?Math.max(2,parseInt(heures.value||"2",10)):null,
      idioma:(document.documentElement.lang||"fr").slice(0,2),imagens:img.checked?"ok":"privadas",
      nome:nom.value.trim(),whatsapp:tel.value.trim()||null,partida:depart.value.trim()||null,destino:arrivee.value.trim()||null,recado:msg.value.trim()||null};
  }
  /* Grava a reserva na Central. Devolve uma promessa com {ok, erro}. Nunca lança. */
  function gravar(){
    if(gravada) return Promise.resolve({ok:true});
    if(gravando) return Promise.resolve({ok:false,erro:"en cours"});
    gravando=true;
    var ctrl=("AbortController" in window)?new AbortController():null; if(ctrl) setTimeout(function(){ctrl.abort()},8000);
    return fetch(RESERVA,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(corpo()),keepalive:true,signal:ctrl?ctrl.signal:undefined})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){return {status:r.status,j:j}})})
      .then(function(x){gravando=false; if(x.status===201||x.status===200){gravada=true;return {ok:true}} return {ok:false,status:x.status,erro:(x.j&&x.j.error)||("HTTP "+x.status)}})
      .catch(function(e){gravando=false;return {ok:false,erro:String(e&&e.message||e)}});
  }
  [produit,heures,date,heure,depart,arrivee,nom,tel,msg,img].forEach(function(el){el.addEventListener("input",render);el.addEventListener("change",render)});
  seg.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;Array.prototype.forEach.call(seg.children,function(x){x.setAttribute("aria-pressed","false")});b.setAttribute("aria-pressed","true");pax=parseInt(b.textContent,10);render()});
  document.querySelectorAll("[data-pick]").forEach(function(b){b.addEventListener("click",function(){produit.value=b.getAttribute("data-pick");render();document.getElementById("reserver").scrollIntoView({behavior:"smooth"});nom.focus({preventScroll:true})})});
  $("form").addEventListener("submit",function(e){e.preventDefault();
    if(!nom.value.trim()){aviso("Pas de nom, pas de mission : écrivez qui monte à bord.",false);nom.focus();return}
    render(); submit.disabled=true; aviso("Un instant, on enregistre la demande…",true);
    gravar().then(function(r){
      submit.disabled=false;
      if(r.ok){reply.hidden=false;aviso("Demande enregistrée (réf "+ref+"). Ouvrez WhatsApp pour l'envoyer à Julien.",true);return}
      if(r.status===400&&/WhatsApp/i.test(r.erro||"")){aviso("Vérifiez le numéro WhatsApp (format +33 6 12 34 56 78).",false);tel.focus();return}
      if(r.status===400&&/nome|nom/i.test(r.erro||"")){aviso("Écrivez le prénom et le nom de la personne qui monte à bord.",false);nom.focus();return}
      /* rede ou servidor: não trava o cliente, a referência vai na mensagem de todo jeito */
      reply.hidden=false; aviso("Le message est prêt. Ouvrez WhatsApp : Julien reçoit la demande avec la référence "+ref+".",true);
    });
  });
  wa.addEventListener("click",function(){ if(!gravada&&nom.value.trim()) gravar(); });
  $("copy").addEventListener("click",function(){ if(!gravada&&nom.value.trim()) gravar(); var t=bubble.dataset.text||"";
    function fb(){var r=document.createRange();r.selectNodeContents(bubble);var s=window.getSelection();s.removeAllRanges();s.addRange(r);toast.textContent="Texte sélectionné : copiez-le avec Ctrl+C."}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(function(){aviso("Message copié.",true)},fb)}else fb();
  });
  var mb=document.getElementById("menubtn"),mn=document.getElementById("menu");
  mb.addEventListener("click",function(){var o=!mn.classList.contains("open");mn.classList.toggle("open",o);mb.setAttribute("aria-expanded",String(o));mb.textContent=o?"✕":"☰"});
  mn.addEventListener("click",function(e){if(e.target.tagName==="A"){mn.classList.remove("open");mb.setAttribute("aria-expanded","false");mb.textContent="☰"}});
  render();
})();
