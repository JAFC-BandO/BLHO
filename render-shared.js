// Delt render-logik for ét positioneret element -- den ENESTE kilde til hvordan
// titel/tekst/billede/video/rotator/miljoeffekt tegnes op. Bruges af skaerm.html (den rigtige
// Pi-visning) og af redigeringssidens "Live nu paa skaermen"-forhaandsvisning, saa de to
// aldrig kan gaa i utakt med hinanden -- ingen af dem "opfinder" sin egen udgave af renderingen.

const MILJOEFFEKT_URL = 'https://www.boerneloppen.dk/boerneloppen-theme/world_goals/calculateConsumptionVariables.json';

// DR's eget RSS-feed har ingen CORS-header (bekraeftet: `curl -sI` viser ingen
// Access-Control-Allow-Origin) -- en browser kan derfor ikke hente det direkte, uanset
// hvilket JS-bibliotek man bruger. rss2json.com fungerer som mellemled: henter feedet
// server-side og returnerer JSON med CORS aabent. Ingen API-noegle noedvendig til dette
// simple kald (bekraeftet virker).
const DR_RSS_FEED_URL = 'https://www.dr.dk/nyheder/service/feeds/senestenyt';
const RSS2JSON_URL = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(DR_RSS_FEED_URL);

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function stripInlineFontSize(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('[style]').forEach(node => {
    node.style.fontSize = '';
    if (!node.getAttribute('style').trim()) node.removeAttribute('style');
  });
  return tmp.innerHTML;
}

function youtubeEmbedUrl(url) {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (!m) return url;
  const id = m[1];
  return 'https://www.youtube.com/embed/' + id + '?autoplay=1&mute=1&loop=1&controls=0&playlist=' + id;
}

