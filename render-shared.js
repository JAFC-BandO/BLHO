// Delt render-logik for ét positioneret element -- den ENESTE kilde til hvordan
// titel/tekst/billede/video/rotator/miljoeffekt tegnes op. Bruges af skaerm.html (den rigtige
// Pi-visning) og af redigeringssidens "Live nu paa skaermen"-forhaandsvisning, saa de to
// aldrig kan gaa i utakt med hinanden -- ingen af dem "opfinder" sin egen udgave af renderingen.

const MILJOEFFEKT_URL = 'https://www.boerneloppen.dk/boerneloppen-theme/world_goals/calculateConsumptionVariables.json';

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

async function fetchMiljoeffektData() {
  const res = await fetch(MILJOEFFEKT_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
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
    '</div>' +
    '<div class="miljoeffekt-linkbox"><span class="miljoeffekt-btn">Læs mere om vores Verdensmål</span></div>'
  );
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
  node.style.height = el.h + '%';
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
  }
  return node;
}
