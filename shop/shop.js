// JFC Labs shop: fælles kode for alle sider under /shop/ (kurv, firmaoplysninger, produkter).

const SB = 'https://swmugtukacirgopjstdx.supabase.co';
const KEY = 'sb_publishable_izWXG-2mphLXS40f4eXwKg_pakWAUPi';   // offentlig, beskyttet af RLS
const FRAGT_OERE = 4900;   // samme som checkout-funktionen
const MAKS = 20;           // pr. linje, samme som checkout-funktionen

// Firmaoplysninger står kun her og sættes ind alle steder med data-firma="..."
const FIRMA = {
  navn: 'JFC Labs',
  adresse: 'Follerupgårdvej 34, 7160 Tørring',
  cvr: '36367571',
  mail: 'jfclabsshop@gmail.com',
};

const kr = (oere) => (oere / 100).toLocaleString('da-DK', { minimumFractionDigits: oere % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' kr.';
const billede = (sti) => '/shop/' + sti;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Kurven ligger i browserens lokale lager: [{ id, farve, antal }]. Virker siden uden, er kurven bare tom.
const KURV = 'jfclabs-kurv';
function hentKurv() {
  try {
    const k = JSON.parse(localStorage.getItem(KURV));
    return Array.isArray(k) ? k.filter((l) => l && typeof l.id === 'string' && typeof l.farve === 'string' && Number.isInteger(l.antal) && l.antal > 0) : [];
  } catch { return []; }
}
function gemKurv(k) {
  try { localStorage.setItem(KURV, JSON.stringify(k)); } catch {}
  visKurvAntal();
}
function laegIKurv(id, farve, antal) {
  const k = hentKurv();
  const l = k.find((x) => x.id === id && x.farve === farve);
  if (l) l.antal = Math.min(MAKS, l.antal + antal); else k.push({ id, farve, antal: Math.min(MAKS, antal) });
  gemKurv(k);
}
function visKurvAntal() {
  const n = hentKurv().reduce((a, l) => a + l.antal, 0);
  document.querySelectorAll('[data-kurv-antal]').forEach((el) => { el.textContent = n || ''; });
  document.querySelectorAll('.kurvknap').forEach((a) => a.setAttribute('aria-label', n ? `Kurv, ${n} ${n === 1 ? 'vare' : 'varer'}` : 'Kurv, tom'));
}
addEventListener('storage', (e) => { if (e.key === KURV) visKurvAntal(); });

// Produkter fra Supabase (kun aktive kan læses)
async function hentProdukter(id) {
  const filter = id ? '&id=eq.' + encodeURIComponent(id) : '';
  const r = await fetch(`${SB}/rest/v1/produkter?select=id,navn,kort,beskrivelse,pris_oere,farver,maal,materiale&order=sortering${filter}`, {
    headers: { apikey: KEY }, cache: 'no-cache',
  });
  if (!r.ok) throw new Error('Produkterne kunne ikke hentes.');
  return r.json();
}

// Produktkort til forsiden og "Du kan også bruge": første farves billede 1, og billede 2 ved hover
// 360°: billede 1 kan drejes rundt og vippes lidt op og ned. Rammerne ligger i billeder/360/ som
// <produkt>-<farve>-<højde>-<nr>.webp: 5 højder á 10° (højde 2 er billede 1's) og 36 rammer á 10° rundt.
// start() giver stien til billede 1 i den valgte farve, eller '' når et andet billede vises.
const HOEJDER = 5, MIDT = 2, RUNDT = 36;
const HOEJDE_TEKST = ['set 20 grader lavere', 'set 10 grader lavere', '', 'set 10 grader højere', 'set 20 grader højere'];
function drejbar(boks, img, start, skyder) {
  let vinkel = 0, hoejde = MIDT, fra = null, flyttet = 0;
  const rammer = {};
  const url = (h, k) => billede(start().replace('billeder/', 'billeder/360/').replace(/-1\.webp$/, `-${h}-${String(((k % RUNDT) + RUNDT) % RUNDT).padStart(2, '0')}.webp`));
  const klar = (u) => rammer[u]?.complete && rammer[u].naturalWidth;
  // Hent en hel højde; rammerne vises, efterhånden som de kommer
  function hent(h) {
    if (!start()) return;
    for (let k = 0; k < RUNDT; k++) { const u = url(h, k); rammer[u] ||= Object.assign(new Image(), { src: u, onload: vis }); }
  }
  // Den rigtige ramme, ellers den nærmeste, der allerede er hentet (i samme højde, så i midterhøjden)
  function vis() {
    if (!start()) return;
    const k = Math.round(vinkel / 10);
    for (const h of [Math.round(hoejde), MIDT]) for (let d = 0; d <= RUNDT / 2; d++) for (const kk of [k + d, k - d]) {
      const u = url(h, kk);
      if (klar(u)) { if (img.getAttribute('src') !== u) img.src = u; return; }
    }
  }
  function drej(dv, dh) {
    if (!start() || (!dv && !dh)) return;
    vinkel = (((vinkel + dv) % 360) + 360) % 360;
    hoejde = Math.min(HOEJDER - 1, Math.max(0, hoejde + dh));
    hent(MIDT); hent(Math.round(hoejde));
    vis();
    if (skyder) {
      const g = (Math.round(vinkel / 10) % RUNDT) * 10, t = HOEJDE_TEKST[Math.round(hoejde)];
      boks.setAttribute('aria-valuenow', g);
      boks.setAttribute('aria-valuetext', `${g} grader rundt${t ? ', ' + t : ''}`);
    }
    boks.dispatchEvent(new Event('drejet'));
  }
  boks.addEventListener('pointerenter', () => hent(MIDT));
  boks.addEventListener('pointerdown', (e) => { hent(MIDT); fra = [e.clientX, e.clientY]; flyttet = 0; });
  for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { fra = null; });
  boks.addEventListener('pointermove', (e) => {
    // Én omgang over billedets bredde og alle fem højder over dets højde. Musen drejer bare ved at bevæge sig hen over;
    // en finger trækker (lodret træk, der starter lodret, scroller siden som normalt)
    const pv = 360 / boks.clientWidth, ph = (HOEJDER - 1) / boks.clientHeight;
    let dx = e.movementX, dy = e.movementY;
    if (e.pointerType !== 'mouse') {
      if (!fra) return;
      dx = e.clientX - fra[0]; dy = e.clientY - fra[1]; fra = [e.clientX, e.clientY];
    }
    if (fra) flyttet += Math.abs(dx) + Math.abs(dy);
    drej(dx * pv, dy * ph);
  });
  // Et træk på et produktkort må ikke åbne produktet
  boks.addEventListener('click', (e) => { if (flyttet > 8) { e.preventDefault(); e.stopPropagation(); } flyttet = 0; }, true);
  if (skyder) boks.addEventListener('keydown', (e) => {
    const d = { ArrowRight: [10, 0], ArrowLeft: [-10, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (d && start()) { e.preventDefault(); drej(...d); }
  });
  return { hent: () => hent(MIDT), nulstil: () => { vinkel = 0; hoejde = MIDT; } };
}
// Gør produktkortenes billeder drejbare (efter at kortene er sat ind)
function drejKort(rod) {
  rod.querySelectorAll('[data-drej]').forEach((r) => drejbar(r, r.querySelector('img'), () => r.dataset.drej));
}

function produktkort(p) {
  const f = p.farver[0] || { billeder: [] };
  const b1 = f.billeder[0];
  return `<a class="kort" href="/shop/produkt/?id=${encodeURIComponent(p.id)}">
    <div class="ramme"${b1 ? ` data-drej="${esc(b1)}"` : ''}>${b1 ? `<img src="${billede(b1)}" alt="" width="1000" height="1000" loading="lazy" draggable="false"><span class="tre60" aria-hidden="true"><svg class="ikon" viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>360°</span>` : ''}</div>
    <h3>${esc(p.navn)}</h3>
    <p>${esc(p.kort)}</p>
    <div class="bund"><span class="pris">${kr(p.pris_oere)}</span>
      <span class="prikker" aria-label="${p.farver.length} farver: ${esc(p.farver.map((x) => x.navn).join(', '))}">${p.farver.map((x) => `<span style="background:${esc(x.hex)}"></span>`).join('')}</span></div>
  </a>`;
}

document.querySelectorAll('[data-firma]').forEach((el) => { el.textContent = FIRMA[el.dataset.firma]; });
document.querySelectorAll('[data-firma-mail]').forEach((a) => { a.href = 'mailto:' + FIRMA.mail; a.textContent = FIRMA.mail; });
document.querySelectorAll('[data-fragt]').forEach((el) => { el.textContent = kr(FRAGT_OERE); });
visKurvAntal();