function formatDanskTal(n) {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildUrNode(registerInterval) {
  const el = document.createElement('div');
  el.className = 'ur-display';
  const hh = document.createElement('span');
  const colon = document.createElement('span');
  colon.textContent = ':';
  colon.className = 'ur-colon';
  const mm = document.createElement('span');
  el.appendChild(hh);
  el.appendChild(colon);
  el.appendChild(mm);

  // cqw alene passer kun til boksens BREDDE, ikke hoejden -- en streg-tynd eller kvadratisk
  // boks ville faa en tekst der enten er alt for stor (klippes af overflow:hidden) eller alt
  // for lille. Genberegn i stedet ud fra elementets egen, rent faktiske rect (begge akser),
  // virker uanset kontekst (skaerm, Live View, redigerings-canvas) da den ikke er afhaengig
  // af container-type/cqw at regne rigtigt.
  const resize = () => {
    const rect = el.getBoundingClientRect();
    if (rect.width && rect.height) {
      el.style.fontSize = Math.min(rect.height * 0.7, rect.width / 3) + 'px';
    }
  };
  const tick = () => {
    const d = new Date();
    hh.textContent = String(d.getHours()).padStart(2, '0');
    mm.textContent = String(d.getMinutes()).padStart(2, '0');
    colon.style.opacity = d.getSeconds() % 2 === 0 ? '1' : '0';
    resize();
  };
  tick();
  // Foerste maaling lige efter oprettelse rammer altid 0x0 (noden er endnu ikke sat ind i
  // DOM'en af den kaldende funktion) -- CSS'ens 10cqw-fallback slaar saa igennem i et helt
  // sekund foer foerste tick retter den, hvilket saas som stoerrelsen der "hopper". rAF
  // koerer lige foer naeste repaint, efter noden er blevet indsat, saa den rigtige
  // stoerrelse naar at blive sat FOER noget overhovedet naar at blive tegnet paa skaermen.
  requestAnimationFrame(resize);
  registerInterval(setInterval(tick, 1000));
  return el;
}

async function fetchMiljoeffektData() {
  const res = await fetch(MILJOEFFEKT_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fetchDrNyheder() {
  const res = await fetch(RSS2JSON_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 'ok') throw new Error('rss2json fejl');
  return data.items.map(item => item.title);
}

function buildNyhedsbannerNode(el, registerInterval) {
  const node = document.createElement('div');
  node.className = 'nyhedsbanner';

  const logo = document.createElement('div');
  logo.className = 'nyhedsbanner-logo';
  logo.textContent = 'DR';
  node.appendChild(logo);

  const viewport = document.createElement('div');
  viewport.className = 'nyhedsbanner-viewport';
  const track = document.createElement('div');
  track.className = 'nyhedsbanner-track';
  track.style.fontSize = (el.fontSize || 1.4) + 'cqw';
  track.style.animationDuration = (el.scrollSekunder || 90) + 's';
  track.textContent = 'Henter nyheder fra DR ...';
  viewport.appendChild(track);
  node.appendChild(viewport);

  const load = () => {
    fetchDrNyheder().then(overskrifter => {
      // Overskrifterne saettes ind TO GANGE efter hinanden, saa CSS-animationen kan loope
      // saedeloest fra "midt i" den foerste kopi til "midt i" den anden -- ellers ville man
      // se et hak/spring hver gang den naar enden af listen.
      const tekst = overskrifter.map(t => escapeHtml(t)).join(' &nbsp;•&nbsp; ');
      track.innerHTML = tekst + ' &nbsp;•&nbsp; ' + tekst + ' &nbsp;•&nbsp; ';
    }).catch(() => {
      track.textContent = 'Kunne ikke hente nyheder fra DR lige nu.';
    });
  };
  load();
  registerInterval(setInterval(load, 5 * 60000));
  return node;
}

function miljoeffektCardHtml(data) {
  return (
    '<div class="miljoeffekt-box1">' +
      '<div class="miljoeffekt-h4">DU HJÆLPER VERDEN</div>' +
      '<div class="miljoeffekt-desc">Når du køber brugt, gør du en KÆMPE forskel for miljøet.<br>' +
      'Hos Børneloppen er vi stolte!<br>Sammen har vi sparet verden for:</div>' +
    '</div>' +
    '<div class="miljoeffekt-box2">' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedWaterConsumption) + ' liter vand</div>' +
      '<div class="miljoeffekt-label">Det er vand nok til</div>' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedToiletFlushes) + ' toiletskyl</div>' +
    '</div>' +
    '<div class="miljoeffekt-box3">' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedCo2Emissions) + ' kg CO<sub>2</sub></div>' +
      '<div class="miljoeffekt-label">Det er samme udledning som</div>' +
      '<div class="miljoeffekt-amount">' + formatDanskTal(data.savedKmInCar) + ' km i bil</div>' +
    '</div>'
  );
}

// Fletter laaste elementer fra den faelles "master"-skabelon (sabloner-raekken med
// standard=true) ind i en butiks egne elementer. Laaste master-elementer vinder altid over
// en butiks lokale kopi med samme id (fx fra dengang siden blev oprettet ud fra skabelonen),
// saa en aendring superadmin laver i masteren slaar igennem alle steder automatisk -- ingen
// butik skal selv goere noget for at faa opdateringen.
// sideName: navnet paa den side der reelt vises lige nu. Et laast element vises paa ALLE
// sider som udgangspunkt (fx et ur/logo) -- MEDMINDRE det har sit eget kunPaaSide sat, i saa
// fald vises det udelukkende naar sideName matcher praecis det navn.
function mergeMasterElements(storeElements, masterElements, sideName) {
  const lockedMaster = (masterElements || []).filter(e => e.locked && (!e.kunPaaSide || e.kunPaaSide === sideName));
  const lockedIds = new Set(lockedMaster.map(e => e.id));
  const ownOnly = (storeElements || []).filter(e => !lockedIds.has(e.id));
  return lockedMaster.concat(ownOnly);
}

