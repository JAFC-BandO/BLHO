// JFC Labs shop: fælles kode for alle sider under /shop/ (kurv, firmaoplysninger, produkter).

const SB = 'https://swmugtukacirgopjstdx.supabase.co';
const KEY = 'sb_publishable_izWXG-2mphLXS40f4eXwKg_pakWAUPi';   // offentlig, beskyttet af RLS
const FRAGT_OERE = 4900;   // samme som checkout-funktionen
const MAKS = 100;          // pr. linje, samme som checkout-funktionen (lageret sætter den reelle grænse)

// Mængderabat på varerne (ikke fragten) efter antal stk. i alt; samme regel og afrunding som checkout-funktionen
const rabatPct = (stk) => (stk >= 50 ? 10 : stk >= 10 ? 5 : 0);
const stykpris = (pris, pct) => Math.round(pris * (100 - pct) / 100);
// Antal på lager af en farve (lager kommer med fra hentProdukter)
const paaLager = (p, farve) => p.lager?.find((l) => l.farve === farve)?.antal ?? 0;

// Firmaoplysninger står kun her og sættes ind alle steder med data-firma="..."
const FIRMA = {
  navn: 'JFC Labs',
  adresse: 'Follerupgårdvej 34, 7160 Tørring',
  cvr: '36367571',
  mail: 'jfclabsshop@gmail.com',
};

