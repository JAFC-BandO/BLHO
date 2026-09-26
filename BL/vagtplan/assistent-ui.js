// Assistent-panelet: lederen skriver, hvad der skal ske, AI'en (supabase/functions/vagtplan-ai)
// oversaetter det til handlinger, og assistent.js udfoerer dem paa en KOPI af planen. Resultatet
// vises som et forslag (hvad der aendres, dag for dag, og om planen stadig gaar op), og foerst
// naar lederen trykker "Anvend", aendres planen -- som en almindelig aendring, der kan fortrydes
// og skal gemmes med "Gem vagtplan".
// Indlaeses EFTER vagtplanens eget script og bruger dets variabler (M, raekke, snap, anvendSnap,
// aendret, fortryd, render, W, client, $, esc, butikNavn, aktuelButik, dagDato, ugeNr, historik, hpos).
(function () {
  const A = window.VagtplanAssistent;
  const panel = $('#aiPanel'), strom = $('#aiStrom'), tekst = $('#aiTekst'), sendKnap = $('#aiSend');
  let samtale = [];        // [{ rolle: 'bruger'|'assistent', tekst }] -- det AI'en faar med
  let samtalePlan = null;  // samtalen hoerer til én vagtplan (raekke.id)
  let arbejder = false;
  const IKON = {
    gnist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5l1.9 5.2c.3.8.9 1.4 1.7 1.7l5.2 1.9-5.2 1.9c-.8.3-1.4.9-1.7 1.7L12 20.1l-1.9-5.2c-.3-.8-.9-1.4-1.7-1.7L3.2 11.3l5.2-1.9c.8-.3 1.4-.9 1.7-1.7L12 2.5z"/><path fill="currentColor" opacity=".75" d="M19 15.5l.8 2c.1.3.4.6.7.7l2 .8-2 .8c-.3.1-.6.4-.7.7l-.8 2-.8-2c-.1-.3-.4-.6-.7-.7l-2-.8 2-.8c.3-.1.6-.4.7-.7l.8-2z"/></svg>',
    fri: '<svg class="ai-ik" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    tid: '<svg class="ai-ik" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    laas: '<svg class="laas" viewBox="0 0 24 24" aria-label="låst"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  };

  // ---------- Aabn / luk ----------
  function aabn() {
    if (!raekke) return;
    if (samtalePlan != raekke.id) nySamtale();
    panel.hidden = false;
    requestAnimationFrame(() => { document.body.classList.add('ai-aaben'); });
    $('#assistentKnap').setAttribute('aria-expanded', 'true');
    setTimeout(() => tekst.focus(), 50);
  }
  function luk() {
    document.body.classList.remove('ai-aaben');
    $('#assistentKnap').setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!document.body.classList.contains('ai-aaben')) panel.hidden = true; }, 220);
  }
  $('#assistentKnap').onclick = () => (document.body.classList.contains('ai-aaben') ? luk() : aabn());
  $('#aiLuk').onclick = luk;
  $('#aiNy').onclick = () => { if (!arbejder) { nySamtale(); tekst.focus(); } };
  document.addEventListener('keydown', e => { if (e.key == 'Escape' && document.body.classList.contains('ai-aaben') && !document.querySelector('dialog[open]')) luk(); });

  // ---------- Velkomst med forslag ----------
  // Eksemplerne bruger planens egne navne og datoer, saa man kan se, hvordan man skriver.
  function nySamtale() {
    samtale = []; samtalePlan = raekke ? raekke.id : null;
    const navne = raekke ? raekke.opsaetning.personer.filter(p => !p.kunFaste).map(p => p.navn) : [];
    const a = navne[navne.length - 1] || 'Anna', b = navne[Math.max(0, navne.length - 3)] || a;
    const forslag = [
      `${a} er syg i morgen`,
      `${b} skal have fri fredag i næste uge`,
      `${a} skal arbejde tirsdag og torsdag de næste 2 uger`,
      `Giv ${b} 2 fridage i næste uge`,
      'Hvem arbejder på lørdag?',
      `Hvor mange timer har ${a} i næste uge?`,
    ];
    tekst.placeholder = `Fx: ${a} skal have fri fredag`;
    strom.innerHTML = `<div class="ai-velkomst">
      <div class="ai-velkomst-ikon">${IKON.gnist}</div>
      <h3>Hvad skal der ske med vagtplanen?</h3>
      <p>Skriv det, som du ville sige det til en kollega. Jeg finder afløsere, tjekker reglerne og viser dig ændringerne – der ændres ikke noget, før du trykker "Anvend".</p>
      <div class="ai-forslag">${forslag.map(f => `<button type="button" class="ai-chip" data-forslag="${esc(f)}">${esc(f)}</button>`).join('')}</div>
    </div>`;
  }
  strom.addEventListener('click', e => {
    const f = e.target.closest('[data-forslag]');
    if (f) { tekst.value = f.dataset.forslag; tilpas(); tekst.focus(); tekst.setSelectionRange(tekst.value.length, tekst.value.length); }
  });

  // ---------- Input ----------
  function tilpas() {
    tekst.style.height = 'auto';
    tekst.style.height = Math.min(tekst.scrollHeight, 160) + 'px';
    tekst.style.overflowY = tekst.scrollHeight > 160 ? 'auto' : 'hidden';
    sendKnap.disabled = arbejder || !tekst.value.trim();
  }
  tekst.addEventListener('input', tilpas);
  tekst.addEventListener('keydown', e => { if (e.key == 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $('#aiForm').addEventListener('submit', e => { e.preventDefault(); send(); });

  const rul = () => { strom.scrollTop = strom.scrollHeight; };
  function tilfoej(html, klasse) {
    const v = strom.querySelector('.ai-velkomst'); if (v) v.remove();
    const el = document.createElement('div');
    el.className = klasse; el.innerHTML = html;
    strom.appendChild(el); rul();
    return el;
  }
  const boble = (t, hvem) => tilfoej(`${hvem == 'ai' ? `<span class="ai-avatar">${IKON.gnist}</span>` : ''}<div class="ai-boble">${esc(t).replace(/\n/g, '<br>')}</div>`, 'ai-besked ' + hvem);

  // ---------- Send ----------
  async function send() {
    const t = tekst.value.trim();
    if (!t || arbejder || !raekke) return;
    if (samtalePlan != raekke.id) nySamtale();
    arbejder = true; tekst.value = ''; tilpas();
    boble(t, 'bruger');
    samtale.push({ rolle: 'bruger', tekst: t });
    const tænk = tilfoej(`<span class="ai-avatar">${IKON.gnist}</span><div class="ai-boble ai-taenker"><span class="prik"></span><span class="prik"></span><span class="prik"></span><span class="ai-taenker-tekst">Tænker…</span></div>`, 'ai-besked ai');
    const idag = new Date();
    const base = JSON.parse(snap());
    let svar;
    try {
      const kontekst = A.kontekst(base, idag, { planNavn: raekke.navn, butik: butikNavn(raekke) || (aktuelButik && aktuelButik.navn) });
      svar = await spoerg({ beskeder: samtale, kontekst });
    } catch (e) {
      svar = { fejl: 'Kunne ikke nå AI-assistenten. Tjek forbindelsen og prøv igen.' };
    }
    if (svar.fejl) {
      tænk.remove();
      tilfoej(`<span class="ai-avatar fejl">!</span><div class="ai-boble">${esc(svar.fejl)}</div>`, 'ai-besked ai fejl');
      samtale.pop(); // beskeden kom aldrig frem -- saa kan den sendes igen
      tekst.value = t; tilpas();
      arbejder = false; tilpas();
      return;
    }
    const handlinger = Array.isArray(svar.handlinger) ? svar.handlinger : [];
    let kort = null;
    if (handlinger.length) {
      tænk.querySelector('.ai-taenker-tekst').textContent = 'Retter planen…';
      await new Promise(r => setTimeout(r, 30)); // lad browseren tegne teksten foer beregningen
      kort = beregn(base, handlinger, idag);
    }
    tænk.remove();
    if (svar.svar) boble(svar.svar, 'ai');
    let resume = svar.svar || '';
    if (kort) {
      const el = tilfoej('', 'ai-kort-hylde');
      tegnKort(el, kort);
      resume += (resume ? '\n' : '') + '[Udført: ' + kort.res.log.map(l => l.tekst).join(' ') + ']';
    }
    samtale.push({ rolle: 'assistent', tekst: resume });
    arbejder = false; tilpas();
  }

  async function spoerg(body) {
    const { data, error } = await client.functions.invoke('vagtplan-ai', { body });
    if (!error) return data || { fejl: 'Tomt svar fra AI-assistenten.' };
    let fejl = null;
    try { const j = await error.context.json(); fejl = j && j.fejl; } catch (e) {}
    return { fejl: fejl || 'AI-assistenten svarer ikke lige nu. Prøv igen om lidt.' };
  }

  // Udfoer handlingerne paa en kopi af planen og find forskellen
  function beregn(base, handlinger, idag) {
    const res = A.udfoer(base, handlinger, { idag });
    const f = A.forskel(base, res.ny);
    const foer = A.problemer(base).map(i => i.w + '|' + i.d + '|' + i.t);
    const efter = A.problemer(res.ny);
    const oFoer = A.oensker(base).map(i => i.w + '|' + i.t);
    return { base, handlinger, idag, res, f, efter, nye: efter.filter(i => !foer.includes(i.w + '|' + i.d + '|' + i.t)),
      nyeOensker: A.oensker(res.ny).filter(i => !oFoer.includes(i.w + '|' + i.t)), status: 'afventer' };
  }

  // ---------- Forslags-kortet ----------
  const kl = A.kl;
  const ugeTekst = w => 'uge ' + ugeNr(w);
  function tegnKort(el, k) {
    const { f, res, efter, nye } = k;
    const antal = f.vagter.length + f.aftaler.length + f.medarbejdere.length;
    const dage = {};
    f.vagter.forEach(v => { (dage[v.dato] = dage[v.dato] || { w: v.w, d: v.d, v: [] }).v.push(v); });
    const tid = v => `${kl(v.s)}–${kl(v.e)}`;
    const linje = v => {
      const laas = v.laast ? ' ' + IKON.laas : '';
      if (v.type == 'ny') return `<div class="ai-ae ny"><span class="ai-tegn">+</span><b>${esc(v.navn)}</b> ${tid(v)}${laas}</div>`;
      if (v.type == 'fjernet') return `<div class="ai-ae fjernet"><span class="ai-tegn">−</span><b>${esc(v.navn)}</b> <s>${tid(v)}</s></div>`;
      if (v.type == 'person') return `<div class="ai-ae person"><span class="ai-tegn">⇄</span><b>${esc(v.navn)}</b> → <b>${esc(v.qNavn)}</b> ${tid(v)}${laas}</div>`;
      if (v.type == 'tid') return `<div class="ai-ae tid"><span class="ai-tegn">◷</span><b>${esc(v.navn)}</b> <s>${kl(v.fra[0])}–${kl(v.fra[1])}</s> → ${tid(v)}${laas}</div>`;
      return `<div class="ai-ae laast"><span class="ai-tegn">${IKON.laas}</span><b>${esc(v.navn)}</b> ${tid(v)} låst</div>`;
    };
    const dagHtml = Object.keys(dage).sort().map(dato => {
      const g = dage[dato];
      return `<button type="button" class="ai-dag" data-gaa-uge="${g.w}" title="Vis ${ugeTekst(g.w)} i planen"><span class="ai-dato">${esc(A.datoTekst(dato))}<small>${ugeTekst(g.w)}</small></span><span class="ai-ae-liste">${g.v.map(linje).join('')}</span></button>`;
    }).join('');
    const aftaler = f.aftaler.map(a => `<div class="ai-aftale ${a.type}"><span class="ai-tegn ${a.type == 'fjernet' ? 'fjernet' : a.tid ? 'tid' : 'fri'}">${a.type == 'fjernet' ? '↺' : a.tid ? IKON.tid : IKON.fri}</span><span><b>${esc(a.navn)}</b> ${a.type == 'fjernet' ? 'aftale fjernet' : a.tid ? 'kan kun ' + kl(a.tid[0]) + '–' + kl(a.tid[1]) : 'har fri'} ${esc(A.datoTekst(a.dato))}</span></div>`).join('');
    const medarb = f.medarbejdere.map(m => `<div class="ai-medarb"><b>${esc(m.navn)}</b> fremover: ${esc(m.efter)}.</div>`).join('');
    const fejl = res.log.filter(l => l.fejl).map(l => `<li>${esc(l.tekst)}</li>`).join('');
    const ok = res.log.filter(l => !l.fejl).map(l => `<li>${esc(l.tekst)}</li>`).join('');
    const status = !antal ? '' : efter.length
      ? `<span class="ai-status bad">⚠ ${efter.length} ${efter.length == 1 ? 'problem' : 'problemer'} i planen</span>`
      : '<span class="ai-status ok">✓ Planen går op</span>';
    const problemer = nye.length ? `<div class="ai-problemer"><b>Nye problemer:</b><ul>${nye.slice(0, 5).map(i => `<li>${i.w >= 0 ? esc(ugeTekst(i.w)) + (i.d >= 0 ? ' ' + esc(M.D[i.d].toLowerCase()) : '') + ': ' : ''}${esc(i.t)}</li>`).join('')}${nye.length > 5 ? `<li>… og ${nye.length - 5} mere</li>` : ''}</ul></div>` : '';
    const nyeO = k.nyeOensker || [];
    const oensker = nyeO.length ? `<div class="ai-oensker"><b>Ønsker der ikke opfyldes:</b><ul>${nyeO.slice(0, 4).map(i => `<li>${i.w >= 0 ? esc(ugeTekst(i.w)) + ': ' : ''}${esc(i.t)}</li>`).join('')}${nyeO.length > 4 ? `<li>… og ${nyeO.length - 4} mere</li>` : ''}</ul></div>` : '';
    const knapper = !antal ? '' : k.status == 'afventer'
      ? '<div class="ai-knapper"><button type="button" class="pri" data-ai="anvend">Anvend ændringer</button><button type="button" data-ai="kasser">Kassér</button></div>'
      : k.status == 'anvendt'
        ? `<div class="ai-knapper udfoert"><span class="ai-udfoert">✓ Anvendt – husk "Gem vagtplan"</span>${k.kanFortryde ? '<button type="button" data-ai="fortryd">Fortryd</button>' : ''}</div>`
        : `<div class="ai-knapper udfoert"><span class="ai-udfoert kasseret">${k.status == 'fortrudt' ? 'Fortrudt – planen er som før' : 'Kasseret'}</span></div>`;
    el.innerHTML = `<div class="ai-kort ${k.status == 'fortrudt' ? 'kasseret' : k.status}">
      ${antal ? `<div class="ai-kort-hoved"><span class="ai-kort-titel">${k.status == 'afventer' ? 'Forslag' : 'Ændringer'} · ${antal} ${antal == 1 ? 'ændring' : 'ændringer'}</span>${status}</div>` : ''}
      ${ok ? `<ul class="ai-log">${ok}</ul>` : ''}
      ${fejl ? `<ul class="ai-log fejl">${fejl}</ul>` : ''}
      ${aftaler ? `<div class="ai-afsnit">${aftaler}</div>` : ''}
      ${medarb ? `<div class="ai-afsnit">${medarb}</div>` : ''}
      ${dagHtml ? `<div class="ai-dage">${dagHtml}</div>` : ''}
      ${!antal && !fejl ? '<p class="ai-intet">Planen var allerede sådan – der er ikke noget at ændre.</p>' : ''}
      ${problemer}
      ${oensker}
      ${knapper}
    </div>`;
    el._kort = k;
    rul();
  }

  strom.addEventListener('click', e => {
    const gaa = e.target.closest('[data-gaa-uge]');
    if (gaa) { W = +gaa.dataset.gaaUge; render(); return; }
    const b = e.target.closest('[data-ai]'); if (!b) return;
    const el = b.closest('.ai-kort-hylde'), k = el && el._kort; if (!k) return;
    const hvad = b.dataset.ai;
    if (hvad == 'kasser') {
      k.status = 'kasseret'; tegnKort(el, k);
      samtale.push({ rolle: 'bruger', tekst: '[Lederen kasserede forslaget]' });
      samtale.push({ rolle: 'assistent', tekst: 'Forstået – planen er ikke ændret.' });
    } else if (hvad == 'anvend') anvend(el, k);
    else if (hvad == 'fortryd') {
      // Kun hvis planen stadig er, som assistenten efterlod den -- ellers ville fortryd ramme noget andet
      const kan = k.kanFortryde && hpos == k.hpos;
      if (kan) { fortryd(); k.status = 'fortrudt'; samtale.push({ rolle: 'bruger', tekst: '[Lederen fortrød ændringerne]' }, { rolle: 'assistent', tekst: 'Ændringerne er fortrudt.' }); }
      k.kanFortryde = false; tegnKort(el, k);
      if (!kan) el.querySelector('.ai-knapper').insertAdjacentHTML('beforeend', '<span class="ai-udfoert kasseret">Planen er ændret siden – brug "Fortryd" ved "Gem vagtplan".</span>');
    }
  });

  function anvend(el, k) {
    // Er planen aendret siden forslaget (fx rettet i haanden), laves forslaget om paa den nye plan
    const nu = JSON.parse(snap());
    if (JSON.stringify(nu) !== JSON.stringify(k.base)) {
      const ny = beregn(nu, k.handlinger, new Date());
      Object.assign(k, ny);
      tegnKort(el, k);
      el.querySelector('.ai-kort').insertAdjacentHTML('afterbegin', '<p class="ai-note">Planen er ændret, siden forslaget blev lavet, så det er lavet om. Tjek det og tryk "Anvend" igen.</p>');
      return;
    }
    anvendSnap(JSON.stringify(k.res.ny));
    aendret();
    k.status = 'anvendt'; k.hpos = hpos; k.kanFortryde = true;
    tegnKort(el, k);
    samtale.push({ rolle: 'bruger', tekst: '[Lederen anvendte ændringerne]' });
    samtale.push({ rolle: 'assistent', tekst: 'Ændringerne er anvendt.' });
    // Vis den foerste uge med aendringer, og fremhaev de nye/aendrede vagter et oejeblik
    const uger = k.f.vagter.map(v => v.w).concat(k.res.uger);
    if (uger.length && !uger.includes(W)) W = Math.min(...uger);
    window.aiFremhaev = new Set(k.f.vagter.filter(v => v.type != 'fjernet').map(v => [v.w, v.d, v.q || v.p, v.s, v.e].join('|')));
    render();
    setTimeout(() => { window.aiFremhaev = null; document.querySelectorAll('.chip.ai-ny').forEach(c => c.classList.remove('ai-ny')); }, 6000);
  }

  window.aabnAssistent = aabn;
  tilpas();
})();
