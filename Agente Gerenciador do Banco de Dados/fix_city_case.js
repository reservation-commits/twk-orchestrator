// fix_city_case.js — normaliza capitalização de `city` em publicados (idempotente).
// Dry-run; --apply grava. Só grava onde o valor muda.
const { Pool } = require('./twk-db-agent/node_modules/pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const q = (s, p) => pool.query(s, p);

// partículas que ficam minúsculas (exceto se forem a 1ª palavra)
const LOWER = new Set(['de','del','da','do','dos','das','di','du','des','la','le','les','el','las','los',
  'en','sur','im','am','an','von','van','der','den','of','the','and','e','y','à','a','lez','sous',
  'della','delle','dei','degli','dell','sui','sul','sulla','ai','al','lès','aux','sus','do','das']);
const hasLower = w => w !== w.toLocaleUpperCase();
const hasUpper = w => w !== w.toLocaleLowerCase();
// expansões/correções explícitas (não-casing) — chave em minúsculas
const SPECIAL = {
  'nyc':'New York',
  'hollywood fl':'Hollywood',
  'fort lauderdale':'Fort Lauderdale',
  'salt lake city':'Salt Lake City',
};

function capWord(w){
  if(!w) return w;
  // trata apóstrofo: d'isère -> d'Isère ; o'brien -> O'Brien
  if(w.includes("'") || w.includes('’')){
    const sep = w.includes('’') ? '’' : "'";
    const [a,...rest]=w.split(sep);
    const b=rest.join(sep);
    // se prefixo curto (d, l, dell) mantém minúsculo o prefixo só quando não é 1ª palavra (tratado fora)
    return a + sep + (b ? b.charAt(0).toLocaleUpperCase()+b.slice(1) : '');
  }
  // hífen: aix-en-provence -> Aix-en-Provence
  if(w.includes('-')) return w.split('-').map((p,i)=> LOWER.has(p.toLowerCase())? p.toLowerCase() : p.charAt(0).toLocaleUpperCase()+p.slice(1)).join('-');
  return w.charAt(0).toLocaleUpperCase()+w.slice(1);
}

function titleCity(raw){
  const key=(raw||'').trim().toLowerCase();
  if(SPECIAL[key]) return SPECIAL[key];
  const words=(raw||'').trim().split(/\s+/);
  return words.map((w,i)=>{
    // casing misto/próprio (tem maiúscula E minúscula) -> confia no que está lá
    if(hasLower(w) && hasUpper(w)) return w;
    const base=w.toLowerCase();
    if(i>0 && LOWER.has(base)) return base; // partícula no meio
    return capWord(base);
  }).join(' ');
}

(async()=>{
  const rows=(await q(`SELECT restaurant_id, city FROM db_restaurants
    WHERE published AND city IS NOT NULL AND city<>''`)).rows;
  const changes=[];
  for(const r of rows){
    const nu=titleCity(r.city);
    if(nu && nu!==r.city) changes.push({id:r.restaurant_id, from:r.city, to:nu});
  }
  // agrupa por de->para para revisão
  const byPair=new Map();
  changes.forEach(c=>{ const k=`${c.from}  ⇒  ${c.to}`; byPair.set(k,(byPair.get(k)||0)+1); });
  console.log(`${APPLY?'APPLY':'DRY-RUN'} — ${changes.length} linhas a alterar, ${byPair.size} transformações distintas\n`);
  [...byPair.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,c])=>console.log('  '+String(c).padStart(4)+'  '+k));

  if(APPLY && changes.length){
    for(const c of changes){
      await q(`UPDATE db_restaurants SET city=$1 WHERE restaurant_id=$2`,[c.to,c.id]);
    }
    console.log(`\n✔ GRAVADO: ${changes.length} linhas`);
  } else if(!APPLY){
    console.log('\n(dry-run — nada gravado; rode com --apply)');
  }
  pool.end();
})().catch(e=>{console.error('ERRO:',e.message);pool.end();});
