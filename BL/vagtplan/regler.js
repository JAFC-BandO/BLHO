// Regler-dialogen: laes butikkens regler (skrevet ud fra felterne) og ret dem uden kode eller
// AI -- aabningstider, bemanding som en tidslinje, "aldrig mere end", mindste vagt, ansvarlig og
// hvor tit man arbejder weekend. Reglerne ligger i opsaetningen (butiksregler) og gaelder den
// aabne vagtplan; de kopieres med til nye vagtplaner og skabeloner.
// Indlaeses EFTER vagtplanens eget script og bruger dets variabler (M, raekke, aendret, render,
// $, esc, genopbygMotor, opdaterKontroller, reglerHtml, gemStatus).
(function () {
  const O = window.VagtplanOpsaetning;
  const DAGE = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  const kl = m => String(m / 60 | 0).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const tid = v => { const [a, b] = String(v || '').split(':').map(Number); return isNaN(a) ? NaN : a * 60 + (b || 0); };
  let bem = null; // bemanding under redigering: { hverdag: [...], weekend: [...] }

  window.aabnRegler = function () { visLaes(); if (!$('#rd').open) $('#rd').showModal(); };
  function visLaes() {
    $('#rdTitel').textContent = 'Regler';
    $('#rdVis').hidden = false; $('#rdForm').hidden = true;
    $('#rt').innerHTML = reglerHtml(raekke.opsaetning);
  }

  // ---------- Formular ----------
  function visForm() {
    const R = JSON.parse(JSON.stringify(O.regler(raekke.opsaetning)));
    $('#rdTitel').textContent = 'Ret butikkens regler';
    $('#rdVis').hidden = true; $('#rdForm').hidden = false;
    $('#rgAabning').innerHTML = DAGE.map((n, d) => {
      const v = R.aabning[d], vis = v || (d > 4 ? [525, 1035] : [525, 1095]);
      return `<div class="md-dag ${v ? '' : 'fri'}" data-rg-dag="${d}">
        <label><input type="checkbox" data-rg-aaben="${d}" ${v ? 'checked' : ''}> ${n}</label>
        <span class="md-tider">fra <input type="time" step="900" data-rg-fra="${d}" value="${kl(vis[0])}" aria-label="${n} åbner"> til <input type="time" step="900" data-rg-til="${d}" value="${kl(vis[1])}" aria-label="${n} lukker"></span>
      </div>`;
    }).join('');
    bem = { hverdag: (R.bemanding.hverdag || []).map(x => Object.assign({}, x)), weekend: R.bemanding.weekend ? R.bemanding.weekend.map(x => Object.assign({}, x)) : null };
    $('#rgSammeWeekend').checked = !bem.weekend;
    tegnBemanding();
    $('#rgMaks').value = R.maksAltid;
    $('#rgMinVagt').value = R.minVagt / 60;
    $('#rgAnsvarlig').checked = !!R.ansvarlig;
    $('#rgWeekendHver').value = R.weekendHver;
    $('#rgNoter').value = raekke.opsaetning.noter || '';
    $('#rgFejl').textContent = '';
  }
  function linjeHtml(type, x, i) {
    return `<div class="rg-linje" data-type="${type}" data-i="${i}">
      <span>Fra kl.</span><input type="time" step="900" data-f="fra" value="${x.fra != null ? kl(x.fra) : ''}" aria-label="Fra kl.">
      <span>mindst</span><input type="number" min="0" max="20" data-f="min" value="${x.min != null ? x.min : ''}" aria-label="Mindst antal">
      <span>højst</span><input type="number" min="0" max="20" data-f="max" value="${x.max != null ? x.max : ''}" aria-label="Højst antal">
      <span class="rg-eller">eller fra kl.</span><input type="time" step="900" data-f="ellerFra" value="${x.ellerFra != null ? kl(x.ellerFra) : ''}" aria-label="Eller fra kl. (valgfri)" title="Valgfri: planlæggeren må også lade linjen starte her, hvis det er nemmere">
      <button type="button" class="md-slet-vagt" data-rg-slet="${type}:${i}" title="Fjern linjen" aria-label="Fjern linjen">✕</button>
    </div>`;
  }
  function tegnBemanding() {
    $('#rgHverdag').innerHTML = bem.hverdag.length ? bem.hverdag.map((x, i) => linjeHtml('hverdag', x, i)).join('') : '<p class="s md-ingen">Ingen krav – planlæggeren skal ikke have nogen på arbejde.</p>';
    $('#rgWeekendBlok').hidden = !bem.weekend;
    $('#rgHverdagTitel').textContent = bem.weekend ? 'Hverdage' : 'Alle dage';
    if (bem.weekend) $('#rgWeekend').innerHTML = bem.weekend.length ? bem.weekend.map((x, i) => linjeHtml('weekend', x, i)).join('') : '<p class="s md-ingen">Ingen krav i weekenden.</p>';
  }
  // Felterne skrives tilbage i bem, saa en ny/slettet linje ikke mister det man har skrevet
  function hentLinjer() {
    document.querySelectorAll('#rdForm .rg-linje').forEach(el => {
      const x = bem[el.dataset.type][+el.dataset.i];
      el.querySelectorAll('input').forEach(inp => {
        const f = inp.dataset.f, v = inp.value;
        if (f == 'fra' || f == 'ellerFra') x[f] = v ? tid(v) : null;
        else x[f] = v === '' ? null : Number(v);
      });
    });
  }
  document.getElementById('rdForm').addEventListener('click', e => {
    const ny = e.target.closest('[data-rg-ny]'), slet = e.target.closest('[data-rg-slet]');
    if (!ny && !slet) return;
    hentLinjer();
    if (ny) {
      const liste = bem[ny.dataset.rgNy], sidst = liste[liste.length - 1];
      liste.push({ fra: sidst ? Math.min(sidst.fra + 120, 1200) : 600, min: 1, max: sidst ? sidst.max : 2 });
    } else {
      const [type, i] = slet.dataset.rgSlet.split(':');
      bem[type].splice(+i, 1);
    }
    tegnBemanding();
  });
  $('#rgSammeWeekend').addEventListener('change', e => {
    hentLinjer();
    bem.weekend = e.target.checked ? null : bem.hverdag.map(x => Object.assign({}, x));
    tegnBemanding();
  });
  $('#rgAabning').addEventListener('change', e => {
    const d = e.target.dataset.rgAaben;
    if (d !== undefined) document.querySelector(`[data-rg-dag="${d}"]`).classList.toggle('fri', !e.target.checked);
  });

  // ---------- Gem ----------
  function laes() {
    const fejl = [];
    const aabning = DAGE.map((n, d) => {
      if (!document.querySelector(`[data-rg-aaben="${d}"]`).checked) return null;
      const s = tid(document.querySelector(`[data-rg-fra="${d}"]`).value), e = tid(document.querySelector(`[data-rg-til="${d}"]`).value);
      if (isNaN(s) || isNaN(e) || s >= e) { fejl.push(`${n}: "fra" skal være før "til".`); return null; }
      return [s, e];
    });
    if (!aabning.some(Boolean)) fejl.push('Butikken skal have åbent mindst én dag.');
    const maksAltid = Number($('#rgMaks').value), minVagtT = Number(String($('#rgMinVagt').value).replace(',', '.'));
    const weekendHver = Number($('#rgWeekendHver').value);
    if (!(Number.isInteger(maksAltid) && maksAltid >= 1 && maksAltid <= 20)) fejl.push('"Aldrig mere end" skal være et helt tal mellem 1 og 20.');
    if (!(minVagtT >= 0.5 && minVagtT <= 12 && Number.isInteger(minVagtT * 4))) fejl.push('Den mindste vagt skal være mellem 0,5 og 12 timer, i kvarte timer (fx 3 eller 2,5).');
    if (!(Number.isInteger(weekendHver) && weekendHver >= 1 && weekendHver <= 8)) fejl.push('"Højst hver … weekend" skal være et helt tal mellem 1 og 8.');
    hentLinjer();
    const tjekListe = (liste, navn) => {
      const set = new Set();
      liste.forEach(x => {
        const hvor = `${navn}, fra ${x.fra != null && !isNaN(x.fra) ? kl(x.fra) : '?'}`;
        if (x.fra == null || isNaN(x.fra)) fejl.push(`${navn}: hver linje skal have et "fra"-klokkeslæt.`);
        else if (set.has(x.fra)) fejl.push(`${navn}: to linjer starter begge kl. ${kl(x.fra)}.`);
        else set.add(x.fra);
        if (!Number.isInteger(x.min) || x.min < 0) fejl.push(`${hvor}: "mindst" skal være et helt tal (0 eller mere).`);
        if (!Number.isInteger(x.max) || x.max < 1) fejl.push(`${hvor}: "højst" skal være et helt tal (1 eller mere).`);
        if (Number.isInteger(x.min) && Number.isInteger(x.max) && x.min > x.max) fejl.push(`${hvor}: "mindst" kan ikke være større end "højst".`);
        if (Number.isInteger(x.max) && x.max > maksAltid) fejl.push(`${hvor}: "højst" kan ikke være mere end "aldrig mere end ${maksAltid}".`);
        if (x.ellerFra != null && !(x.ellerFra > x.fra)) fejl.push(`${hvor}: "eller fra" skal være senere end "fra".`);
        if (x.ellerFra == null) delete x.ellerFra;
      });
      return liste.slice().sort((a, b) => a.fra - b.fra);
    };
    const hverdag = tjekListe(bem.hverdag, bem.weekend ? 'Bemanding på hverdage' : 'Bemanding');
    const weekend = bem.weekend ? tjekListe(bem.weekend, 'Bemanding i weekenden') : null;
    // Planlaeggeren kan kun flytte ét starttidspunkt ("15:00 eller 15:15")
    const fleks = hverdag.concat(weekend || []).filter(x => x.ellerFra != null);
    if (new Set(fleks.map(x => x.fra + '-' + x.ellerFra)).size > 1) fejl.push('Der kan kun være ét "eller fra" – brug samme tidspunkter på hverdage og i weekenden, eller fjern det ene.');
    return { fejl, R: { aabning, bemanding: { hverdag, weekend }, maksAltid, minVagt: Math.round(minVagtT * 60), ansvarlig: $('#rgAnsvarlig').checked, weekendHver } };
  }
  $('#rgGem').onclick = () => {
    const { fejl, R } = laes();
    if (fejl.length) { $('#rgFejl').innerHTML = fejl.map(esc).join('<br>'); return; }
    const noter = $('#rgNoter').value.trim();
    const C = Object.assign({}, raekke.opsaetning, { butiksregler: R });
    if (noter) C.noter = noter; else delete C.noter;
    // Gennem medarbejder-modellen, saa weekend-holdene passer til "hver N. weekend", og
    // medarbejdernes tider foelger nye aabningstider
    genopbygMotor(O.fraModel(O.tilModel(C), C));
    opdaterKontroller();
    $('#ekstraHint').hidden = false;
    render(); aendret();
    visLaes();
    gemStatus('Reglerne er ændret. Tryk "Foreslå ny plan" for at lave en plan efter dem.', 'ok');
  };
  $('#rdRet').onclick = visForm;
  $('#rgTilbage').onclick = visLaes;
})();