const kr = (oere) => (oere / 100).toLocaleString('da-DK', { minimumFractionDigits: oere % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' kr.';
// Bump BILLED_V, når billederne renderes om; så henter browserne de nye i stedet for dem i deres cache
const BILLED_V = 4;
const billede = (sti) => `/shop/${sti}?v=${BILLED_V}`;
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
// Lægger op til antal i kurven (højst maks i alt for linjen) og giver linjens nye antal tilbage
function laegIKurv(id, farve, antal, maks = MAKS) {
  const k = hentKurv();
  let l = k.find((x) => x.id === id && x.farve === farve);
  if (!l) k.push(l = { id, farve, antal: 0 });
  l.antal = Math.min(maks, MAKS, l.antal + antal);
  gemKurv(k.filter((x) => x.antal > 0));
  return l.antal;
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
  const r = await fetch(`${SB}/rest/v1/produkter?select=id,navn,kort,beskrivelse,pris_oere,farver,maal,materiale,tags,lager(farve,antal)&order=sortering${filter}`, {
    headers: { apikey: KEY }, cache: 'no-cache',
  });
  if (!r.ok) throw new Error('Produkterne kunne ikke hentes.');
  return r.json();
}

// 360°: billede 1 kan drejes rundt og vippes lidt op og ned. Rammerne ligger i billeder/360/ som
// <produkt>-<farve>-<højde>-<nr>.webp: 5 højder á 10° (højde 2 er billede 1's) og 36 rammer á 10° rundt.
// start() giver stien til billede 1 i den valgte farve, eller '' når et andet billede vises.
const HOEJDER = 5, MIDT = 2, RUNDT = 36;
const HOEJDE_TEKST = ['set 20 grader lavere', 'set 10 grader lavere', '', 'set 10 grader højere', 'set 20 grader højere'];
function drejbar(boks, img, start, skyder) {
  let vinkel = 0, hoejde = MIDT, fra = null, sidst = null, flyttet = 0;
  const rammer = {};
  const url = (h, k) => billede(start().replace('billeder/', 'billeder/360/').replace(/-1\.webp$/, `-${h}-${String(((k % RUNDT) + RUNDT) % RUNDT).padStart(2, '0')}.webp`));
  const klar = (u) => rammer[u]?.complete && rammer[u].naturalWidth;
  // Hent højderne (midterhøjden alene, eller alle); rammerne nærmest den aktuelle vinkel bestilles først
  function hent(alle) {
    if (!start()) return;
    const k0 = Math.round(vinkel / 10);
    for (const h of alle ? [MIDT, 1, 3, 0, 4] : [MIDT]) for (let d = 0; d <= RUNDT / 2; d++) for (const k of [k0 + d, k0 - d]) {
      const u = url(h, k); rammer[u] ||= Object.assign(new Image(), { src: u, onload: vis });
    }
  }
  // Den rigtige ramme, ellers den nærmeste, der allerede er hentet; vinklen går forud for højden
  function vis() {
    if (!start()) return;
    const k = Math.round(vinkel / 10);
    for (let d = 0; d <= RUNDT / 2; d++) for (const h of [Math.round(hoejde), MIDT]) for (const kk of [k + d, k - d]) {
      const u = url(h, kk);
      if (klar(u)) { if (img.getAttribute('src') !== u) img.src = u; return; }
    }
  }
  function drej(dv, dh) {
    if (!start() || (!dv && !dh)) return;
    vinkel = (((vinkel + dv) % 360) + 360) % 360;
    hoejde = Math.min(HOEJDER - 1, Math.max(0, hoejde + dh));
    hent(true);
    vis();
    if (skyder) {
      const g = (Math.round(vinkel / 10) % RUNDT) * 10, t = HOEJDE_TEKST[Math.round(hoejde)];
      boks.setAttribute('aria-valuenow', g);
      boks.setAttribute('aria-valuetext', `${g} grader rundt${t ? ', ' + t : ''}`);
    }
    boks.dispatchEvent(new Event('drejet'));
  }
  boks.addEventListener('pointerenter', () => hent(true));
  boks.addEventListener('pointerleave', () => { sidst = null; });
  boks.addEventListener('pointerdown', (e) => { hent(true); fra = [e.clientX, e.clientY]; flyttet = 0; });
  for (const t of ['pointerup', 'pointercancel']) addEventListener(t, () => { fra = null; });
  boks.addEventListener('pointermove', (e) => {
    // Én omgang over billedets bredde og alle fem højder over dets højde. Musen drejer bare ved at bevæge sig hen over;
    // en finger trækker (CSS touch-action afgør, om et lodret træk vipper eller scroller siden)
    const pv = 360 / boks.clientWidth, ph = (HOEJDER - 1) / boks.clientHeight;
    const forrige = e.pointerType === 'mouse' ? sidst : fra;
    if (e.pointerType === 'mouse') sidst = [e.clientX, e.clientY];
    else if (fra) fra = [e.clientX, e.clientY];
    if (!forrige) return;
    const dx = e.clientX - forrige[0], dy = e.clientY - forrige[1];
    if (fra) flyttet += Math.abs(dx) + Math.abs(dy);
    drej(dx * pv, dy * ph);
  });
  // Et træk på et produktkort må ikke åbne produktet
  boks.addEventListener('click', (e) => { if (flyttet > 8) { e.preventDefault(); e.stopPropagation(); } flyttet = 0; }, true);
  if (skyder) boks.addEventListener('keydown', (e) => {
    const d = { ArrowRight: [10, 0], ArrowLeft: [-10, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (d && start()) { e.preventDefault(); drej(...d); }
  });
  return { hent: () => hent(false), nulstil: () => { vinkel = 0; hoejde = MIDT; } };
}
const IKON_360 = '<svg class="ikon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>';

// Produktkort til forsiden og "Du kan også bruge". Navnet er linket og dækker hele kortet; farveprikkerne skifter
// kortets farve, og 360°-knappen slår drejning til (først da hentes rammerne, og et træk åbner ikke produktet)
function produktkort(p) {
  const f = p.farver[0] || { navn: '', billeder: [] };
  const b1 = f.billeder[0];
  const link = (fa) => `/shop/produkt/?id=${encodeURIComponent(p.id)}${fa.navn ? '&farve=' + encodeURIComponent(fa.navn.toLowerCase()) : ''}`;
  return `<article class="kort">
    <div class="ramme"${b1 ? ` data-drej="${esc(b1)}"` : ''}>${b1 ? `<img src="${billede(b1)}" alt="" width="1000" height="1000" loading="lazy" draggable="false">
      <button class="tre60" type="button" aria-pressed="false" aria-label="Drej ${esc(p.navn.toLowerCase())} 360 grader">${IKON_360}360°</button>` : ''}</div>
    <h3><a href="${link(f)}">${esc(p.navn)}</a></h3>
    <p>${esc(p.kort)}</p>
    <div class="bund"><span class="pris">${kr(p.pris_oere)}${p.farver.some((x) => paaLager(p, x.navn) > 0) ? '' : ' <span class="udsolgt">Udsolgt</span>'}</span>
      <div class="prikker" role="group" aria-label="Farve">${p.farver.map((x, i) => `<button type="button" aria-pressed="${i === 0}" aria-label="${esc(x.navn)}" data-billede="${esc(x.billeder[0] || '')}" data-link="${esc(link(x))}"><span style="background:${esc(x.hex)}"></span></button>`).join('')}</div></div>
  </article>`;
}
// Gør kortene levende, efter at de er sat ind: farvevalg og 360°
function aktiverKort(rod) {
  rod.querySelectorAll('.kort').forEach((kort) => {
    const r = kort.querySelector('[data-drej]');
    if (!r) return;
    const img = r.querySelector('img'), knap = r.querySelector('.tre60'), a = kort.querySelector('h3 a');
    const spin = drejbar(r, img, () => (r.classList.contains('drejer') ? r.dataset.drej : ''));
    knap.addEventListener('click', () => {
      const til = r.classList.toggle('drejer');
      knap.setAttribute('aria-pressed', til);
      spin.nulstil();
      if (til) spin.hent(); else img.src = billede(r.dataset.drej);
    });
    kort.querySelectorAll('.prikker button').forEach((b) => b.addEventListener('click', () => {
      kort.querySelectorAll('.prikker button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      r.dataset.drej = b.dataset.billede;
      a.href = b.dataset.link;
      img.src = billede(b.dataset.billede);
      spin.nulstil();
      if (r.classList.contains('drejer')) spin.hent();
    }));
  });
}

document.querySelectorAll('[data-firma]').forEach((el) => { el.textContent = FIRMA[el.dataset.firma]; });
document.querySelectorAll('[data-firma-mail]').forEach((a) => { a.href = 'mailto:' + FIRMA.mail; a.textContent = FIRMA.mail; });
document.querySelectorAll('[data-fragt]').forEach((el) => { el.textContent = kr(FRAGT_OERE); });
visKurvAntal();
