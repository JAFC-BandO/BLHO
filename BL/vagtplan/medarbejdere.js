// Medarbejder-dialogen: tilfoej, ret og fjern medarbejdere og deres timer/regler.
// Indlaeses EFTER vagtplanens eget script og bruger dets variabler (M, raekke, aendret, render,
// $, esc, genopbygMotor). Selve oversaettelsen til planlaeggerens opsaetning ligger i
// opsaetning.js (VagtplanOpsaetning).
(function () {
  const O = window.VagtplanOpsaetning;
  const DAGE = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  // Jobtyperne kommer fra opsaetningen (fx Daglig leder, Salgsassistent, Flexjob, Ungarbejder)
  const job = t => (raekke.opsaetning.jobtyper || {})[t] || t;
  const kl = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const tid = v => { const [a, b] = String(v || '').split(':').map(Number); return isNaN(a) ? NaN : a * 60 + (b || 0); };
  const luk = d => d > 4 ? O.LUK_WEEKEND : O.LUK_HVERDAG;
  let model = [], aaben = null; // aaben: den medarbejder formularen redigerer (kopi) -- null = listen

  // ---------- Liste ----------
  function visListe() {
    aaben = null;
    model = O.tilModel(raekke.opsaetning);
    $('#mdEkstraLoen').value = raekke.opsaetning.ekstraTimeloen != null ? raekke.opsaetning.ekstraTimeloen : '';
    $('#mdTitel').textContent = 'Medarbejdere';
    $('#mdListeVis').hidden = false; $('#mdFormVis').hidden = true;
    $('#mdListe').innerHTML = model.length ? model.map(m => `<li>
      <div class="md-navn"><b>${esc(m.navn)}</b> <span class="md-job">${esc(job(m.type))}</span>${m.email ? `<span class="md-email">${esc(m.email)}</span>` : ''}${m.timeloen != null ? `<span class="md-email">${esc(String(m.timeloen).replace('.', ','))} kr./t</span>` : ''}</div>
      <div class="md-resume">${esc(O.beskriv(m))}</div>
      <div class="md-knapper"><button type="button" data-md-ret="${esc(m.id)}">Ret</button><button type="button" class="md-fjern" data-md-fjern="${esc(m.id)}">Fjern</button></div>
    </li>`).join('') : '<li class="s">Ingen medarbejdere endnu.</li>';
  }
  window.aabnMedarbejdere = function (id) {
    visListe();
    if (id) visForm(id);
    if (!$('#md').open) $('#md').showModal();
  };

  // ---------- Formular ----------
  function visForm(id) {
    const m = id ? model.find(x => x.id == id) : null;
    aaben = m ? JSON.parse(JSON.stringify(m)) : {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), navn: '', email: '', type: 'S',
      dage: [0, 1, 2, 3, 4].map(() => [O.AABEN, O.LUK_HVERDAG]).concat([null, null]), timer: { art: 'ingen' },
      kunFaste: false, fordeles: true, vagter: [], ny: true,
    };
    $('#mdTitel').textContent = m ? 'Ret ' + m.navn : 'Ny medarbejder';
    $('#mdListeVis').hidden = true; $('#mdFormVis').hidden = false;
    const a = aaben;
    $('#mdNavn').value = a.navn;
    $('#mdEmail').value = a.email || '';
    $('#mdTimeloen').value = a.timeloen != null ? a.timeloen : '';
    // Fast raekkefoelge (databasen gemmer jobtyperne alfabetisk efter noegle)
    const orden = k => { const i = ['L', 'S', 'F', 'U'].indexOf(k); return i < 0 ? 99 : i; };
    $('#mdType').innerHTML = Object.keys(raekke.opsaetning.jobtyper || {}).sort((x, y) => orden(x) - orden(y)).map(k => `<option value="${esc(k)}">${esc(job(k))}</option>`).join('');
    $('#mdType').value = a.type;
    tegnDage(a.dage);
    $('#mdTimerArt').value = a.timer.art;
    $('#mdTimerT').value = a.timer.t != null ? a.timer.t : '';
    $('#mdFridag').checked = !!a.timer.fridag;
    $('#mdKunFaste').checked = a.kunFaste;
    $('#mdFordeles').checked = a.fordeles;
    $('#mdFejl').textContent = '';
    // Weekend-holdenes rigtige uger i den aabne plan
    $('#mdHoldHjaelp').textContent = 'Weekend-vagter ligger i et hold, fordi alle højst arbejder hver 3. weekend. I denne plan: ' + [0, 1, 2].map(h => 'hold ' + (h + 1) + ' = ' + holdUger(h)).join('; ') + '.';
    tegnVagter(); opdaterFelter();
    $('#mdNavn').focus();
  }
  // Én linje pr. dag: kryds + fra/til. En dag uden kryds har tiderne skjult (men husket, saa
  // et nyt kryds giver de samme tider tilbage).
  function tegnDage(dage) {
    $('#mdDage').innerHTML = DAGE.map((n, d) => {
      const v = dage[d] || [O.AABEN, luk(d)];
      return `<div class="md-dag ${dage[d] ? '' : 'fri'}" data-dag="${d}">
        <label><input type="checkbox" data-dag-ja="${d}" ${dage[d] ? 'checked' : ''}> ${n}</label>
        <span class="md-tider">fra <input type="time" step="900" data-dag-fra="${d}" value="${kl(v[0])}" aria-label="${n} fra"> til <input type="time" step="900" data-dag-til="${d}" value="${kl(v[1])}" aria-label="${n} til"></span>
      </div>`;
    }).join('');
  }
  const dagJa = d => document.querySelector(`[data-dag-ja="${d}"]`);
  const saetDag = (d, ja) => { dagJa(d).checked = ja; document.querySelector(`.md-dag[data-dag="${d}"]`).classList.toggle('fri', !ja); };
  $('#mdDage').addEventListener('change', e => {
    const d = e.target.dataset.dagJa; if (d !== undefined) saetDag(+d, e.target.checked);
  });
  document.querySelector('.md-hurtig').addEventListener('click', e => {
    const b = e.target.closest('[data-vaelg]'); if (!b) return;
    const v = b.dataset.vaelg;
    if (v == 'samme') {
      const foerste = [0, 1, 2, 3, 4, 5, 6].find(d => dagJa(d).checked);
      if (foerste == null) return;
      const fra = document.querySelector(`[data-dag-fra="${foerste}"]`).value, til = tid(document.querySelector(`[data-dag-til="${foerste}"]`).value);
      [0, 1, 2, 3, 4, 5, 6].filter(d => dagJa(d).checked).forEach(d => {
        document.querySelector(`[data-dag-fra="${d}"]`).value = fra;
        document.querySelector(`[data-dag-til="${d}"]`).value = kl(Math.min(til, luk(d))); // weekend lukker 17:15
      });
      return;
    }
    const valgt = { hverdage: [0, 1, 2, 3, 4], weekend: [5, 6], alle: [0, 1, 2, 3, 4, 5, 6], ingen: [] }[v];
    [0, 1, 2, 3, 4, 5, 6].forEach(d => saetDag(d, v == 'hverdage' || v == 'weekend' ? (valgt.includes(d) || dagJa(d).checked) : valgt.includes(d)));
  });
  // Viser/skjuler de felter der kun giver mening i en bestemt situation
  function opdaterFelter() {
    const art = $('#mdTimerArt').value;
    $('#mdTimerTal').hidden = art == 'ingen';
    $('#mdFridagFelt').hidden = art != 'praecis';
    $('#mdFordeles').disabled = $('#mdKunFaste').checked;
    $('#mdFordelesFelt').classList.toggle('slukket', $('#mdKunFaste').checked);
  }
  function tegnVagter() {
    const v = aaben.vagter;
    $('#mdVagter').innerHTML = v.length ? v.map((x, i) => `<div class="md-vagt">
      <select data-v="${i}" data-f="d" aria-label="Dag">${DAGE.map((n, d) => `<option value="${d}" ${d == x.d ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <input type="time" step="900" data-v="${i}" data-f="s" value="${kl(x.s)}" aria-label="Fra"><span>–</span>
      <input type="time" step="900" data-v="${i}" data-f="e" value="${kl(x.e)}" aria-label="Til">
      <select data-v="${i}" data-f="hold" aria-label="Hvornår">${x.d > 4
        ? [0, 1, 2].map(h => `<option value="${h}" ${x.hold === h ? 'selected' : ''}>Weekend-hold ${h + 1} (${esc(holdUger(h))})</option>`).join('')
        : '<option value="">Hver uge</option>'}</select>
      <button type="button" class="md-slet-vagt" data-slet-vagt="${i}" title="Fjern den faste vagt" aria-label="Fjern den faste vagt">✕</button>
    </div>`).join('') : '<p class="s md-ingen">Ingen faste vagter.</p>';
  }
  $('#mdVagter').addEventListener('change', e => {
    const el = e.target, i = +el.dataset.v, f = el.dataset.f; if (isNaN(i)) return;
    const x = aaben.vagter[i];
    if (f == 'd') { x.d = +el.value; x.hold = x.d > 4 ? (x.hold == null ? 0 : x.hold) : null; tegnVagter(); }
    else if (f == 'hold') x.hold = el.value === '' ? null : +el.value;
    else x[f] = tid(el.value);
  });
  $('#mdVagter').addEventListener('click', e => {
    const b = e.target.closest('[data-slet-vagt]'); if (!b) return;
    aaben.vagter.splice(+b.dataset.sletVagt, 1); tegnVagter();
  });
  $('#mdNyVagt').onclick = () => { aaben.vagter.push({ d: 0, s: 600, e: 780, hold: null }); tegnVagter(); };
  ['#mdTimerArt', '#mdKunFaste'].forEach(s => $(s).addEventListener('change', opdaterFelter));

  // ---------- Gem ----------
  function laesForm() {
    const a = aaben, fejl = [];
    a.navn = $('#mdNavn').value.trim();
    a.email = $('#mdEmail').value.trim();
    const tl = String($('#mdTimeloen').value).trim().replace(',', '.');
    a.timeloen = tl === '' ? null : Number(tl);
    if (a.timeloen != null && !(a.timeloen > 0 && a.timeloen < 2000)) fejl.push('Timelønnen skal være et tal mellem 0 og 2000 kr. – eller lad feltet være tomt.');
    if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) fejl.push('E-mailen ser ikke rigtig ud – tjek den, eller lad feltet være tomt.');
    else if (a.email && model.some(m => m.id != a.id && (m.email || '').toLowerCase() == a.email.toLowerCase())) fejl.push('En anden medarbejder har allerede den e-mail.');
    a.type = $('#mdType').value;
    if (!a.navn) fejl.push('Skriv et navn.');
    else if (model.some(m => m.id != a.id && m.navn.toLowerCase() == a.navn.toLowerCase())) fejl.push('Der findes allerede en medarbejder med det navn.');
    a.dage = DAGE.map((n, d) => {
      if (!dagJa(d).checked) return null;
      const s = tid(document.querySelector(`[data-dag-fra="${d}"]`).value), e = tid(document.querySelector(`[data-dag-til="${d}"]`).value);
      if (isNaN(s) || isNaN(e) || s >= e) { fejl.push(`${n}: "fra" skal være før "til".`); return null; }
      if (s < O.AABEN || e > luk(d)) fejl.push(`${n}: butikken har åbent ${kl(O.AABEN)}–${kl(luk(d))}.`);
      if (e - s < 180) fejl.push(`${n}: der skal være mindst 3 timer (en vagt er mindst 3 timer).`);
      return [s, e];
    });
    const art = $('#mdTimerArt').value, t = parseFloat(String($('#mdTimerT').value).replace(',', '.'));
    if (art != 'ingen' && !(t > 0 && t <= 60)) fejl.push('Skriv antal timer (mellem 0 og 60).');
    a.timer = art == 'ingen' ? { art } : art == 'praecis' ? { art, t, fridag: $('#mdFridag').checked } : { art, t };
    a.kunFaste = $('#mdKunFaste').checked;
    a.fordeles = !a.kunFaste && $('#mdFordeles').checked;
    a.vagter.forEach(x => {
      const n = DAGE[x.d].toLowerCase();
      if (isNaN(x.s) || isNaN(x.e) || x.s >= x.e) fejl.push(`Fast vagt ${n}: "fra" skal være før "til".`);
      else {
        if (x.s < O.AABEN || x.e > luk(x.d)) fejl.push(`Fast vagt ${n}: butikken har åbent ${kl(O.AABEN)}–${kl(luk(x.d))}.`);
        if (x.e - x.s < 180) fejl.push(`Fast vagt ${n}: en vagt skal være mindst 3 timer.`);
      }
    });
    if (a.kunFaste && !a.vagter.length) fejl.push('"Kun de faste vagter" kræver mindst én fast vagt.');
    return fejl;
  }
  $('#mdGem').onclick = () => {
    const fejl = laesForm();
    if (fejl.length) { $('#mdFejl').innerHTML = fejl.map(esc).join('<br>'); return; }
    const a = aaben; delete a.ny;
    const i = model.findIndex(m => m.id == a.id);
    if (i >= 0) model[i] = a; else model.push(a);
    anvend();
    visListe();
  };
  $('#mdAnnuller').onclick = visListe;

  // ---------- Fjern (klik to gange -- ingen browser-popup) ----------
  let fjernArmeret = null, fjernTimer = null;
  $('#mdListe').addEventListener('click', e => {
    const ret = e.target.closest('[data-md-ret]');
    if (ret) { visForm(ret.dataset.mdRet); return; }
    const b = e.target.closest('[data-md-fjern]'); if (!b) return;
    const id = b.dataset.mdFjern;
    if (fjernArmeret != id) {
      fjernArmeret = id; b.textContent = 'Sikker? Klik igen';
      clearTimeout(fjernTimer); fjernTimer = setTimeout(() => { fjernArmeret = null; b.textContent = 'Fjern'; }, 4000);
      return;
    }
    fjernArmeret = null; clearTimeout(fjernTimer);
    model = model.filter(m => m.id != id);
    anvend();
    visListe();
  });
  $('#mdNy').onclick = () => visForm(null);
  $('#mdEkstraLoen').addEventListener('change', e => {
    const v = String(e.target.value).trim().replace(',', '.'), n = v === '' ? null : Number(v);
    if (n != null && !(n > 0 && n < 2000)) { e.target.value = raekke.opsaetning.ekstraTimeloen != null ? raekke.opsaetning.ekstraTimeloen : ''; return; }
    const C = Object.assign({}, raekke.opsaetning);
    if (n == null) delete C.ekstraTimeloen; else C.ekstraTimeloen = n;
    genopbygMotor(C); render(); aendret();
  });

  // Gemmer den nye opsaetning, fjerner vagter for folk der ikke findes mere, og tegner planen
  // igen med de nye regler. Den eksisterende plan roeres ellers ikke -- "Foreslå ny plan"
  // laver en ny, der bruger aendringerne.
  function anvend() {
    const C = O.fraModel(model, raekke.opsaetning);
    genopbygMotor(C);
    $('#ekstraHint').hidden = false;
    render();
    aendret();
  }
})();
