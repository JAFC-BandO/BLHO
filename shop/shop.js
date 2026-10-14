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
function produktkort(p) {
  const f = p.farver[0] || { billeder: [] };
  const [b1, b2] = f.billeder;
  return `<a class="kort" href="/shop/produkt/?id=${encodeURIComponent(p.id)}">
    <div class="ramme">${b1 ? `<img src="${billede(b1)}" alt="" width="1000" height="1000" loading="lazy">` : ''}${b2 ? `<img src="${billede(b2)}" alt="" width="1000" height="1000" loading="lazy">` : ''}</div>
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
