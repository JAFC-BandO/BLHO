// Medarbejder-dialogen: tilfoej, ret og fjern medarbejdere og deres timer/regler.
// Indlaeses EFTER vagtplanens eget script og bruger dets variabler (M, raekke, save, render,
// $, esc, genopbygMotor). Selve oversaettelsen til planlaeggerens opsaetning ligger i
// opsaetning.js (VagtplanOpsaetning).
(function () {
  const O = window.VagtplanOpsaetning;
  const DAGE = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  const JOB = { L: 'Daglig leder', S: 'Salgsassistent', U: 'Ungarbejder' };
  const kl = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const tid = v => { const [a, b] = String(v || '').split(':').map(Number); return isNaN(a) ? NaN : a * 60 + (b || 0); };
  const luk = d => d > 4 ? O.LUK_WEEKEND : O.LUK_HVERDAG;
  let model = [], aaben = null; // aaben: den medarbejder formularen redigerer (kopi) -- null = listen

  // ---------- Liste ----------
  function visListe() {
    aaben = null;
    model = O.tilModel(raekke.opsaetning);
    $('#mdTitel').textContent = 'Medarbejdere';
    $('#mdListeVis').hidden = false; $('#mdFormVis').hidden = true;
    $('#mdListe').innerHTML = model.length ? model.map(m => `<li>
      <div class="md-navn"><b>${esc(m.navn)}</b> <span class="md-job">${esc(JOB[m.type])}</span></div>
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
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), navn: '', type: 'S',
      hverdag: [O.AABEN, O.LUK_HVERDAG], weekend: null, ikkeDage: [], timer: { art: 'ingen' },
      kunFaste: false, fordeles: true, vagter: [], ny: true,
    };
    $('#mdTitel').textContent = m ? 'Ret ' + m.navn : 'Ny medarbejder';
    $('#mdListeVis').hidden = true; $('#mdFormVis').hidden = false;
    const a = aaben;
    $('#mdNavn').value = a.navn;
    $('#mdType').value = a.type;
    $('#mdHverdagJa').checked = !!a.hverdag;
    $('#mdHverdagFra').value = kl((a.hverdag || [O.AABEN])[0]); $('#mdHverdagTil').value = kl((a.hverdag || [0, O.LUK_HVERDAG])[1]);
    document.querySelectorAll('#mdIkkeDage input').forEach(c => { c.checked = a.ikkeDage.includes(+c.value); });
    $('#mdWeekendJa').checked = !!a.weekend;
    $('#mdWeekendFra').value = kl((a.weekend || [O.AABEN])[0]); $('#mdWeekendTil').value = kl((a.weekend || [0, O.LUK_WEEKEND])[1]);
    $('#mdTimerArt').value = a.timer.art;
    $('#mdTimerT').value = a.timer.t != null ? a.timer.t : '';
    $('#mdFridag').checked = !!a.timer.fridag;
    $('#mdKunFaste').checked = a.kunFaste;
    $('#mdFordeles').checked = a.fordeles;
    $('#mdFejl').textContent = '';
    tegnVagter(); opdaterFelter();
    $('#mdNavn').focus();
  }
  // Viser/skjuler de felter der kun giver mening i en bestemt situation
  function opdaterFelter() {
    $('#mdHverdagTider').hidden = !$('#mdHverdagJa').checked;
    $('#mdWeekendTider').hidden = !$('#mdWeekendJa').checked;
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
        ? [0, 1, 2].map(h => `<option value="${h}" ${x.hold === h ? 'selected' : ''}>Weekend-hold ${h + 1} (uge ${h + 1} og ${h + 4})</option>`).join('')
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
  ['#mdHverdagJa', '#mdWeekendJa', '#mdTimerArt', '#mdKunFaste'].forEach(s => $(s).addEventListener('change', opdaterFelter));

  // ---------- Gem ----------
  function laesForm() {
    const a = aaben, fejl = [];
    a.navn = $('#mdNavn').value.trim();
    a.type = $('#mdType').value;
    if (!a.navn) fejl.push('Skriv et navn.');
    else if (model.some(m => m.id != a.id && m.navn.toLowerCase() == a.navn.toLowerCase())) fejl.push('Der findes allerede en medarbejder med det navn.');
    const vindue = (ja, fra, til, lukT, hvad) => {
      if (!ja) return null;
      const s = tid(fra), e = tid(til);
      if (isNaN(s) || isNaN(e) || s >= e) { fejl.push(`${hvad}: "fra" skal være før "til".`); return null; }
      if (s < O.AABEN || e > lukT) fejl.push(`${hvad}: butikken har åbent ${kl(O.AABEN)}–${kl(lukT)}.`);
      if (e - s < 180) fejl.push(`${hvad}: der skal være mindst 3 timer (en vagt er mindst 3 timer).`);
      return [s, e];
    };
    a.hverdag = vindue($('#mdHverdagJa').checked, $('#mdHverdagFra').value, $('#mdHverdagTil').value, O.LUK_HVERDAG, 'Hverdage');
    a.weekend = vindue($('#mdWeekendJa').checked, $('#mdWeekendFra').value, $('#mdWeekendTil').value, O.LUK_WEEKEND, 'Weekend');
    a.ikkeDage = [...document.querySelectorAll('#mdIkkeDage input:checked')].map(c => +c.value);
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
  $('#mdLuk').onclick = () => $('#md').close();

  // Gemmer den nye opsaetning, fjerner vagter for folk der ikke findes mere, og tegner planen
  // igen med de nye regler. Den eksisterende plan roeres ellers ikke -- "Foreslå ny plan"
  // laver en ny, der bruger aendringerne.
  function anvend() {
    const C = O.fraModel(model, raekke.opsaetning);
    genopbygMotor(C);
    save(true);
    $('#ekstraHint').hidden = false;
    render();
  }
})();