function buildMediaNode(spec) {
  let media;
  if (spec.type === 'video' && spec.kind === 'youtube') {
    media = document.createElement('iframe');
    media.src = youtubeEmbedUrl(spec.url);
    media.setAttribute('frameborder', '0');
    media.setAttribute('allow', 'autoplay; encrypted-media');
  } else if (spec.type === 'billede') {
    media = document.createElement('img');
    media.src = spec.url;
    media.style.objectFit = 'contain';
  } else {
    media = document.createElement('video');
    media.src = spec.url;
    media.muted = true;
    media.autoplay = true;
    media.loop = true;
    media.playsInline = true;
    media.style.objectFit = 'cover';
  }
  media.className = 'el-media';
  return media;
}

// registerInterval: kaldes med et interval-id, saa den side der bruger denne funktion selv
// kan holde styr paa og rydde op i sine egne timere (rotator-skift, miljoeffekt-opdatering)
// naar den tegner om. Uden dette ville hver genrendering efterlade "spøgelses"-timere.
function buildElNode(el, registerInterval) {
  const node = document.createElement('div');
  node.className = 'el';
  node.dataset.type = el.type;
  node.style.left = el.x + '%';
  node.style.top = el.y + '%';
  node.style.width = el.w + '%';
  // En streg er altid en fast tynd skillelinje, uanset hvad der maatte staa gemt i
  // el.h (aeldre data fra foer redigerings-canvas'et laasede hoejden) -- ellers kan den
  // vise sig som en tyk kasse paa den rigtige skaerm selvom editoren ser rigtig ud.
  node.style.height = el.type === 'streg' ? '0.4%' : (el.h + '%');
  if (el.boxColor) node.style.background = el.boxColor;

  if (el.type === 'titel' || el.type === 'tekst') {
    const t = document.createElement('div');
    t.className = 'el-text';
    t.innerHTML = el.html != null ? stripInlineFontSize(el.html) : escapeHtml(el.text || '');
    if (el.fontSize) t.style.fontSize = el.fontSize + 'cqw';
    if (el.textColor) t.style.color = el.textColor;
    node.appendChild(t);
  } else if (el.type === 'billede' && el.url) {
    node.appendChild(buildMediaNode({ type: 'billede', url: el.url }));
  } else if (el.type === 'video' && el.url) {
    node.appendChild(buildMediaNode({ type: 'video', url: el.url, kind: el.kind }));
  } else if (el.type === 'rotator' && Array.isArray(el.slides) && el.slides.length) {
    let idx = 0;
    const showSlide = () => {
      node.innerHTML = '';
      const slide = el.slides[idx];
      if (slide.type === 'side') {
        const inner = document.createElement('div');
        inner.style.cssText = 'position:relative; width:100%; height:100%; overflow:hidden; container-type:inline-size;';
        if (slide.background) inner.style.background = slide.background;
        (slide.elements || []).forEach(subEl => inner.appendChild(buildElNode(subEl, registerInterval)));
        node.appendChild(inner);
      } else {
        node.appendChild(buildMediaNode(slide));
      }
      idx = (idx + 1) % el.slides.length;
    };
    showSlide();
    if (el.slides.length > 1) {
      registerInterval(setInterval(showSlide, el.intervalMs || 5000));
    }
  } else if (el.type === 'miljoeffekt') {
    const card = document.createElement('div');
    card.className = 'miljoeffekt-card';
    node.appendChild(card);
    const load = () => {
      fetchMiljoeffektData().then(data => { card.innerHTML = miljoeffektCardHtml(data); }).catch(() => {});
    };
    load();
    registerInterval(setInterval(load, 60000));
  } else if (el.type === 'ur') {
    node.appendChild(buildUrNode(registerInterval));
  } else if (el.type === 'nyhedsbanner') {
    node.appendChild(buildNyhedsbannerNode(el, registerInterval));
  }
  return node;
}
